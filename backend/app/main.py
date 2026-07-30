import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .archive import ArchiveManager
from .collector import CollectorManager
from .config import get_settings
from .history import HistoryImportManager
from .repository import Repository
from .sailfish import SailfishClient
from .tracker import TrackerMonitor
from .schemas import (
    ArmRequest,
    CollectorStatus,
    HistoryBatchRequest,
    MatchVisibilityRequest,
    MatchVisibilityScopeRequest,
    OverrideRequest,
    Principal,
    RaceClassVisibilityRequest,
    RaceSyncRequest,
)
from .security import control_rate_limit, public_rate_limit, require_admin, require_tailnet_source

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


async def _persist_matches(repository: Repository, matches: list[dict[str, Any]]) -> None:
    rows = []
    now = datetime.now(UTC).isoformat()
    for match in matches:
        match_cd = str(match.get("matchCd") or "")
        if not match_cd:
            continue
        rows.append({
            "match_cd": match_cd,
            "name": match.get("matchName") or match_cd,
            "starts_at": _timestamp_iso(match.get("matchStart")),
            "ends_at": _timestamp_iso(match.get("matchEnd")),
            "country": match.get("country"),
            "city": match.get("city"),
            "synced_at": now,
            "raw_metadata": {"source": "admin_discover"},
        })
    await repository.upsert("matches", rows, "match_cd")


async def _persist_races(repository: Repository, races: list[dict[str, Any]]) -> None:
    if not races:
        return
    first = races[0]
    match_cd = str(first.get("matchCd") or "")
    if not match_cd:
        return
    existing = await repository.select(
        "matches", columns="match_cd", filters={"match_cd": f"eq.{match_cd}"}, limit=1
    )
    if existing:
        await repository.update(
            "matches", {"synced_at": datetime.now(UTC).isoformat()}, {"match_cd": match_cd}
        )
    else:
        await _persist_matches(repository, [{
            "matchCd": match_cd,
            "matchName": first.get("matchName") or match_cd,
            "matchStart": first.get("matchStart"),
            "matchEnd": first.get("matchEnd"),
        }])
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
            "updated_at": datetime.now(UTC).isoformat(),
        })
    await repository.upsert("race_classes", list(classes.values()), "level_cd")
    await repository.upsert("races", normalized_races, "race_cd")


async def _arm_race(race_cd: str, actor_id: str, reason: str) -> CollectorStatus:
    collector = app.state.collectors.get_or_create(race_cd)
    await app.state.repository.update(
        "races",
        {"collection_enabled": True, "tracked_at": datetime.now(UTC).isoformat()},
        {"race_cd": race_cd},
    )
    await app.state.repository.audit(actor_id, "collector.arm", race_cd, reason)
    return await collector.arm()


@asynccontextmanager
async def lifespan(app: FastAPI):
    repository = Repository(settings)
    sailfish = SailfishClient(settings)
    app.state.repository = repository
    app.state.sailfish = sailfish
    app.state.history = HistoryImportManager(settings, sailfish, repository)
    await app.state.history.start()
    app.state.tracker_monitor = TrackerMonitor(settings, sailfish, repository)
    await app.state.tracker_monitor.start()
    app.state.archive = ArchiveManager(settings, repository)
    await app.state.archive.start()

    async def _on_race_finished(race_cd: str, race: dict[str, Any]) -> None:
        await app.state.history.schedule_after_finish(race_cd, race)

    app.state.collectors = CollectorManager(settings, sailfish, repository, on_finished=_on_race_finished)
    active_races = await repository.select(
        "races",
        columns="race_cd",
        filters={"sailfish_status": "eq.50", "collection_enabled": "eq.true"},
    )
    for race in active_races:
        await app.state.collectors.get_or_create(str(race["race_cd"])).arm()
    yield
    await app.state.collectors.shutdown()
    await app.state.archive.shutdown()
    await app.state.tracker_monitor.shutdown()
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
    matches = await app.state.sailfish.discover_races()
    await _persist_matches(app.state.repository, matches)
    await app.state.repository.audit(
        principal.user_id, "matches.discover", None, f"count={len(matches)}"
    )
    return {"items": matches, "total": len(matches)}


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
    waiting = [race for race in merged if str(race.get("status") or "") == "10"]
    finished = [race for race in merged if str(race.get("status") or "") == "99"]
    await _persist_races(app.state.repository, merged)
    armed_codes = [str(race["raceCd"]) for race in (*active, *waiting) if race.get("raceCd")]
    if armed_codes:
        await asyncio.gather(*(
            _arm_race(race_cd, principal.user_id, "auto_arm_on_sync") for race_cd in armed_codes
        ))
    await app.state.repository.audit(principal.user_id, "races.sync", None, body.match_cd)
    return {
        "items": merged,
        "active": active,
        "waiting": waiting,
        "finished": finished,
        "armed": armed_codes,
        "collectors": [],
        "history_imports": [],
    }


