import asyncio
import logging
from bisect import bisect_left
from datetime import UTC, datetime, timedelta
from typing import Any

from .config import Settings
from .decoder import course_to_wind, normalize_team, normalize_wind
from .repository import Repository
from .sailfish import SailfishClient

logger = logging.getLogger(__name__)


def _milliseconds(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return int(numeric * 1000) if numeric < 10_000_000_000 else int(numeric)


def _iso_from_ms(value: int | None) -> str | None:
    return datetime.fromtimestamp(value / 1000, UTC).isoformat() if value else None


class HistoryImportManager:
    """Persist and execute delayed replay imports after SailFish marks a race finished."""

    def __init__(self, settings: Settings, sailfish: SailfishClient, repository: Repository) -> None:
        self.settings = settings
        self.sailfish = sailfish
        self.repository = repository
        self._scheduler: asyncio.Task[None] | None = None
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if not self.repository.enabled or (self._scheduler and not self._scheduler.done()):
            return
        self._stop.clear()
        self._scheduler = asyncio.create_task(self._run_scheduler(), name="history-import-scheduler")

    async def shutdown(self) -> None:
        self._stop.set()
        if self._scheduler:
            self._scheduler.cancel()
        tasks = [task for task in [self._scheduler, *self._tasks.values()] if task]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def schedule_after_finish(self, race_cd: str, race: dict[str, Any]) -> dict[str, Any]:
        existing = await self.repository.select(
            "history_imports", filters={"race_cd": f"eq.{race_cd}"}, limit=1
        )
        if existing and existing[0].get("status") in {"running", "completed"}:
            return existing[0]

        now = datetime.now(UTC)
        end_ms = _milliseconds(race.get("endTime"))
        finished_at = datetime.fromtimestamp(end_ms / 1000, UTC) if end_ms else now
        scheduled_for = max(now, finished_at + timedelta(minutes=self.settings.history_import_delay_minutes))
        row = {
            "race_cd": race_cd,
            "status": "pending",
            "scheduled_for": scheduled_for.isoformat(),
            "last_error": None,
            "updated_at": now.isoformat(),
        }
        await self.repository.upsert("history_imports", [row], "race_cd")
        return row

    async def retry_now(self, race_cd: str) -> None:
        now = datetime.now(UTC).isoformat()
        await self.repository.upsert(
            "history_imports",
            [{
                "race_cd": race_cd,
                "status": "pending",
                "scheduled_for": now,
                "last_error": None,
                "updated_at": now,
            }],
            "race_cd",
        )
        self._start_import(race_cd)

    async def _run_scheduler(self) -> None:
        while not self._stop.is_set():
            try:
                due = await self.repository.select(
                    "history_imports",
                    columns="race_cd",
                    filters={
                        "status": "eq.pending",
                        "scheduled_for": f"lte.{datetime.now(UTC).isoformat()}",
                    },
                    limit=10,
                )
                for item in due:
                    self._start_import(str(item["race_cd"]))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("History import scheduler failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.history_scheduler_interval_seconds
                )
            except TimeoutError:
                pass

    def _start_import(self, race_cd: str) -> None:
        current = self._tasks.get(race_cd)
        if current and not current.done():
            return
        if any(not task.done() for task in self._tasks.values()):
            return
        task = asyncio.create_task(self._import_guarded(race_cd), name=f"history-import:{race_cd}")
        self._tasks[race_cd] = task
        task.add_done_callback(lambda _: self._tasks.pop(race_cd, None))

    async def _import_guarded(self, race_cd: str) -> None:
        started_at = datetime.now(UTC)
        current = await self.repository.select(
            "history_imports", columns="attempts", filters={"race_cd": f"eq.{race_cd}"}, limit=1
        )
        attempts = int(current[0].get("attempts") or 0) + 1 if current else 1
        await self.repository.update(
            "history_imports",
            {
                "status": "running",
                "started_at": started_at.isoformat(),
                "completed_at": None,
                "progress_percent": 0,
                "attempts": attempts,
                "last_error": None,
                "updated_at": started_at.isoformat(),
            },
            {"race_cd": race_cd},
        )
        try:
            counts = await self._import_race(race_cd)
            completed_at = datetime.now(UTC)
            await self.repository.update(
                "history_imports",
                {
                    "status": "completed",
                    "progress_percent": 100,
                    "athlete_readings_count": counts["athlete"],
                    "wind_readings_count": counts["wind"],
                    "completed_at": completed_at.isoformat(),
                    "updated_at": completed_at.isoformat(),
                },
                {"race_cd": race_cd},
            )
            await self.repository.update(
                "races",
                {"history_imported_at": completed_at.isoformat(), "updated_at": completed_at.isoformat()},
                {"race_cd": race_cd},
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            retry_at = datetime.now(UTC) + timedelta(minutes=self.settings.history_import_retry_minutes)
            logger.exception("History import failed for %s", race_cd)
            await self.repository.update(
                "history_imports",
                {
                    "status": "error",
                    "last_error": str(exc)[:2000],
                    "scheduled_for": retry_at.isoformat(),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                {"race_cd": race_cd},
            )

    async def _import_race(self, race_cd: str) -> dict[str, int]:
        admin_race = await self.sailfish.get_admin_race(race_cd)
        if str(admin_race.get("status") or "") != "99":
            raise RuntimeError("SailFish race is not finished (status 99)")

        start_ms = _milliseconds(admin_race.get("startTime"))
        end_ms = _milliseconds(admin_race.get("endTime"))
        if not start_ms or not end_ms or end_ms <= start_ms:
            raise RuntimeError("Finished race has invalid start/end timestamps")

        snapshot = await self.sailfish.get_replay_snapshot(race_cd, end_ms)
        match_cd = str(snapshot.get("matchCd") or admin_race.get("matchCd") or "")
        level_cd = str(snapshot.get("levelCd") or admin_race.get("levelCd") or "")
        rounds = str(snapshot.get("rounds") or admin_race.get("rounds") or "")
        if not match_cd or not level_cd or not rounds:
            raise RuntimeError("Replay metadata is missing match, class, or round")

        await self._persist_metadata(
            race_cd, match_cd, level_cd, rounds, snapshot, admin_race, start_ms, end_ms
        )
        teams = snapshot.get("teamList") or []
        instruments = snapshot.get("windInstrumentList") or []
        team_meta = {str(item.get("teamCd")): item for item in teams if item.get("teamCd")}
        wind_meta = {
            str(item.get("windInstrumentCd")): item
            for item in instruments if item.get("windInstrumentCd")
        }
        lookup = {key.lower(): key for key in [*team_meta, *wind_meta]}
        main_wind_cd = next(
            (key for key, item in wind_meta.items() if item.get("rollType") == "main"),
            next(iter(wind_meta), None),
        )
        span_minutes = 6
        span_ms = span_minutes * 60_000
        chunk_starts = list(range(start_ms, end_ms + 1, span_ms))
        athlete_rows: list[dict[str, Any]] = []
        wind_rows: list[dict[str, Any]] = []
        for index, chunk_at in enumerate(chunk_starts, start=1):
            compressed, chunk = await self.sailfish.get_replay_chunk(
                race_cd=race_cd,
                match_cd=match_cd,
                rounds=rounds,
                time_span_minutes=span_minutes,
                end_at_ms=end_ms,
                chunk_at_ms=chunk_at,
            )
            await self.repository.store_raw(
                race_cd,
                f"REPLAY_CHUNK:{chunk_at}",
                "history",
                {"compressed": compressed, "chunk_at_ms": chunk_at, "time_span_minutes": span_minutes},
                datetime.now(UTC),
            )
            for raw_key, runtimes in chunk.items():
                key = lookup.get(str(raw_key).lower())
                if not key or not isinstance(runtimes, list):
                    continue
                for runtime in runtimes:
                    if not isinstance(runtime, list):
                        continue
                    if key in team_meta:
                        row = normalize_team({**team_meta[key], "raceCd": race_cd, "runtime": runtime})
                        if row["captured_at_ms"]:
                            row["phase"] = "recording"
                            athlete_rows.append(row)
                    elif key in wind_meta:
                        row = normalize_wind({**wind_meta[key], "raceCd": race_cd, "runtime": runtime})
                        if row["captured_at_ms"]:
                            row["phase"] = "recording"
                            wind_rows.append(row)
            await self.repository.update(
                "history_imports",
                {
                    "progress_percent": round(index * 70 / len(chunk_starts), 1),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                {"race_cd": race_cd},
            )

        athlete_rows = self._deduplicate(athlete_rows, ("race_cd", "team_cd", "captured_at_ms"))
        wind_rows = self._deduplicate(wind_rows, ("race_cd", "wind_instrument_cd", "captured_at_ms"))
        main_winds = sorted(
            (row for row in wind_rows if row["wind_instrument_cd"] == main_wind_cd),
            key=lambda row: row["captured_at_ms"],
        )
        self._calculate_wind_metrics(athlete_rows, main_winds)
        await self.repository.upsert_batches(
            "wind_readings", wind_rows, "race_cd,wind_instrument_cd,captured_at_ms"
        )
        await self.repository.update(
            "history_imports",
            {"progress_percent": 80, "updated_at": datetime.now(UTC).isoformat()},
            {"race_cd": race_cd},
        )
        await self.repository.upsert_batches(
            "athlete_readings", athlete_rows, "race_cd,team_cd,captured_at_ms"
        )

        calculated = sum(1 for row in athlete_rows if row.get("relative_angle_degree") is not None)
        unavailable = len(athlete_rows) - calculated
        if unavailable:
            await self.repository.insert(
                "data_quality_events",
                [{
                    "race_cd": race_cd,
                    "event_type": "history_wind_unavailable",
                    "severity": "warning",
                    "details": {
                        "athlete_readings": len(athlete_rows),
                        "calculated": calculated,
                        "unavailable": unavailable,
                        "freshness_seconds": self.settings.wind_freshness_seconds,
                    },
                    "created_at": datetime.now(UTC).isoformat(),
                }],
            )
        return {"athlete": len(athlete_rows), "wind": len(wind_rows)}

    async def _persist_metadata(
        self,
        race_cd: str,
        match_cd: str,
        level_cd: str,
        rounds: str,
        snapshot: dict[str, Any],
        race: dict[str, Any],
        start_ms: int,
        end_ms: int,
    ) -> None:
        await self.repository.upsert(
            "matches",
            [{
                "match_cd": match_cd,
                "name": snapshot.get("matchName") or race.get("matchName") or match_cd,
                "raw_metadata": {"source": "history_import"},
            }],
            "match_cd",
        )
        await self.repository.upsert(
            "race_classes",
            [{
                "level_cd": level_cd,
                "match_cd": match_cd,
                "name": snapshot.get("levelName") or race.get("levelName") or level_cd,
                "logo_url": snapshot.get("levelClassifyLogo") or race.get("levelClassifyLogo"),
                "raw_metadata": {"source": "history_import"},
            }],
            "level_cd",
        )
        instruments = snapshot.get("windInstrumentList") or []
        main_cd = next(
            (item.get("windInstrumentCd") for item in instruments if item.get("rollType") == "main"),
            instruments[0].get("windInstrumentCd") if instruments else None,
        )
        await self.repository.upsert(
            "races",
            [{
                "race_cd": race_cd,
                "match_cd": match_cd,
                "level_cd": level_cd,
                "name": snapshot.get("raceName") or race.get("raceName"),
                "rounds": rounds,
                "group_name": snapshot.get("groupName") or race.get("groupName"),
                "sailfish_status": "99",
                "start_at": _iso_from_ms(start_ms),
                "end_at": _iso_from_ms(end_ms),
                "main_wind_instrument_cd": main_cd,
                "raw_metadata": {"source": "history_import"},
                "updated_at": datetime.now(UTC).isoformat(),
            }],
            "race_cd",
        )
        await self.repository.upsert_batches(
            "teams",
            [{
                "race_cd": race_cd,
                "team_cd": item["teamCd"],
                "team_name": item.get("teamName"),
                "sail_no": item.get("sailNo"),
                "nationality": item.get("nationality"),
                "team_area": item.get("teamArea"),
                "device_cd": item.get("deviceCd"),
                "race_team_color": item.get("raceTeamColor"),
                "raw_metadata": {"source": "history_import"},
            } for item in snapshot.get("teamList") or [] if item.get("teamCd")],
            "race_cd,team_cd",
        )
        await self.repository.upsert_batches(
            "wind_instruments",
            [{
                "race_cd": race_cd,
                "wind_instrument_cd": item["windInstrumentCd"],
                "name": item.get("windInstrumentName"),
                "device_cd": item.get("deviceCd"),
                "roll_type": item.get("rollType"),
                "is_main": item.get("windInstrumentCd") == main_cd,
                "raw_metadata": {"source": "history_import"},
            } for item in instruments if item.get("windInstrumentCd")],
            "race_cd,wind_instrument_cd",
        )

    @staticmethod
    def _deduplicate(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
        unique: dict[tuple[Any, ...], dict[str, Any]] = {}
        for row in rows:
            unique[tuple(row.get(key) for key in keys)] = row
        return list(unique.values())

    def _calculate_wind_metrics(
        self, athlete_rows: list[dict[str, Any]], wind_rows: list[dict[str, Any]]
    ) -> None:
        times = [row["captured_at_ms"] for row in wind_rows]
        freshness_ms = self.settings.wind_freshness_seconds * 1000
        for athlete in athlete_rows:
            if not times or athlete.get("sog_knots") is None or athlete.get("cog_degree") is None:
                continue
            at = athlete["captured_at_ms"]
            pos = bisect_left(times, at)
            candidates = [index for index in (pos - 1, pos) if 0 <= index < len(times)]
            nearest = min(candidates, key=lambda index: abs(times[index] - at))
            wind = wind_rows[nearest]
            if abs(wind["captured_at_ms"] - at) <= freshness_ms and wind.get("direction_degree") is not None:
                athlete.update(course_to_wind(
                    athlete["sog_knots"], athlete["cog_degree"], wind["direction_degree"]
                ))
                athlete["wind_reading_captured_at_ms"] = wind["captured_at_ms"]
