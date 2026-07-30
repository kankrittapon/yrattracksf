from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.security import require_tailnet_source


def _fake_request(*, forwarded: str | None = None, client_host: str | None = None):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    client = SimpleNamespace(host=client_host) if client_host else None
    return SimpleNamespace(headers=headers, client=client)


async def test_allows_tailscale_cgnat_address_via_forwarded_header() -> None:
    await require_tailnet_source(_fake_request(forwarded="100.101.102.103"))


async def test_allows_tailscale_cgnat_address_via_client_host() -> None:
    await require_tailnet_source(_fake_request(client_host="100.64.0.1"))


async def test_forwarded_header_takes_priority_over_client_host() -> None:
    await require_tailnet_source(_fake_request(forwarded="100.64.0.1", client_host="8.8.8.8"))


async def test_rejects_public_address() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await require_tailnet_source(_fake_request(client_host="8.8.8.8"))
    assert exc_info.value.status_code == 403


async def test_rejects_missing_address() -> None:
    with pytest.raises(HTTPException):
        await require_tailnet_source(_fake_request())


async def test_rejects_unparseable_address() -> None:
    with pytest.raises(HTTPException):
        await require_tailnet_source(_fake_request(forwarded="not-an-ip"))
