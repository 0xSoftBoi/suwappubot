"""Tests for bot/services/api_client.py enterprise methods.

Tests the four enterprise methods on InternalAPIClient:
  - get_my_org: returns None on 404, dict on 200
  - get_org_members: returns list from response
  - get_org_api_keys: returns list from response
  - create_org_api_key: returns key dict

All HTTP calls are mocked — no network traffic.
"""

import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env so api_client module loads without crashing
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("INTERNAL_API_URL", "http://localhost:9999")
os.environ.setdefault("INTERNAL_API_KEY", "test-key")

from bot.services.api_client import InternalAPIClient, APIClientError

# ─── helpers ────────────────────────────────────────────────────────────────


def _make_client() -> InternalAPIClient:
    client = InternalAPIClient()
    client._base_url = "http://localhost:9999"
    client._api_key = "test-key"
    # Mark as initialised so _request doesn't call init()
    client._session = MagicMock()
    return client


# ─── get_my_org ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_org_returns_dict_on_200():
    """get_my_org returns the org dict when the API responds 200."""
    client = _make_client()
    expected = {"org": {"id": "org-1", "name": "Acme Corp", "slug": "acme"}, "role": "owner"}

    with patch.object(client, "_request", new=AsyncMock(return_value=expected)):
        result = await client.get_my_org(user_id=12345)

    assert result == expected
    assert result["org"]["id"] == "org-1"


@pytest.mark.asyncio
async def test_get_my_org_returns_none_on_404():
    """get_my_org swallows 404 and returns None (user has no org)."""
    client = _make_client()
    error_404 = APIClientError("not found", status=404, body={"error": "No organization found"})

    with patch.object(client, "_request", new=AsyncMock(side_effect=error_404)):
        result = await client.get_my_org(user_id=99999)

    assert result is None


@pytest.mark.asyncio
async def test_get_my_org_reraises_non_404_errors():
    """get_my_org propagates errors that are not 404 (e.g. 500)."""
    client = _make_client()
    error_500 = APIClientError("server error", status=500, body={"error": "Internal Server Error"})

    with patch.object(client, "_request", new=AsyncMock(side_effect=error_500)):
        with pytest.raises(APIClientError) as exc_info:
            await client.get_my_org(user_id=12345)

    assert exc_info.value.status == 500


# ─── get_org_members ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_org_members_returns_list_from_members_key():
    """get_org_members unwraps the 'members' key from the response dict."""
    client = _make_client()
    members = [
        {"id": "m1", "userId": 1, "role": "owner"},
        {"id": "m2", "userId": 2, "role": "admin"},
    ]
    response = {"members": members}

    with patch.object(client, "_request", new=AsyncMock(return_value=response)):
        result = await client.get_org_members(user_id=1, org_id="org-1")

    assert result == members
    assert len(result) == 2
    assert result[0]["role"] == "owner"


@pytest.mark.asyncio
async def test_get_org_members_returns_raw_list_if_response_is_list():
    """get_org_members handles a bare list response (forward compat)."""
    client = _make_client()
    members = [{"id": "m1", "userId": 1, "role": "member"}]

    with patch.object(client, "_request", new=AsyncMock(return_value=members)):
        result = await client.get_org_members(user_id=1, org_id="org-1")

    assert result == members


@pytest.mark.asyncio
async def test_get_org_members_calls_correct_endpoint():
    """get_org_members calls the /enterprise/orgs/{org_id}/members path."""
    client = _make_client()
    mock_request = AsyncMock(return_value={"members": []})

    with patch.object(client, "_request", new=mock_request):
        await client.get_org_members(user_id=42, org_id="org-abc")

    mock_request.assert_called_once_with(
        "GET",
        "/enterprise/orgs/org-abc/members",
        params={"telegram_id": 42},
    )


