import asyncio
import logging
from datetime import UTC, datetime
from time import time
from typing import Any

from .config import Settings
from .decoder import normalize_team
from .repository import Repository
from .sailfish import SailfishClient

logger = logging.getLogger(__name__)


def signal_status(
    captured_at_ms: int | None,
    now_ms: int,
    online_seconds: int,
    stale_seconds: int,
) -> str:
    if not captured_at_ms:
        return "offline"
    age_ms = max(0, now_ms - captured_at_ms)
    if age_ms <= online_seconds * 1000:
        return "online"
    if age_ms <= stale_seconds * 1000:
        return "stale"
    return "offline"


class TrackerMonitor:
    """Poll pre-start snapshots and publish GPS signal health without exposing positions."""

    def __init__(
        self,
        settings: Settings,
        sailfish: SailfishClient,
        repository: Repository,
    ) -> None:
        self.settings = settings
        self.sailfish = sailfish
        self.repository = repository
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if not self.repository.enabled or (self._task and not self._task.done()):
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="tracker-monitor")

    async def shutdown(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Tracker monitor cycle failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.settings.tracker_poll_seconds
                )
            except TimeoutError:
                pass

    async def poll_once(self) -> None:
        matches, classes, races = await asyncio.gather(
            self.repository.select(
                "matches", columns="match_cd", filters={"is_public": "eq.true"}
            ),
            self.repository.select(
                "race_classes",
                columns="level_cd,match_cd",
                filters={"public_live_enabled": "eq.true"},
            ),
            self.repository.select(
                "races",
                columns="race_cd,match_cd,level_cd,sailfish_status",
                filters={"sailfish_status": "in.(10,50)"},
            ),
        )
        public_matches = {str(item["match_cd"]) for item in matches}
        public_classes = {str(item["level_cd"]) for item in classes}
        monitored = [
            item for item in races
            if str(item.get("match_cd")) in public_matches
            and str(item.get("level_cd")) in public_classes
        ]
        if monitored:
            await asyncio.gather(*(
                self._poll_race(str(item["race_cd"])) for item in monitored
            ))

    async def _poll_race(self, race_cd: str) -> None:
        try:
            now_ms = int(time() * 1000)
            checked_at = datetime.now(UTC).isoformat()
            snapshot = await self.sailfish.get_snapshot(race_cd, now_ms)
            teams = [
                item for item in (snapshot.get("teamList") or [])
                if item.get("teamCd")
            ]
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
                    "raw_metadata": {"source": "tracker_monitor"},
                } for item in teams],
                "race_cd,team_cd",
            )
            states: list[dict[str, Any]] = []
            for team in teams:
                captured_at_ms = normalize_team(team).get("captured_at_ms")
                states.append({
                    "race_cd": race_cd,
                    "team_cd": str(team["teamCd"]),
                    "team_name": team.get("teamName"),
                    "sail_no": team.get("sailNo"),
                    "captured_at_ms": captured_at_ms,
                    "signal_status": signal_status(
                        captured_at_ms,
                        now_ms,
                        self.settings.tracker_online_seconds,
                        self.settings.tracker_stale_seconds,
                    ),
                    "checked_at": checked_at,
                })
            await self.repository.upsert_batches(
                "tracker_device_state", states, "race_cd,team_cd"
            )
            online = sum(item["signal_status"] == "online" for item in states)
            stale = sum(item["signal_status"] == "stale" for item in states)
            offline = len(states) - online - stale
            signals = [
                int(item["captured_at_ms"]) for item in states
                if item.get("captured_at_ms")
            ]
            await self.repository.upsert(
                "race_tracker_status",
                [{
                    "race_cd": race_cd,
                    "track_open": online > 0,
                    "total_gps": len(states),
                    "online_gps": online,
                    "stale_gps": stale,
                    "offline_gps": offline,
                    "last_signal_at_ms": max(signals) if signals else None,
                    "checked_at": checked_at,
                }],
                "race_cd",
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Tracker status poll failed for %s", race_cd)
