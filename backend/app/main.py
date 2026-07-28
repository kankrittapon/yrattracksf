import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .collector import CollectorManager
from .config import get_settings
from .repository import Repository
from .sailfish import SailfishClient
from .schemas import ArmRequest, CollectorStatus, OverrideRequest, Principal, RaceSyncRequest
from .security import control_rate_limit, require_admin

settings = get_settings()
logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    repository = Repository(settings)
    sailfish = SailfishClient(settings)
    app.state.repository = repository
    app.state.sailfish = sailfish
    app.state.collectors = CollectorManager(settings, sailfish, repository)
    yield
    await app.state.collectors.shutdown()
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
    await app.state.repository.audit(principal.user_id, "races.sync", None, body.match_cd)
    return {"items": races}


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