# ─── get_org_api_keys ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_org_api_keys_returns_list_from_keys_key():
    """get_org_api_keys unwraps the 'keys' key from the response dict."""
    client = _make_client()
    keys = [
        {"id": "k1", "name": "CI key", "keyPrefix": "sk_live_ab12"},
        {"id": "k2", "name": "Prod key", "keyPrefix": "sk_live_cd34"},
    ]
    response = {"keys": keys}

    with patch.object(client, "_request", new=AsyncMock(return_value=response)):
        result = await client.get_org_api_keys(user_id=1, org_id="org-1")

    assert result == keys
    assert result[0]["name"] == "CI key"


@pytest.mark.asyncio
async def test_get_org_api_keys_returns_raw_list_if_response_is_list():
    """get_org_api_keys handles bare list responses."""
    client = _make_client()
    keys = [{"id": "k1", "name": "key"}]

    with patch.object(client, "_request", new=AsyncMock(return_value=keys)):
        result = await client.get_org_api_keys(user_id=1, org_id="org-1")

    assert result == keys


@pytest.mark.asyncio
async def test_get_org_api_keys_calls_correct_endpoint():
    """get_org_api_keys calls /enterprise/orgs/{org_id}/api-keys."""
    client = _make_client()
    mock_request = AsyncMock(return_value={"keys": []})

    with patch.object(client, "_request", new=mock_request):
        await client.get_org_api_keys(user_id=7, org_id="org-xyz")

    mock_request.assert_called_once_with(
        "GET",
        "/enterprise/orgs/org-xyz/api-keys",
        params={"telegram_id": 7},
    )


# ─── create_org_api_key ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_org_api_key_returns_key_dict():
    """create_org_api_key returns the full response including rawKey."""
    client = _make_client()
    response = {
        "key": {
            "id": "k-new",
            "name": "Deploy key",
            "keyPrefix": "sk_live_ab12",
            "scopes": ["swap:read"],
            "createdAt": "2026-06-27T00:00:00.000Z",
        },
        "rawKey": "sk_live_ab12cdef1234567890abcdef1234567890",
    }

    with patch.object(client, "_request", new=AsyncMock(return_value=response)):
        result = await client.create_org_api_key(
            user_id=1, org_id="org-1", name="Deploy key", scopes=["swap:read"]
        )

    assert result == response
    assert "rawKey" in result
    assert result["key"]["name"] == "Deploy key"


@pytest.mark.asyncio
async def test_create_org_api_key_calls_correct_endpoint():
    """create_org_api_key POSTs to /enterprise/orgs/{org_id}/api-keys with correct body."""
    client = _make_client()
    mock_request = AsyncMock(return_value={"key": {}, "rawKey": "sk_live_xxx"})

    with patch.object(client, "_request", new=mock_request):
        await client.create_org_api_key(
            user_id=42, org_id="org-abc", name="My Key", scopes=["swap:read", "swap:write"]
        )

    mock_request.assert_called_once_with(
        "POST",
        "/enterprise/orgs/org-abc/api-keys",
        json_data={
            "telegram_id": 42,
            "name": "My Key",
            "scopes": ["swap:read", "swap:write"],
        },
    )


@pytest.mark.asyncio
async def test_create_org_api_key_propagates_403():
    """create_org_api_key propagates 403 when caller lacks admin role."""
    client = _make_client()
    error = APIClientError("Owner or admin role required", status=403)

    with patch.object(client, "_request", new=AsyncMock(side_effect=error)):
        with pytest.raises(APIClientError) as exc_info:
            await client.create_org_api_key(user_id=99, org_id="org-1", name="key", scopes=[])

    assert exc_info.value.status == 403


@pytest.mark.asyncio
async def test_create_org_api_key_empty_scopes():
    """create_org_api_key accepts empty scopes list."""
    client = _make_client()
    response = {"key": {"id": "k1", "name": "bare", "scopes": []}, "rawKey": "sk_live_abc"}

    mock_request = AsyncMock(return_value=response)
    with patch.object(client, "_request", new=mock_request):
        result = await client.create_org_api_key(user_id=1, org_id="org-1", name="bare", scopes=[])

    call_kwargs = mock_request.call_args[1]
    assert call_kwargs["json_data"]["scopes"] == []
    assert result["key"]["scopes"] == []
