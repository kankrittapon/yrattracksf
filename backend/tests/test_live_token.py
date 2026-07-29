import time
from datetime import UTC, datetime, timedelta

import jwt

from app.config import Settings
from app.live_token import LiveTokenProvider


def _jwt(exp_seconds_from_now: float) -> str:
    payload = {"exp": time.time() + exp_seconds_from_now}
    return jwt.encode(payload, "unused-secret", algorithm="HS256")


class FakeSailfish:
    def __init__(self, tokens: list[str | Exception]) -> None:
        self.tokens = tokens
        self.calls = 0

    async def get_live_token(self, race_cd: str) -> str | None:
        self.calls += 1
        value = self.tokens[min(self.calls - 1, len(self.tokens) - 1)]
        if isinstance(value, Exception):
            raise value
        return value


def make_provider(tokens: list[str | Exception], **settings_overrides) -> tuple[LiveTokenProvider, FakeSailfish]:
    settings = Settings(_env_file=None, **settings_overrides)
    sailfish = FakeSailfish(tokens)
    return LiveTokenProvider(settings, sailfish), sailfish


async def test_returns_cached_token_without_refetching_when_not_expiring() -> None:
    token = _jwt(3600)
    provider, sailfish = make_provider([token])

    first = await provider.get_valid_token("race-1")
    second = await provider.get_valid_token("race-1")

    assert first == token
    assert second == token
    assert sailfish.calls == 1
    assert provider.source == "automatic"


async def test_refreshes_before_expiry_margin() -> None:
    near_expiry_token = _jwt(30)  # within default 60s refresh margin
    fresh_token = _jwt(3600)
    provider, sailfish = make_provider([near_expiry_token, fresh_token])

    first = await provider.get_valid_token("race-1")
    second = await provider.get_valid_token("race-1")

    assert first == near_expiry_token
    assert second == fresh_token
    assert sailfish.calls == 2


async def test_falls_back_to_environment_when_automatic_discovery_fails() -> None:
    provider, sailfish = make_provider(
        [RuntimeError("discovery failed")],
        sailfish_live_token="env-fallback-token",
    )

    token = await provider.get_valid_token("race-1")

    assert token == "env-fallback-token"
    assert provider.source == "environment"
    diagnostics = provider.diagnostics()
    assert diagnostics["token_source"] == "environment"
    assert "env-fallback-token" not in str(diagnostics)


async def test_unavailable_when_no_automatic_or_environment_token() -> None:
    provider, sailfish = make_provider([RuntimeError("discovery failed")])

    try:
        await provider.get_valid_token("race-1")
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "unused-secret" not in str(exc)
    assert provider.source == "unavailable"


async def test_invalidate_forces_refresh_on_next_call() -> None:
    token_a = _jwt(3600)
    token_b = _jwt(3600)
    provider, sailfish = make_provider([token_a, token_b])

    await provider.get_valid_token("race-1")
    provider.invalidate("simulated auth rejection")
    second = await provider.get_valid_token("race-1")

    assert second == token_b
    assert sailfish.calls == 2


async def test_concurrent_callers_trigger_only_one_login() -> None:
    import asyncio

    token = _jwt(3600)

    class SlowSailfish(FakeSailfish):
        async def get_live_token(self, race_cd: str) -> str | None:
            await asyncio.sleep(0.02)
            return await super().get_live_token(race_cd)

    settings = Settings(_env_file=None)
    sailfish = SlowSailfish([token])
    provider = LiveTokenProvider(settings, sailfish)

    results = await asyncio.gather(*(provider.get_valid_token("race-1") for _ in range(5)))

    assert all(result == token for result in results)
    assert sailfish.calls == 1


async def test_diagnostics_never_include_token_value() -> None:
    token = _jwt(3600)
    provider, sailfish = make_provider([token])
    await provider.get_valid_token("race-1")

    diagnostics = provider.diagnostics()

    assert token not in str(diagnostics)
    assert diagnostics["token_source"] == "automatic"
    assert diagnostics["token_expires_at"] is not None
