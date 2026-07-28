import json
from typing import Any

import httpx

from .config import Settings
from .decoder import decode_snapshot_result


class SailfishClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.http = httpx.AsyncClient(
            base_url=settings.sailfish_base_url.rstrip("/"),
            timeout=httpx.Timeout(20.0),
            headers={"Accept-Language": "en"},
        )
        self.access_token: str | None = None
        self.refresh_token: str | None = None

    async def close(self) -> None:
        await self.http.aclose()

    async def login(self) -> None:
        if not self.settings.sailfish_username or not self.settings.sailfish_password:
            return
        response = await self.http.post(
            "/sf-admin/api/admin-api/system/auth/login",
            headers={"tenant-id": self.settings.sailfish_tenant_id},
            json={
                "username": self.settings.sailfish_username,
                "password": self.settings.sailfish_password,
            },
        )
        response.raise_for_status()
        data = response.json().get("data") or response.json()
        self.access_token = data.get("accessToken")
        self.refresh_token = data.get("refreshToken")

    def _admin_headers(self) -> dict[str, str]:
        headers = {"tenant-id": self.settings.sailfish_tenant_id}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        return headers

    async def discover_races(self) -> list[dict[str, Any]]:
        if not self.access_token:
            await self.login()
        response = await self.http.get(
            "/sf-admin/api/admin-api/match/match/page",
            headers=self._admin_headers(),
            params={"orderByColumn": "matchStart", "isAsc": "descending", "pageNo": 1, "pageSize": 50},
        )
        response.raise_for_status()
        body = response.json().get("data") or {}
        return body.get("list") or body.get("records") or []

    async def sync_races(self, match_cd: str) -> list[dict[str, Any]]:
        if not self.access_token:
            await self.login()
        response = await self.http.get(
            "/sf-admin/api/admin-api/match/race/open/getRaceList",
            headers=self._admin_headers(),
            params={"pageSize": 10000, "pageNo": 1, "matchCd": match_cd, "openFlag": 1},
        )
        response.raise_for_status()
        body = response.json().get("data") or response.json()
        return body.get("list") or body.get("records") or body if isinstance(body, list) else []

    async def get_race(self, race_cd: str) -> dict[str, Any]:
        response = await self.http.get(
            "/sf-admin/api/app-api/match/race/getRace",
            params={"pageName": "open_trac", "raceCd": race_cd},
        )
        response.raise_for_status()
        body = response.json()
        return body.get("data") or body.get("result") or body

    async def get_snapshot(self, race_cd: str, at_ms: int) -> dict[str, Any]:
        response = await self.http.get(
            "/sf-admin/api/app-api/match/race/live2/getRaceDatas",
            params={"raceCd": race_cd, "time": at_ms},
        )
        response.raise_for_status()
        body = response.json()
        return decode_snapshot_result(body["result"])

    @staticmethod
    def find_live_token(value: Any) -> str | None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key.lower() in {"token", "livetoken", "wstoken", "websockettoken"} and isinstance(item, str):
                    return item
                found = SailfishClient.find_live_token(item)
                if found:
                    return found
        elif isinstance(value, list):
            for item in value:
                found = SailfishClient.find_live_token(item)
                if found:
                    return found
        return None

    def websocket_url(self, race: dict[str, Any]) -> str:
        token = self.settings.sailfish_live_token or self.find_live_token(race)
        if not token:
            raise RuntimeError("Live WebSocket token not found; set SAILFISH_LIVE_TOKEN or capture getRace token field")
        base = self.settings.sailfish_base_url.replace("https://", "wss://").replace("http://", "ws://")
        return f"{base.rstrip('/')}/sailfish-ntwss?token={token}"
