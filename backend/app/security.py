from functools import lru_cache
from time import monotonic

import jwt
import httpx
from fastapi import Depends, Header, HTTPException, Request, status
from jwt import PyJWKClient

from .config import Settings, get_settings
from .schemas import Principal


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
