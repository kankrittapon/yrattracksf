from types import SimpleNamespace

from app.collector import RaceCollector
from app.schemas import CollectorState


class FakeRepository:
    def __init__(self) -> None:
        self.events: dict[tuple[str, str], dict] = {}
        self.status_rows: list[dict] = []
        self.race_updates: list[dict] = []
        self.inserted: dict[str, list[dict]] = {}
        self.upserted: dict[str, list[dict]] = {}

    async def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if table == "collector_status":
            self.status_rows.extend(rows)
        self.upserted.setdefault(table, []).extend(rows)

    async def insert(self, table: str, rows: list[dict]) -> None:
        self.inserted.setdefault(table, []).extend(rows)

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


class FakeTokenProvider:
    def diagnostics(self) -> dict:
        return {"token_source": "unavailable", "token_expires_at": None, "last_token_refresh_at": None}


def make_collector(on_finished=None) -> tuple[RaceCollector, FakeRepository]:
    repository = FakeRepository()
    settings = SimpleNamespace(
        race_status_poll_seconds=0.01,
        wind_freshness_seconds=5,
        sailfish_snapshot_fallback_enabled=True,
        sailfish_snapshot_fallback_seconds=0.05,
    )
    collector = RaceCollector(
        "race-1",
        settings,
        FakeSailfish(),
        repository,
        FakeTokenProvider(),
        on_finished,
    )
    return collector, repository


async def test_confirmed_status_lifecycle_and_event_deduplication() -> None:
    finished: list[tuple[str, dict]] = []

    async def on_finished(race_cd: str, race: dict) -> None:
        finished.append((race_cd, race))

    collector, repository = make_collector(on_finished)

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
    assert len(finished) == 1
    assert repository.race_updates[-1]["values"]["collection_enabled"] is False

    await collector._apply_sailfish_status(
        {"status": "99", "endTime": "1785248840000"}, source="test"
    )
    assert len(finished) == 1


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


async def test_status_poll_success_does_not_clear_websocket_error() -> None:
    """Regression test for planned.md: status polling used to wipe a shared
    last_error field, hiding a genuine WebSocket disconnect from Admin within
    one poll cycle. The fields must now be independent."""
    collector, _ = make_collector()
    collector.status.websocket_last_error = "connection reset"

    await collector._apply_sailfish_status(
        {"status": "10", "startTime": "", "endTime": ""},
        source="admin_poll",
    )

    assert collector.status.websocket_last_error == "connection reset"


async def test_store_snapshot_readings_tags_source() -> None:
    collector, repository = make_collector()
    snapshot = {
        "teamList": [{
            "raceCd": "race-1",
            "teamCd": "team-1",
            "runtime": [None] * 24,
        }],
        "windInstrumentList": [{
            "raceCd": "race-1",
            "windInstrumentCd": "wind-1",
            "rollType": "main",
            "runtime": [None] * 24,
        }],
    }
    # runtime[22] is captured_at_ms; must be set for the row to be stored.
    snapshot["teamList"][0]["runtime"][22] = 1_700_000_000_000
    snapshot["windInstrumentList"][0]["runtime"][22] = 1_700_000_000_000

    stored = await collector._store_snapshot_readings(snapshot, source="snapshot_fallback")

    assert stored == 2
    athlete_rows = repository.upserted["athlete_readings"]
    wind_rows = repository.upserted["wind_readings"]
    assert athlete_rows[0]["source"] == "snapshot_fallback"
    assert wind_rows[0]["source"] == "snapshot_fallback"
    assert collector.status.normalized_readings == 2


async def test_start_fallback_sets_transport_mode_and_logs_event() -> None:
    collector, repository = make_collector()
    collector.status.websocket_last_error = "handshake failed"

    await collector._start_fallback()
    await collector._stop_fallback(mark_recovered=False)

    events = repository.inserted["data_quality_events"]
    assert events[0]["event_type"] == "snapshot_fallback_engaged"
    assert events[0]["details"]["reason"] == "handshake failed"


async def test_stop_fallback_logs_recovered_only_when_requested() -> None:
    collector, repository = make_collector()

    await collector._start_fallback()
    await collector._stop_fallback(mark_recovered=True)

    event_types = [event["event_type"] for event in repository.inserted["data_quality_events"]]
    assert event_types == ["snapshot_fallback_engaged", "snapshot_fallback_recovered"]
    from app.schemas import TransportMode
    assert collector.status.transport_mode == TransportMode.WEBSOCKET


async def test_stop_fallback_without_prior_start_is_a_no_op() -> None:
    collector, repository = make_collector()

    await collector._stop_fallback(mark_recovered=True)

    assert repository.inserted == {}


async def test_apply_token_diagnostics_copies_provider_state() -> None:
    collector, _ = make_collector()

    class ReadyTokenProvider:
        def diagnostics(self) -> dict:
            return {
                "token_source": "automatic",
                "token_expires_at": "2026-08-01T00:00:00+00:00",
                "last_token_refresh_at": "2026-07-29T00:00:00+00:00",
            }

    collector.token_provider = ReadyTokenProvider()

    collector._apply_token_diagnostics()

    assert collector.status.token_source == "automatic"
    assert collector.status.token_expires_at is not None
    assert collector.status.last_token_refresh_at is not None
