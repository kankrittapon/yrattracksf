from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from .config import Settings


class Repository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.enabled = bool(settings.supabase_url and settings.supabase_service_role_key)
        self.http = httpx.AsyncClient(timeout=20)

    async def close(self) -> None:
        await self.http.aclose()

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.settings.supabase_service_role_key,
            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> None:
        if not self.enabled or not rows:
            return
        response = await self.http.post(
            f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{table}",
            params={"on_conflict": on_conflict},
            headers=self._headers("resolution=merge-duplicates,return=minimal"),
            json=rows,
        )
        response.raise_for_status()

    async def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not self.enabled or not rows:
            return
        response = await self.http.post(
            f"{self.settings.supabase_url.rstrip('/')}/rest/v1/{table}",
            headers=self._headers("return=minimal"),
            json=rows,
        )
        response.raise_for_status()

    async def store_raw(
        self,
        race_cd: str,
        topic: str | None,
        phase: str,
        payload: Any,
        received_at: datetime,
    ) -> None:
        await self.insert(
            "raw_messages",
            [{
                "race_cd": race_cd,
                "topic": topic,
                "phase": phase,
                "payload": payload,
                "received_at": received_at.isoformat(),
                "expires_at": (received_at + timedelta(days=self.settings.raw_retention_days)).isoformat(),
            }],
        )

    async def audit(self, user_id: str, action: str, race_cd: str | None, reason: str | None) -> None:
        await self.insert(
            "audit_logs",
            [{
                "actor_id": user_id,
                "action": action,
                "race_cd": race_cd,
                "reason": reason,
                "created_at": datetime.now(UTC).isoformat(),
            }],
        )

