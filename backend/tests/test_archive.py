from types import SimpleNamespace

from app.archive import ArchiveManager


class FakeRepository:
    def __init__(self) -> None:
        self.enabled = True
        self.select_calls: list[tuple[str, dict]] = []
        self.select_results: dict[str, list] = {}
        self.update_where_calls: list[tuple[str, dict, dict]] = []
        self.delete_where_calls: list[tuple[str, dict]] = []
        self.update_calls: list[tuple[str, dict, dict]] = []

    def queue_select(self, table: str, results: list[list[dict]]) -> None:
        self.select_results[table] = list(results)

    async def select(self, table, *, columns="*", filters=None, order=None, limit=None):
        self.select_calls.append((table, dict(filters or {})))
        queue = self.select_results.get(table)
        if queue:
            return queue.pop(0)
        return []

    async def update_where(self, table, values, params):
        self.update_where_calls.append((table, values, params))

    async def delete_where(self, table, params):
        self.delete_where_calls.append((table, params))

    async def update(self, table, values, filters):
        self.update_calls.append((table, values, filters))


class FakeConnection:
    def __init__(self) -> None:
        self.executed: list[tuple[str, list]] = []

    async def executemany(self, query, records):
        self.executed.append((query, records))


class FakeAcquire:
    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *exc):
        return False


class FakePool:
    def __init__(self) -> None:
        self.connection = FakeConnection()

    def acquire(self):
        return FakeAcquire(self.connection)


def make_manager(repository: FakeRepository, pool: FakePool | None = None) -> ArchiveManager:
    settings = SimpleNamespace(
        archive_database_url="postgres://fake",
        raw_runtime_clear_after_hours=24,
        archive_after_days=7,
        archive_scheduler_interval_seconds=3600,
    )
    manager = ArchiveManager(settings, repository)
    manager.pool = pool
    return manager


async def test_clear_raw_runtime_for_table_pages_and_updates_in_batches() -> None:
    repo = FakeRepository()
    repo.queue_select("athlete_readings", [
        [{"id": 1}, {"id": 2}],
        [],
    ])
    manager = make_manager(repo)

    cleared = await manager._clear_raw_runtime_for_table("athlete_readings", "race-1")

    assert cleared == 2
    assert repo.update_where_calls == [
        ("athlete_readings", {"raw_runtime": None}, {"id": "in.(1,2)"})
    ]


async def test_archive_table_copies_then_deletes_from_supabase() -> None:
    repo = FakeRepository()
    rows = [
        {"id": 10, "race_cd": "race-1", "captured_at_ms": 1, "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": 11, "race_cd": "race-1", "captured_at_ms": 2, "created_at": "2026-01-01T00:00:01+00:00"},
    ]
    repo.queue_select("athlete_readings", [rows, []])
    pool = FakePool()
    manager = make_manager(repo, pool)

    archived = await manager._archive_table("athlete_readings", "id,race_cd,captured_at_ms,created_at", "race-1", 9999)

    assert archived == 2
    assert repo.delete_where_calls == [("athlete_readings", {"id": "in.(10,11)"})]
    assert len(pool.connection.executed) == 1
    query, records = pool.connection.executed[0]
    assert "insert into athlete_readings" in query
    assert len(records) == 2


async def test_mark_archived_if_empty_only_when_no_readings_remain() -> None:
    repo = FakeRepository()
    repo.queue_select("athlete_readings", [[]])
    manager = make_manager(repo)

    await manager._mark_archived_if_empty("race-1")

    assert len(repo.update_calls) == 1
    table, values, filters = repo.update_calls[0]
    assert table == "races"
    assert "archived_at" in values
    assert filters == {"race_cd": "race-1"}


async def test_mark_archived_if_empty_skips_when_readings_remain() -> None:
    repo = FakeRepository()
    repo.queue_select("athlete_readings", [[{"id": 1}]])
    manager = make_manager(repo)

    await manager._mark_archived_if_empty("race-1")

    assert repo.update_calls == []
