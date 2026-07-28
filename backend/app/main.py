import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .collector import CollectorManager
from .config import get_settings
from .history import HistoryImportManager
from .repository import Repository
from .sailfish import SailfishClient
from .schemas import (
    ArmRequest,
    CollectorStatus,
    OverrideRequest,
    Principal,
    RaceClassVisibilityRequest,
    RaceSyncRequest,
)
from .security import control_rate_limit, require_admin

settings = get_settings()
logging.basicConfig(level=settings.log_level)


def _timestamp_iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric > 10_000_000_000:
        numeric /= 1000
    return datetime.fromtimestamp(numeric, UTC).isoformat()


async def _persist_races(repository: Repository, races: list[dict[str, Any]]) -> None:
    if not races:
        return
    first = races[0]
    match_cd = str(first.get("matchCd") or "")
    if not match_cd:
        return
    await repository.upsert(
        "matches",
        [{
            "match_cd": match_cd,
            "name": first.get("matchName") or match_cd,
            "raw_metadata": {"source": "admin_sync"},
        }],
        "match_cd",
    )
    classes: dict[str, dict[str, Any]] = {}
    normalized_races: list[dict[str, Any]] = []
    for race in races:
        race_cd = str(race.get("raceCd") or "")
        if not race_cd:
            continue
        level_cd = str(race.get("levelCd") or "")
        if level_cd:
            classes[level_cd] = {
                "level_cd": level_cd,
                "match_cd": match_cd,
                "name": race.get("raceName") or level_cd,
                "logo_url": race.get("levelClassifyLogo"),
                "raw_metadata": {"source": "admin_sync"},
            }
        normalized_races.append({
            "race_cd": race_cd,
            "match_cd": match_cd,
            "level_cd": level_cd or None,
            "name": race.get("raceName"),
            "rounds": race.get("rounds"),
            "group_name": race.get("groupName"),
            "sailfish_status": str(race.get("status") or ""),
            "start_at": _timestamp_iso(race.get("startTime")),
            "end_at": _timestamp_iso(race.get("endTime")),
            "raw_metadata": {"source": "admin_sync"},
            "tracked_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        })
    await repository.upsert("race_classes", list(classes.values()), "level_cd")
    await repository.upsert("races", normalized_races, "race_cd")


@asynccontextmanager
async def lifespan(app: FastAPI):
    repository = Repository(settings)
    sailfish = SailfishClient(settings)
    app.state.repository = repository
    app.state.sailfish = sailfish
    app.state.history = HistoryImportManager(settings, sailfish, repository)
    await app.state.history.start()
    app.state.collectors = CollectorManager(
        settings,
        sailfish,
        repository,
        app.state.history.schedule_after_finish,
    )
    active_races = await repository.select(
        "races",
        columns="race_cd",
        filters={"sailfish_status": "eq.50", "tracked_at": "not.is.null"},
    )
    for race in active_races:
        await app.state.collectors.get_or_create(str(race["race_cd"])).arm()
    yield
    await app.state.collectors.shutdown()
    await app.state.history.shutdown()
    await sailfish.close()
    await repository.close()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "sailfish-collector"}


@app.get("/races/discover", dependencies=[Depends(control_rate_limit)])
async def discover_races(principal: Principal = Depends(require_admin)):
    return {"items": await app.state.sailfish.discover_races()}


@app.post("/races/sync", dependencies=[Depends(control_rate_limit)])
async def sync_races(body: RaceSyncRequest, principal: Principal = Depends(require_admin)):
    races = await app.state.sailfish.sync_races(body.match_cd)
    source_by_cd = {str(race.get("raceCd")): race for race in races if race.get("raceCd")}
    race_codes = list(source_by_cd)
    details = await asyncio.gather(*(
        app.state.sailfish.get_admin_race(race_cd) for race_cd in race_codes
    ))
    merged = [
        {**source_by_cd[race_cd], **detail, "raceCd": detail.get("raceCd") or race_cd}
        for race_cd, detail in zip(race_codes, details, strict=True)
    ]
    active = [race for race in merged if str(race.get("status") or "") == "50"]
    await _persist_races(app.state.repository, active)
    collectors = []
    for race in active:
        race_cd = str(race["raceCd"])
        collectors.append(
            (await app.state.collectors.get_or_create(race_cd).arm()).model_dump(mode="json")
        )
    await app.state.repository.audit(principal.user_id, "races.sync", None, body.match_cd)
    return {"items": active, "collectors": collectors, "ignored_not_started": len(races) - len(active)}


@app.get("/history-imports")
async def list_history_imports(principal: Principal = Depends(require_admin)):
    return {
        "items": await app.state.repository.select(
            "history_imports", order="scheduled_for.desc", limit=100
        )
    }


@app.get("/history-imports/{race_cd}")
async def get_history_import(race_cd: str, principal: Principal = Depends(require_admin)):
    rows = await app.state.repository.select(
        "history_imports", filters={"race_cd": f"eq.{race_cd}"}, limit=1
    )
    if not rows:
        raise HTTPException(status_code=404, detail="History import not scheduled")
    return rows[0]


@app.post("/history-imports/{race_cd}/retry", dependencies=[Depends(control_rate_limit)])
async def retry_history_import(race_cd: str, principal: Principal = Depends(require_admin)):
    races = await app.state.repository.select(
        "races", columns="race_cd", filters={"race_cd": f"eq.{race_cd}"}, limit=1
    )
    if not races:
        raise HTTPException(status_code=404, detail="Race not found")
    await app.state.history.retry_now(race_cd)
    await app.state.repository.audit(principal.user_id, "history.retry", race_cd, None)
    return {"race_cd": race_cd, "status": "pending"}


@app.post("/race-classes/{level_cd}/visibility", dependencies=[Depends(control_rate_limit)])
async def set_race_class_visibility(
    level_cd: str,
    body: RaceClassVisibilityRequest,
    principal: Principal = Depends(require_admin),
):
    rows = await app.state.repository.select(
        "race_classes", columns="level_cd", filters={"level_cd": f"eq.{level_cd}"}, limit=1
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Race class not found")
    await app.state.repository.update(
        "race_classes",
        body.model_dump(),
        {"level_cd": level_cd},
    )
    await app.state.repository.audit(
        principal.user_id,
        "race_class.visibility",
        None,
        f"{level_cd}:live={body.public_live_enabled},history={body.public_history_enabled}",
    )
    return {"level_cd": level_cd, **body.model_dump()}


@app.get("/collectors", response_model=list[CollectorStatus])
async def list_collectors(principal: Principal = Depends(require_admin)):
    return [collector.status for collector in app.state.collectors.collectors.values()]


@app.get("/collectors/{race_cd}", response_model=CollectorStatus)
async def get_collector(race_cd: str, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    return collector.status


@app.post("/collectors/{race_cd}/arm", response_model=CollectorStatus, dependencies=[Depends(control_rate_limit)])
async def arm_collector(race_cd: str, body: ArmRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.get_or_create(race_cd)
    await app.state.repository.audit(principal.user_id, "collector.arm", race_cd, body.reason)
    return await collector.arm()


@app.post(
    "/collectors/{race_cd}/start-override",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit)],
)
async def start_override(race_cd: str, body: OverrideRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector or collector.status.state in {"idle", "completed", "error"}:
        raise HTTPException(status_code=409, detail="Arm the collector before manual start")
    await app.state.repository.audit(principal.user_id, "collector.start_override", race_cd, body.reason)
    return await collector.start_override()


@app.post("/collectors/{race_cd}/stop", response_model=CollectorStatus, dependencies=[Depends(control_rate_limit)])
async def stop_collector(race_cd: str, body: OverrideRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    await app.state.repository.audit(principal.user_id, "collector.stop", race_cd, body.reason)
    return await collector.stop()


@app.post("/collectors/{race_cd}/retry", response_model=CollectorStatus, dependencies=[Depends(control_rate_limit)])
async def retry_collector(race_cd: str, body: ArmRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.get_or_create(race_cd)
    await collector.stop()
    await app.state.repository.audit(principal.user_id, "collector.retry", race_cd, body.reason)
    return await collector.arm()


@app.get("/diagnostics/{race_cd}")
async def diagnostics(race_cd: str, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    return {
        "race_cd": race_cd,
        "collector": collector.status.model_dump(mode="json") if collector else None,
        "raw_retention_days": settings.raw_retention_days,
        "wind_freshness_seconds": settings.wind_freshness_seconds,
        "live_binary_decoder": "capture-only-until-schema-confirmed",
    }
