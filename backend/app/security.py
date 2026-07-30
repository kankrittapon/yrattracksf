import ipaddress
from functools import lru_cache
from time import monotonic

import jwt
import httpx
from fastapi import Depends, Header, HTTPException, Request, status
from jwt import PyJWKClient

from .config import Settings, get_settings
from .schemas import Principal

TAILSCALE_CGNAT = ipaddress.ip_network("100.64.0.0/10")


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def _decode_token(token: str, settings: Settings) -> dict:
    options = {"require": ["exp", "sub"], "verify_aud": False}
    try:
        if settings.supabase_jwt_secret:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], options=options)
        signing_key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            options=options,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from exc


async def require_principal(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    claims = _decode_token(authorization[7:], settings)
    app_metadata = claims.get("app_metadata") or {}
    # user_metadata is user-editable in Supabase and must never grant privileges.
    role = app_metadata.get("role") or "viewer"
    return Principal(
        user_id=str(claims["sub"]),
        email=claims.get("email"),
        role=str(role),
        claims=claims,
    )


async def require_admin(
    principal: Principal = Depends(require_principal),
    settings: Settings = Depends(get_settings),
) -> Principal:
    is_admin = principal.role == "admin"
    if settings.supabase_url and settings.supabase_service_role_key:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles",
                params={"id": f"eq.{principal.user_id}", "select": "role", "limit": "1"},
                headers={
                    "apikey": settings.supabase_service_role_key,
                    "Authorization": f"Bearer {settings.supabase_service_role_key}",
                },
            )
            if response.is_success:
                rows = response.json()
                is_admin = bool(rows and rows[0].get("role") == "admin")
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    principal.role = "admin"
    return principal


def _peer_address(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def require_tailnet_source(request: Request) -> None:
    """Restrict collector start/stop actions to requests arriving over the Tailscale network.

    Sync/discover/history-import stay reachable from the public internet (see
    planned scope), but arming or overriding a live collector remains
    Tailscale-only since auto-arm-on-sync already covers normal operation
    server-side. Checked via the connecting address falling in Tailscale's
    CGNAT range (100.64.0.0/10) - this needs live verification once Tailscale
    Funnel is enabled, since the exact header/address seen here depends on how
    Tailscale proxies the connection to the local process.
    """
    address = _peer_address(request)
    try:
        in_tailnet = address is not None and ipaddress.ip_address(address) in TAILSCALE_CGNAT
    except ValueError:
        in_tailnet = False
    if not in_tailnet:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires the Tailscale-connected admin console",
        )


class SimpleRateLimiter:
    def __init__(self, limit: int = 30, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = {}

    async def __call__(self, request: Request) -> None:
        key = request.client.host if request.client else "unknown"
        now = monotonic()
        recent = [item for item in self._requests.get(key, []) if now - item < self.window_seconds]
        if len(recent) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many control requests")
        recent.append(now)
        self._requests[key] = recent


control_rate_limit = SimpleRateLimiter()