ARCHIVE_ATHLETE_QUERY = (
    "select id, race_cd, team_cd, team_name, sail_no, device_cd, nationality, "
    "captured_at_ms, received_at_ms, sog_knots, cog_degree, latitude, longitude, "
    "relative_signed_degree, relative_angle_degree, upwind_vmg_knots, vmc_knots, "
    "wind_reading_captured_at_ms, phase, created_at "
    "from athlete_readings where race_cd = $1 and team_cd = $2 "
    "order by captured_at_ms limit 10000"
)

PUBLIC_ARCHIVE_ATHLETE_QUERY = (
    "select a.team_cd, a.team_name, a.sail_no, a.nationality, a.captured_at_ms, "
    "a.sog_knots, a.cog_degree, w.speed_knots as wind_speed_knots, "
    "w.direction_degree as wind_direction_degree, a.relative_signed_degree, "
    "a.relative_angle_degree, a.upwind_vmg_knots, a.vmc_knots "
    "from athlete_readings a "
    "left join wind_readings w "
    "  on w.race_cd = a.race_cd and w.captured_at_ms = a.wind_reading_captured_at_ms "
    "where a.race_cd = $1 and a.team_cd = $2 "
    "  and ($3::bigint is null or a.captured_at_ms >= $3) "
    "  and ($4::bigint is null or a.captured_at_ms <= $4) "
    "  and ($5::int <= 1 or mod((a.captured_at_ms / 1000)::bigint, least(greatest($5::int, 1), 60)) = 0) "
    "order by a.captured_at_ms limit 10000"
)


async def _public_archived_race(race_cd: str) -> dict[str, Any] | None:
    """Mirrors get_public_athlete_history's visibility check for archived races."""
    races = await app.state.repository.select(
        "races",
        columns="race_cd,match_cd,level_cd,sailfish_status,archived_at",
        filters={"race_cd": f"eq.{race_cd}"},
        limit=1,
    )
    if not races:
        return None
    race = races[0]
    if str(race.get("sailfish_status") or "") != "99" or not race.get("archived_at"):
        return None
    matches = await app.state.repository.select(
        "matches", columns="is_public", filters={"match_cd": f"eq.{race['match_cd']}"}, limit=1
    )
    if not matches or not matches[0].get("is_public"):
        return None
    classes = await app.state.repository.select(
        "race_classes",
        columns="public_history_enabled",
        filters={"level_cd": f"eq.{race['level_cd']}"},
        limit=1,
    )
    if not classes or not classes[0].get("public_history_enabled"):
        return None
    return race


@app.get("/archive/athlete-history", dependencies=[Depends(control_rate_limit)])
async def archive_athlete_history(
    race_cd: str, team_cd: str, principal: Principal = Depends(require_admin)
):
    if not app.state.archive.pool:
        raise HTTPException(status_code=503, detail="Archive database unavailable")
    async with app.state.archive.pool.acquire() as connection:
        rows = await connection.fetch(ARCHIVE_ATHLETE_QUERY, race_cd, team_cd)
    return [dict(row) for row in rows]


