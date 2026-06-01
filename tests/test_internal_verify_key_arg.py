"""Regression test for api/routes/internal.py auth call sites.

The endpoint handlers used to call `_verify_internal_key(x_internal_api_key)`,
referencing an undefined name (`x_internal_api_key`) while the handler parameter
is named `x_internal_key`. That raised NameError as soon as a handler body ran,
before any API-key validation could happen.

These tests call each endpoint handler directly with an *invalid* internal key.
- Before the fix: the body raises NameError (undefined `x_internal_api_key`).
- After the fix: `_verify_internal_key` runs and raises HTTPException(401),
  i.e. the validation logic actually executes and returns immediately.

We assert HTTPException(401) (NOT NameError), which fails pre-fix and passes
post-fix. A valid-key case is also included to confirm auth passes through.
"""

import os
import asyncio

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("INTERNAL_API_KEY", "correct-secret-key")

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from api.routes import internal as internal_routes


def _make_requests():
    sign_req = internal_routes.SignTransactionRequest(
        wallet_id=12345,
        unsigned_transaction={"hex": "deadbeef"},
        chain_type="evm",
    )
    verify_req = internal_routes.VerifyPaymentRequest(
        tx_hash="0xabc",
        chain="tempo",
        expected_amount="1.0",
        expected_token="pathUSD",
        expected_recipient="0xrecipient",
    )
    provision_req = internal_routes.AgentProvisionRequest(
        agent_uuid="uuid-1234-5678",
        chain_type="evm",
    )
    swap_req = internal_routes.AgentSwapRequest(
        agent_id=1,
        agent_uuid="uuid-1234-5678",
        wallet_address="0xwallet",
        internal_user_id=1,
        internal_wallet_id=1,
        chain_type="evm",
        quote_data={},
    )
    return sign_req, verify_req, provision_req, swap_req


# (handler-coroutine-factory, label) for each authenticated endpoint.
def _endpoint_cases(key):
    sign_req, verify_req, provision_req, swap_req = _make_requests()
    return [
        ("sign_transaction",
         lambda: internal_routes.sign_transaction(sign_req, x_internal_key=key)),
        ("verify_x402_payment",
         lambda: internal_routes.verify_x402_payment(verify_req, x_internal_key=key)),
        ("provision_agent_wallet",
         lambda: internal_routes.provision_agent_wallet(provision_req, x_internal_key=key)),
        ("execute_agent_swap",
         lambda: internal_routes.execute_agent_swap(swap_req, x_internal_key=key)),
    ]


@pytest.mark.parametrize("label", [
    "sign_transaction",
    "verify_x402_payment",
    "provision_agent_wallet",
    "execute_agent_swap",
])
def test_invalid_key_rejected_not_nameerror(label):
    """Each endpoint must reject a wrong key via HTTPException(401).

    Pre-fix, the handler body raises NameError before reaching the auth check,
    so this would surface as NameError instead of HTTPException.
    """
    cases = {lbl: factory for lbl, factory in _endpoint_cases("wrong-key")}
    factory = cases[label]
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(factory())
    assert exc_info.value.status_code == 401


def test_valid_key_passes_auth():
    """With the correct key, _verify_internal_key returns without raising.

    We call it directly (the shared helper used by every endpoint) to confirm
    the validation path completes successfully when the key matches.
    """
    # Returns None (no exception) on a matching key.
    assert internal_routes._verify_internal_key("correct-secret-key") is None


def test_valid_key_reaches_endpoint_body():
    """A valid key on sign_transaction passes auth and proceeds into the body.

    With auth satisfied, the handler queries for the wallet; we mock the DB to
    return no wallet, so it raises HTTPException(404) -- proving execution moved
    past the (previously broken) auth call without NameError.
    """
    from contextlib import contextmanager
    from unittest.mock import MagicMock

    fake_session = MagicMock()
    fake_session.query.return_value.filter.return_value.first.return_value = None

    @contextmanager
    def fake_get_session():
        yield fake_session

    sign_req, _, _, _ = _make_requests()
    with patch.object(internal_routes, "get_session", fake_get_session):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(
                internal_routes.sign_transaction(sign_req, x_internal_key="correct-secret-key")
            )
    assert exc_info.value.status_code == 404
