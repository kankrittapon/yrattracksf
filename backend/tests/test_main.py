from app.main import _arm_race, app, sync_races
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
    def __init__(self) -> None:
        self.updates: list[tuple[str, dict, dict]] = []
        self.audits: list[tuple[str, str, str | None, str | None]] = []

    async def select(self, table, *, columns="*", filters=None, order=None, limit=None):
        return []

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
