from types import SimpleNamespace

from app.collector import RaceCollector
from app.schemas import CollectorState


class FakeRepository:
    def __init__(self) -> None:
        self.events: dict[tuple[str, str], dict] = {}
        self.status_rows: list[dict] = []
        self.race_updates: list[dict] = []

    async def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if table == "collector_status":
            self.status_rows.extend(rows)

    async def update(self, table: str, values: dict, filters: dict[str, str]) -> None:
        if table == "races":
            self.race_updates.append({"values": values, "filters": filters})

    async def store_race_event_once(
        self,
        race_cd: str,
        event_type: str,
        captured_at,
        phase: str,
        payload: dict,
    ) -> bool:
        key = (race_cd, event_type)
        if key in self.events:
            return False
        self.events[key] = {
            "captured_at": captured_at,
            "phase": phase,
            "payload": payload,
        }
        return True


class FakeSailfish:
    pass


def make_collector() -> tuple[RaceCollector, FakeRepository]:
    repository = FakeRepository()
    settings = SimpleNamespace(race_status_poll_seconds=0.01)
    collector = RaceCollector(
        "race-1",
        settings,
        FakeSailfish(),
        repository,
    )
    return collector, repository


async def test_confirmed_status_lifecycle_and_event_deduplication() -> None:
    collector, repository = make_collector()

    await collector._apply_sailfish_status(
        {"status": "10", "startTime": "", "endTime": ""},
        source="test",
    )
    assert collector.status.state == CollectorState.WAITING_FOR_START

    await collector._apply_sailfish_status(
        {"status": "50", "startTime": "1785171600000", "endTime": ""},
        source="test",
    )
    assert collector.status.state == CollectorState.RECORDING
    assert ("race-1", "sailfish_started") in repository.events

    await collector._apply_sailfish_status(
        {"status": "50", "startTime": "1785171600000", "endTime": ""},
        source="test",
    )
    assert len(repository.events) == 1

    await collector._apply_sailfish_status(
        {
            "status": "99",
            "startTime": "1785171600000",
            "endTime": "1785248840000",
        },
        source="test",
    )
    assert collector.status.state == CollectorState.FINISHING
    assert collector._stop.is_set()
    assert ("race-1", "sailfish_finished") in repository.events
    assert len(repository.events) == 2


async def test_status_10_does_not_cancel_manual_recording_override() -> None:
    collector, _ = make_collector()
    collector._force_recording = True
    collector.status.state = CollectorState.RECORDING

    await collector._apply_sailfish_status(
        {"status": "10", "startTime": "", "endTime": ""},
        source="test",
    )

    assert collector.status.state == CollectorState.RECORDING


async def test_unknown_status_is_observed_without_changing_state() -> None:
    collector, _ = make_collector()
    collector.status.state = CollectorState.WAITING_FOR_START

    await collector._apply_sailfish_status(
        {"status": "77", "startTime": "", "endTime": ""},
        source="test",
    )

    assert collector.status.state == CollectorState.WAITING_FOR_START
    assert collector.status.sailfish_status == "77"
