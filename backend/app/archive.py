import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg

from .config import Settings
from .repository import Repository

logger = logging.getLogger(__name__)

PAGE_SIZE = 500

ATHLETE_COLUMNS = (
    "id,race_cd,team_cd,team_name,sail_no,device_cd,nationality,captured_at_ms,"
    "received_at_ms,sog_knots,cog_degree,latitude,longitude,relative_signed_degree,"
    "relative_angle_degree,upwind_vmg_knots,vmc_knots,wind_reading_captured_at_ms,"
    "phase,created_at"
)
WIND_COLUMNS = (
    "id,race_cd,wind_instrument_cd,wind_instrument_name,device_cd,roll_type,"
    "captured_at_ms,received_at_ms,speed_knots,direction_degree,latitude,longitude,"
    "phase,created_at"
)


def _iso(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


class ArchiveManager:
    """Keeps Supabase under its storage quota without losing history.

    Two independent passes, run on a timer:
      1. Clear ``raw_runtime`` for races finished long enough ago that
         reprocessing is unlikely to be needed (cheap - stays in Supabase).
      2. Move readings older than the retention window to a separate
         Postgres on ai-brain, deleting them from Supabase once copied.
         ``races.archived_at`` is set once a race has nothing left in
         Supabase, which is what the frontend and the /archive/* endpoints
         in app.main use to know where to read a race's history from.
    """

    def __init__(self, settings: Settings, repository: Repository) -> None:
        self.settings = settings
        self.repository = repository
        self.pool: asyncpg.Pool | None = None
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if not self.settings.archive_database_url or (self._task and not self._task.done()):
            return
        self.pool = await asyncpg.create_pool(self.settings.archive_database_url, min_size=1, max_size=4)
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="archive-manager")

    async def shutdown(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self.pool:
            await self.pool.close()

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.clear_old_raw_runtime()
                await self.archive_old_readings()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Archive cycle failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.archive_scheduler_interval_seconds
                )
            except TimeoutError:
                pass

    async def clear_old_raw_runtime(self) -> int:
        cutoff = datetime.now(UTC) - timedelta(hours=self.settings.raw_runtime_clear_after_hours)
        races = await self.repository.select(
            "races",
            columns="race_cd",
            filters={"sailfish_status": "eq.99", "end_at": f"lte.{cutoff.isoformat()}"},
        )
        cleared = 0
        for race in races:
            race_cd = str(race["race_cd"])
            cleared += await self._clear_raw_runtime_for_table("athlete_readings", race_cd)
            cleared += await self._clear_raw_runtime_for_table("wind_readings", race_cd)
        return cleared

    async def _clear_raw_runtime_for_table(self, table: str, race_cd: str) -> int:
        cleared = 0
        last_id = 0
        while True:
            rows = await self.repository.select(
                table,
                columns="id",
                filters={
                    "race_cd": f"eq.{race_cd}",
                    "id": f"gt.{last_id}",
                    "raw_runtime": "not.is.null",
                },
                order="id.asc",
                limit=PAGE_SIZE,
            )
            if not rows:
                break
            ids = [row["id"] for row in rows]
            last_id = ids[-1]
            await self.repository.update_where(
                table, {"raw_runtime": None}, {"id": f"in.({','.join(str(i) for i in ids)})"}
            )
            cleared += len(ids)
            if len(rows) < PAGE_SIZE:
                break
        return cleared

    async def archive_old_readings(self) -> int:
        if not self.pool:
            return 0
        cutoff_ms = int((datetime.now(UTC) - timedelta(days=self.settings.archive_after_days)).timestamp() * 1000)
        archived_total = 0
        races = await self.repository.select(
            "races",
            columns="race_cd",
            filters={"sailfish_status": "eq.99", "archived_at": "is.null"},
        )
        for race in races:
            race_cd = str(race["race_cd"])
            archived_total += await self._archive_table(
                "athlete_readings", ATHLETE_COLUMNS, race_cd, cutoff_ms
            )
            archived_total += await self._archive_table(
                "wind_readings", WIND_COLUMNS, race_cd, cutoff_ms
            )
            await self._mark_archived_if_empty(race_cd)
        return archived_total

    async def _archive_table(self, table: str, columns: str, race_cd: str, cutoff_ms: int) -> int:
        archived = 0
        while True:
            rows = await self.repository.select(
                table,
                columns=columns,
                filters={"race_cd": f"eq.{race_cd}", "captured_at_ms": f"lt.{cutoff_ms}"},
                order="id.asc",
                limit=PAGE_SIZE,
            )
            if not rows:
                break
            await self._insert_archive_rows(table, rows)
            ids = [row["id"] for row in rows]
            await self.repository.delete_where(table, {"id": f"in.({','.join(str(i) for i in ids)})"})
            archived += len(ids)
            if len(rows) < PAGE_SIZE:
                break
        return archived

    async def _insert_archive_rows(self, table: str, rows: list[dict[str, Any]]) -> None:
        assert self.pool is not None
        columns = list(rows[0].keys())
        placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
        query = (
            f"insert into {table} ({', '.join(columns)}) values ({placeholders}) "
            "on conflict (id) do nothing"
        )
        records = []
        for row in rows:
            values = []
            for column in columns:
                value = row.get(column)
                if column == "created_at":
                    value = _iso(value)
                values.append(value)
            records.append(values)
        async with self.pool.acquire() as connection:
            await connection.executemany(query, records)

    async def _mark_archived_if_empty(self, race_cd: str) -> None:
        remaining = await self.repository.select(
            "athlete_readings", columns="id", filters={"race_cd": f"eq.{race_cd}"}, limit=1
        )
        if remaining:
            return
        await self.repository.update(
            "races", {"archived_at": datetime.now(UTC).isoformat()}, {"race_cd": race_cd}
        )