@app.get("/public/archive/athlete-history", dependencies=[Depends(public_rate_limit)])
async def public_archive_athlete_history(
    race_cd: str,
    team_cd: str,
    from_ms: int | None = None,
    to_ms: int | None = None,
    sample_seconds: int = 1,
):
    if not await _public_archived_race(race_cd):
        raise HTTPException(status_code=404, detail="Race not available")
    if not app.state.archive.pool:
        raise HTTPException(status_code=503, detail="Archive database unavailable")
    async with app.state.archive.pool.acquire() as connection:
        rows = await connection.fetch(
            PUBLIC_ARCHIVE_ATHLETE_QUERY, race_cd, team_cd, from_ms, to_ms, sample_seconds
        )
    return [dict(row) for row in rows]


@app.get("/history-imports", dependencies=[Depends(control_rate_limit)])
async def list_history_imports(principal: Principal = Depends(require_admin)):
    return {
        "items": await app.state.repository.select(
            "history_imports", order="scheduled_for.desc", limit=100
        )
    }


@app.get("/history-imports/{race_cd}", dependencies=[Depends(control_rate_limit)])
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
        "races", columns="race_cd,sailfish_status", filters={"race_cd": f"eq.{race_cd}"}, limit=1
    )
    if not races:
        raise HTTPException(status_code=404, detail="Race not found")
    if str(races[0].get("sailfish_status") or "") != "99":
        raise HTTPException(status_code=409, detail="Race is not finished")
    await app.state.history.retry_now(race_cd)
    await app.state.repository.audit(principal.user_id, "history.retry", race_cd, None)
    return {"race_cd": race_cd, "status": "pending"}


@app.post("/history-imports/batch", dependencies=[Depends(control_rate_limit)])
async def batch_history_import(
    body: HistoryBatchRequest,
    principal: Principal = Depends(require_admin),
):
    unique_codes = list(dict.fromkeys(body.race_cds))
    races = await app.state.repository.select(
        "races",
        columns="race_cd,sailfish_status",
        filters={"race_cd": f"in.({','.join(unique_codes)})"},
        limit=100,
    )
    by_code = {str(item["race_cd"]): item for item in races}
    accepted: list[str] = []
    skipped: list[dict[str, str]] = []
    for race_cd in unique_codes:
        race = by_code.get(race_cd)
        if not race:
            skipped.append({"race_cd": race_cd, "reason": "ไม่พบรอบการแข่งขัน"})
        elif str(race.get("sailfish_status") or "") != "99":
            skipped.append({"race_cd": race_cd, "reason": "การแข่งขันยังไม่จบ"})
        else:
            await app.state.history.retry_now(race_cd)
            accepted.append(race_cd)
    await app.state.repository.audit(
        principal.user_id,
        "history.batch",
        None,
        f"accepted={len(accepted)},skipped={len(skipped)}",
    )
    return {"accepted": accepted, "skipped": skipped}


