from app.main import _arm_race, _public_archived_race, app, sync_races
from app.schemas import Principal, RaceSyncRequest


class FakeCollector:
    def __init__(self) -> None:
        self.armed = False

    async def arm(self) -> str:
        self.armed = True
        return "armed-status"


class FakeCollectorManager:
    def __init__(self) -> None:
        self.collectors: dict[str, FakeCollector] = {}

    def get_or_create(self, race_cd: str) -> FakeCollector:
        return self.collectors.setdefault(race_cd, FakeCollector())


class FakeRepository:
    def __init__(self, tables: dict[str, list[dict]] | None = None) -> None:
        self.updates: list[tuple[str, dict, dict]] = []
        self.audits: list[tuple[str, str, str | None, str | None]] = []
        self.tables = tables or {}

    async def select(self, table, *, columns="*", filters=None, order=None, limit=None):
        return self.tables.get(table, [])

    async def upsert(self, table, rows, on_conflict) -> None:
        pass

    async def update(self, table, values, filters) -> None:
        self.updates.append((table, values, filters))

    async def audit(self, actor_id, action, race_cd, reason) -> None:
        self.audits.append((actor_id, action, race_cd, reason))


class FakeSailfish:
    def __init__(self, races: list[dict]) -> None:
        self._races = races

    async def sync_races(self, match_cd: str) -> list[dict]:
        return self._races

    async def get_admin_race(self, race_cd: str) -> dict:
        return next(race for race in self._races if race["raceCd"] == race_cd)


async def test_arm_race_updates_collection_enabled_and_arms_collector() -> None:
    app.state.repository = FakeRepository()
    app.state.collectors = FakeCollectorManager()

    result = await _arm_race("race-1", "user-1", "test reason")

    assert result == "armed-status"
    assert app.state.collectors.collectors["race-1"].armed is True
    table, values, filters = app.state.repository.updates[0]
    assert table == "races"
    assert values["collection_enabled"] is True
    assert filters == {"race_cd": "race-1"}
    assert app.state.repository.audits[0] == ("user-1", "collector.arm", "race-1", "test reason")


async def test_sync_races_auto_arms_waiting_and_active_but_not_finished() -> None:
    app.state.repository = FakeRepository()
    app.state.collectors = FakeCollectorManager()
    app.state.sailfish = FakeSailfish([
        {"raceCd": "waiting-race", "status": "10", "matchCd": "m1", "rounds": "R1"},
        {"raceCd": "active-race", "status": "50", "matchCd": "m1", "rounds": "R2"},
        {"raceCd": "finished-race", "status": "99", "matchCd": "m1", "rounds": "R3"},
    ])
    principal = Principal(user_id="user-1", role="admin")

    body = await sync_races(RaceSyncRequest(match_cd="m1" * 8), principal)

    assert set(body["armed"]) == {"waiting-race", "active-race"}
    assert set(app.state.collectors.collectors) == {"waiting-race", "active-race"}
    assert all(c.armed for c in app.state.collectors.collectors.values())


def _archived_race_row(**overrides):
    row = {
        "race_cd": "race-1",
        "match_cd": "match-1",
        "level_cd": "level-1",
        "sailfish_status": "99",
        "archived_at": "2026-01-01T00:00:00+00:00",
    }
    row.update(overrides)
    return row


async def test_public_archived_race_allows_when_fully_public_and_archived() -> None:
    app.state.repository = FakeRepository({
        "races": [_archived_race_row()],
        "matches": [{"is_public": True}],
        "race_classes": [{"public_history_enabled": True}],
    })

    result = await _public_archived_race("race-1")

    assert result is not None
    assert result["race_cd"] == "race-1"


async def test_public_archived_race_none_when_not_yet_archived() -> None:
    app.state.repository = FakeRepository({
        "races": [_archived_race_row(archived_at=None)],
        "matches": [{"is_public": True}],
        "race_classes": [{"public_history_enabled": True}],
    })

    assert await _public_archived_race("race-1") is None


async def test_public_archived_race_none_when_match_not_public() -> None:
    app.state.repository = FakeRepository({
        "races": [_archived_race_row()],
        "matches": [{"is_public": False}],
        "race_classes": [{"public_history_enabled": True}],
    })

    assert await _public_archived_race("race-1") is None


async def test_public_archived_race_none_when_history_not_enabled() -> None:
    app.state.repository = FakeRepository({
        "races": [_archived_race_row()],
        "matches": [{"is_public": True}],
        "race_classes": [{"public_history_enabled": False}],
    })

    assert await _public_archived_race("race-1") is None


async def test_public_archived_race_none_when_race_missing() -> None:
    app.state.repository = FakeRepository({"races": []})

    assert await _public_archived_race("race-1") is None
