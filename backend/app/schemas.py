from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class CollectorState(StrEnum):
    IDLE = "idle"
    ARMED = "armed"
    WAITING_FOR_START = "waiting_for_start"
    RECORDING = "recording"
    FINISHING = "finishing"
    COMPLETED = "completed"
    ERROR = "error"


class ArmRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class OverrideRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class RaceSyncRequest(BaseModel):
    match_cd: str = Field(min_length=16, max_length=64)


class RaceClassVisibilityRequest(BaseModel):
    public_live_enabled: bool
    public_history_enabled: bool


class CollectorStatus(BaseModel):
    race_cd: str
    state: CollectorState
    websocket_connected: bool = False
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    last_message_at: datetime | None = None
    last_error: str | None = None
    messages_received: int = 0
    normalized_readings: int = 0
    reconnects: int = 0
    sailfish_status: str | None = None
    phase_source: str | None = None


class Principal(BaseModel):
    user_id: str
    email: str | None = None
    role: str
    claims: dict[str, Any] = Field(default_factory=dict)