@app.post("/matches/{match_cd}/visibility", dependencies=[Depends(control_rate_limit)])
async def set_match_visibility(
    match_cd: str,
    body: MatchVisibilityRequest,
    principal: Principal = Depends(require_admin),
):
    rows = await app.state.repository.select(
        "matches", columns="match_cd", filters={"match_cd": f"eq.{match_cd}"}, limit=1
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Match not found")
    await app.state.repository.update("matches", {"is_public": body.is_public}, {"match_cd": match_cd})
    await app.state.repository.audit(
        principal.user_id,
        "match.visibility",
        None,
        f"{match_cd}:public={body.is_public}",
    )
    return {"match_cd": match_cd, "is_public": body.is_public}


@app.post("/matches/{match_cd}/public-scope", dependencies=[Depends(control_rate_limit)])
async def set_match_public_scope(
    match_cd: str,
    body: MatchVisibilityScopeRequest,
    principal: Principal = Depends(require_admin),
):
    matches = await app.state.repository.select(
        "matches", columns="match_cd", filters={"match_cd": f"eq.{match_cd}"}, limit=1
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Match not found")
    filters = {"match_cd": match_cd}
    if body.level_cd:
        classes = await app.state.repository.select(
            "race_classes",
            columns="level_cd",
            filters={"match_cd": f"eq.{match_cd}", "level_cd": f"eq.{body.level_cd}"},
            limit=1,
        )
        if not classes:
            raise HTTPException(status_code=404, detail="Race class not found in this match")
        filters["level_cd"] = body.level_cd
    await app.state.repository.update(
        "race_classes",
        {
            "public_live_enabled": body.is_public,
            "public_history_enabled": body.is_public,
        },
        filters,
    )
    if body.is_public or body.level_cd is None:
        await app.state.repository.update(
            "matches", {"is_public": body.is_public}, {"match_cd": match_cd}
        )
    elif body.level_cd:
        remaining = await app.state.repository.select(
            "race_classes",
            columns="level_cd",
            filters={
                "match_cd": f"eq.{match_cd}",
                "public_live_enabled": "eq.true",
            },
            limit=1,
        )
        if not remaining:
            await app.state.repository.update(
                "matches", {"is_public": False}, {"match_cd": match_cd}
            )
    scope = body.level_cd or "all"
    await app.state.repository.audit(
        principal.user_id,
        "match.public_scope",
        None,
        f"{match_cd}:scope={scope}:public={body.is_public}",
    )
    return {
        "match_cd": match_cd,
        "level_cd": body.level_cd,
        "is_public": body.is_public,
    }


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


@app.get(
    "/collectors",
    response_model=list[CollectorStatus],
    dependencies=[Depends(control_rate_limit)],
)
async def list_collectors(principal: Principal = Depends(require_admin)):
    return [collector.status for collector in app.state.collectors.collectors.values()]


@app.get(
    "/collectors/{race_cd}",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit)],
)
async def get_collector(race_cd: str, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    return collector.status


@app.post(
    "/collectors/{race_cd}/arm",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit), Depends(require_tailnet_source)],
)
async def arm_collector(race_cd: str, body: ArmRequest, principal: Principal = Depends(require_admin)):
    return await _arm_race(race_cd, principal.user_id, body.reason)


@app.post(
    "/collectors/{race_cd}/start-override",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit), Depends(require_tailnet_source)],
)
async def start_override(race_cd: str, body: OverrideRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector or collector.status.state in {"idle", "completed", "error"}:
        raise HTTPException(status_code=409, detail="Arm the collector before manual start")
    await app.state.repository.audit(principal.user_id, "collector.start_override", race_cd, body.reason)
    return await collector.start_override()


@app.post(
    "/collectors/{race_cd}/stop",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit), Depends(require_tailnet_source)],
)
async def stop_collector(race_cd: str, body: OverrideRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    await app.state.repository.update(
        "races", {"collection_enabled": False}, {"race_cd": race_cd}
    )
    await app.state.repository.audit(principal.user_id, "collector.stop", race_cd, body.reason)
    return await collector.stop()


@app.post(
    "/collectors/{race_cd}/retry",
    response_model=CollectorStatus,
    dependencies=[Depends(control_rate_limit), Depends(require_tailnet_source)],
)
async def retry_collector(race_cd: str, body: ArmRequest, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.get_or_create(race_cd)
    await collector.stop()
    await app.state.repository.update(
        "races",
        {"collection_enabled": True, "tracked_at": datetime.now(UTC).isoformat()},
        {"race_cd": race_cd},
    )
    await app.state.repository.audit(principal.user_id, "collector.retry", race_cd, body.reason)
    return await collector.arm()


@app.get("/diagnostics/{race_cd}", dependencies=[Depends(control_rate_limit)])
async def diagnostics(race_cd: str, principal: Principal = Depends(require_admin)):
    collector = app.state.collectors.collectors.get(race_cd)
    return {
        "race_cd": race_cd,
        "collector": collector.status.model_dump(mode="json") if collector else None,
        "live_token": app.state.collectors.token_provider.diagnostics(),
        "raw_retention_days": settings.raw_retention_days,
        "wind_freshness_seconds": settings.wind_freshness_seconds,
        "live_binary_decoder": "capture-only-until-schema-confirmed",
    }
