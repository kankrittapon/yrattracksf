import asyncio
import json
import logging
from datetime import UTC, datetime
from time import time
from typing import Any

import websockets

from .config import Settings
from .decoder import course_to_wind, decode_live_frame, normalize_team, normalize_wind
from .repository import Repository
from .sailfish import SailfishClient
from .schemas import CollectorState, CollectorStatus

logger = logging.getLogger(__name__)


class RaceCollector:
    def __init__(
        self,
        race_cd: str,
        settings: Settings,
        sailfish: SailfishClient,
        repository: Repository,
    ) -> None:
        self.race_cd = race_cd
        self.settings = settings
        self.sailfish = sailfish
        self.repository = repository
        self.status = CollectorStatus(race_cd=race_cd, state=CollectorState.IDLE)
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._force_recording = False
        self._race: dict[str, Any] = {}
        self._entity_types: dict[str, str] = {}

    async def arm(self) -> CollectorStatus:
        if self._task and not self._task.done():
            return self.status
        self.status = CollectorStatus(
            race_cd=self.race_cd,
            state=CollectorState.ARMED,
            started_at=datetime.now(UTC),
            phase_source="admin_arm",
        )
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name=f"collector:{self.race_cd}")
        return self.status

    async def start_override(self) -> CollectorStatus:
        self._force_recording = True
        self.status.state = CollectorState.RECORDING
        self.status.phase_source = "manual_override"
        await self._persist_status()
        return self.status

    async def stop(self, completed: bool = False) -> CollectorStatus:
        self.status.state = CollectorState.FINISHING
        self._stop.set()
        if self._task and self._task is not asyncio.current_task():
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except TimeoutError:
                self._task.cancel()
        self.status.state = CollectorState.COMPLETED if completed else CollectorState.IDLE
        self.status.stopped_at = datetime.now(UTC)
        self.status.websocket_connected = False
        await self._persist_status()
        return self.status

    async def _persist_status(self) -> None:
        await self.repository.upsert(
            "collector_status",
            [{
                "race_cd": self.race_cd,
                "state": self.status.state,
                "websocket_connected": self.status.websocket_connected,
                "sailfish_status": self.status.sailfish_status,
                "phase_source": self.status.phase_source,
                "last_message_at": self.status.last_message_at.isoformat() if self.status.last_message_at else None,
                "last_error": self.status.last_error,
                "messages_received": self.status.messages_received,
                "normalized_readings": self.status.normalized_readings,
                "reconnects": self.status.reconnects,
                "updated_at": datetime.now(UTC).isoformat(),
            }],
            "race_cd",
        )

    async def _bootstrap(self) -> None:
        self._race = await self.sailfish.get_race(self.race_cd)
        snapshot = await self.sailfish.get_snapshot(self.race_cd, int(time() * 1000))
        self.status.sailfish_status = str(snapshot.get("status") or self._race.get("status") or "")
        match_cd = str(snapshot.get("matchCd") or self._race.get("matchCd") or "")
        level_cd = str(snapshot.get("levelCd") or self._race.get("levelCd") or "")
        if match_cd:
            await self.repository.upsert(
                "matches",
                [{
                    "match_cd": match_cd,
                    "name": snapshot.get("matchName") or self._race.get("matchName") or match_cd,
                    "raw_metadata": {"source": "collector_bootstrap"},
                }],
                "match_cd",
            )
        if match_cd and level_cd:
            await self.repository.upsert(
                "race_classes",
                [{
                    "level_cd": level_cd,
                    "match_cd": match_cd,
                    "name": snapshot.get("levelName") or self._race.get("levelName") or level_cd,
                    "raw_metadata": {"source": "collector_bootstrap"},
                }],
                "level_cd",
            )
        if match_cd:
            await self.repository.upsert(
                "races",
                [{
                    "race_cd": self.race_cd,
                    "match_cd": match_cd,
                    "level_cd": level_cd or None,
                    "name": snapshot.get("raceName") or self._race.get("raceName"),
                    "rounds": snapshot.get("rounds") or self._race.get("rounds"),
                    "group_name": snapshot.get("groupName") or self._race.get("groupName"),
                    "sailfish_status": self.status.sailfish_status,
                    "raw_metadata": {"source": "collector_bootstrap"},
                }],
                "race_cd",
            )
        instruments = snapshot.get("windInstrumentList") or []
        main_instrument = next(
            (item for item in instruments if item.get("rollType") == "main"),
            instruments[0] if instruments else None,
        )
        main_wind = normalize_wind(main_instrument) if main_instrument else None
        for team in snapshot.get("teamList") or []:
            if team.get("teamCd"):
                self._entity_types[str(team["teamCd"]).lower()] = "athlete"
                await self.repository.upsert(
                    "teams",
                    [{
                        "race_cd": self.race_cd,
                        "team_cd": team["teamCd"],
                        "team_name": team.get("teamName"),
                        "sail_no": team.get("sailNo"),
                        "nationality": team.get("nationality"),
                        "team_area": team.get("teamArea"),
                        "device_cd": team.get("deviceCd"),
                        "race_team_color": team.get("raceTeamColor"),
                        "raw_metadata": {"source": "snapshot"},
                    }],
                    "race_cd,team_cd",
                )
            row = normalize_team(team)
            if (
                main_wind
                and row["captured_at_ms"]
                and main_wind["captured_at_ms"]
                and row["sog_knots"] is not None
                and row["cog_degree"] is not None
                and main_wind["direction_degree"] is not None
                and abs(row["captured_at_ms"] - main_wind["captured_at_ms"])
                    <= self.settings.wind_freshness_seconds * 1000
            ):
                row.update(course_to_wind(
                    row["sog_knots"],
                    row["cog_degree"],
                    main_wind["direction_degree"],
                ))
                row["wind_reading_captured_at_ms"] = main_wind["captured_at_ms"]
            if row["team_cd"] and row["captured_at_ms"]:
                await self.repository.upsert(
                    "athlete_readings",
                    [row],
                    "race_cd,team_cd,captured_at_ms",
                )
        for instrument in instruments:
            if instrument.get("windInstrumentCd"):
                self._entity_types[str(instrument["windInstrumentCd"]).lower()] = "wind"
                await self.repository.upsert(
                    "wind_instruments",
                    [{
                        "race_cd": self.race_cd,
                        "wind_instrument_cd": instrument["windInstrumentCd"],
                        "name": instrument.get("windInstrumentName"),
                        "device_cd": instrument.get("deviceCd"),
                        "roll_type": instrument.get("rollType"),
                        "is_main": instrument.get("rollType") == "main",
                        "raw_metadata": {"source": "snapshot"},
                    }],
                    "race_cd,wind_instrument_cd",
                )
            row = normalize_wind(instrument)
            if row["wind_instrument_cd"] and row["captured_at_ms"]:
                await self.repository.upsert(
                    "wind_readings",
                    [row],
                    "race_cd,wind_instrument_cd,captured_at_ms",
                )
        self.status.state = CollectorState.WAITING_FOR_START
        await self._persist_status()

    async def _run(self) -> None:
        try:
            await self._bootstrap()
            backoff = 1
            while not self._stop.is_set():
                try:
                    await self._consume()
                    backoff = 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.status.last_error = str(exc)
                    self.status.websocket_connected = False
                    self.status.reconnects += 1
                    logger.exception("Collector %s disconnected", self.race_cd)
                    try:
                        await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                    except TimeoutError:
                        pass
                    backoff = min(backoff * 2, 60)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.status.state = CollectorState.ERROR
            self.status.last_error = str(exc)
            logger.exception("Collector %s failed", self.race_cd)
        finally:
            self.status.websocket_connected = False
            if self.status.state == CollectorState.FINISHING:
                self.status.state = CollectorState.COMPLETED
                self.status.stopped_at = datetime.now(UTC)
            await self._persist_status()

    async def _consume(self) -> None:
        url = self.sailfish.websocket_url(self._race)
        async with websockets.connect(url, ping_interval=None, close_timeout=10) as socket:
            self.status.websocket_connected = True
            await self._persist_status()
            connected = json.loads(await socket.recv())
            if connected.get("v") != "CONNECTED":
                raise RuntimeError("Unexpected SailFish WebSocket greeting")
            topics = [
                f"/topic/SAIL_DATA_P_{self.race_cd}",
                f"/topic/BUOY_DATA_{self.race_cd}",
                f"/topic/RACE_CONTROL_{self.race_cd}",
            ]
            for topic in topics:
                await socket.send(json.dumps({"subscribe": topic}, separators=(",", ":")))

            heartbeat = asyncio.create_task(self._heartbeat(socket))
            polling = asyncio.create_task(self._poll_status())
            try:
                async for message in socket:
                    if self._stop.is_set():
                        break
                    await self._handle_message(str(message))
            finally:
                heartbeat.cancel()
                polling.cancel()
                self.status.websocket_connected = False

    async def _heartbeat(self, socket: Any) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(10)
            await socket.send("\n")

    async def _poll_status(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(self.settings.snapshot_interval_seconds)
            race = await self.sailfish.get_race(self.race_cd)
            status = str(race.get("status") or "")
            self.status.sailfish_status = status
            if status == "99":
                self.status.state = CollectorState.FINISHING
                self._stop.set()
                return

    async def _handle_message(self, message: str) -> None:
        now = datetime.now(UTC)
        self.status.last_message_at = now
        self.status.messages_received += 1
        frame = decode_live_frame(message)
        if frame.kind == "heartbeat":
            return
        phase = "recording" if self.status.state == CollectorState.RECORDING else "pre_start"
        await self.repository.store_raw(self.race_cd, None, phase, frame.payload, now)

        if frame.kind == "command" and isinstance(frame.payload, dict):
            value = str(frame.payload.get("v") or "")
            if "START" in value.upper():
                self.status.state = CollectorState.RECORDING
                self.status.phase_source = "race_control"
                await self._persist_status()
            elif any(item in value.upper() for item in ("FINISH", "END")):
                self.status.state = CollectorState.FINISHING
                self._stop.set()
                await self._persist_status()
            return

        if frame.kind == "binary":
            entity_type = next(
                (self._entity_types[item] for item in frame.entity_ids if item in self._entity_types),
                "unknown",
            )
            if entity_type == "unknown":
                await self.repository.insert(
                    "data_quality_events",
                    [{
                        "race_cd": self.race_cd,
                        "event_type": "unknown_binary_frame",
                        "severity": "warning",
                        "details": {"entity_ids": frame.entity_ids, "size": frame.payload["size"]},
                        "created_at": now.isoformat(),
                    }],
                )
        await self._persist_status()


class CollectorManager:
    def __init__(self, settings: Settings, sailfish: SailfishClient, repository: Repository) -> None:
        self.settings = settings
        self.sailfish = sailfish
        self.repository = repository
        self.collectors: dict[str, RaceCollector] = {}

    def get_or_create(self, race_cd: str) -> RaceCollector:
        if race_cd not in self.collectors:
            self.collectors[race_cd] = RaceCollector(race_cd, self.settings, self.sailfish, self.repository)
        return self.collectors[race_cd]

    async def shutdown(self) -> None:
        await asyncio.gather(
            *(collector.stop() for collector in self.collectors.values()),
            return_exceptions=True,
        )
