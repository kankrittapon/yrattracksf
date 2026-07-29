import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt

from .config import Settings
from .sailfish import SailfishClient

logger = logging.getLogger(__name__)

TokenSource = Literal["automatic", "environment", "unavailable"]


class LiveTokenProvider:
    """Caches the SailFish WebSocket live token so every collector shares one
    login/refresh cycle instead of racing each other.
    """

    def __init__(self, settings: Settings, sailfish: SailfishClient) -> None:
        self.settings = settings
        self.sailfish = sailfish
        self._lock = asyncio.Lock()
        self._token: str | None = None
        self._expires_at: datetime | None = None
        self._source: TokenSource = "unavailable"
        self._last_refresh_at: datetime | None = None
        self._last_error: str | None = None

    @property
    def expires_at(self) -> datetime | None:
        return self._expires_at

    @property
    def source(self) -> TokenSource:
        return self._source

    def _needs_refresh(self) -> bool:
        if not self._token:
            return True
        if self._expires_at is None:
            return False
        margin = timedelta(seconds=self.settings.sailfish_live_token_refresh_seconds)
        return datetime.now(UTC) >= (self._expires_at - margin)

    async def get_valid_token(self, race_cd: str) -> str:
        async with self._lock:
            if self._needs_refresh():
                await self._refresh_locked(race_cd)
            if not self._token:
                raise RuntimeError("Live token unavailable; see diagnostics()")
            return self._token

    async def refresh_token(self, race_cd: str) -> str:
        async with self._lock:
            await self._refresh_locked(race_cd)
            if not self._token:
                raise RuntimeError("Live token unavailable; see diagnostics()")
            return self._token

    async def _refresh_locked(self, race_cd: str) -> None:
        try:
            token = await self.sailfish.get_live_token(race_cd)
        except Exception:
            token = None
            self._last_error = "Automatic live token discovery failed"
            logger.warning("Live token discovery failed for race %s", race_cd, exc_info=True)

        if token:
            self._token = token
            self._source = "automatic"
            self._expires_at = self._decode_expiry(token)
            self._last_refresh_at = datetime.now(UTC)
            self._last_error = None
            return

        if self.settings.sailfish_live_token:
            self._token = self.settings.sailfish_live_token
            self._source = "environment"
            self._expires_at = None
            self._last_refresh_at = datetime.now(UTC)
            return

        self._token = None
        self._source = "unavailable"
        self._expires_at = None

    def invalidate(self, reason: str | None = None) -> None:
        self._token = None
        self._expires_at = None
        if reason:
            self._last_error = reason

    @staticmethod
    def _decode_expiry(token: str) -> datetime | None:
        try:
            claims = jwt.decode(token, options={"verify_signature": False, "verify_aud": False})
        except Exception:
            return None
        exp = claims.get("exp")
        if not exp:
            return None
        try:
            return datetime.fromtimestamp(float(exp), UTC)
        except (TypeError, ValueError):
            return None

    def diagnostics(self) -> dict[str, str | None]:
        return {
            "token_source": self._source,
            "token_expires_at": self._expires_at.isoformat() if self._expires_at else None,
            "last_token_refresh_at": self._last_refresh_at.isoformat() if self._last_refresh_at else None,
            "token_last_error": self._last_error,
        }
