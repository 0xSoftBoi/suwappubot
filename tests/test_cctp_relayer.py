"""Tests for the CCTP -> HyperCore relayer state machine (fully mocked)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.services.cctp_relayer import CctpRelayer
from bot.services.cctp_hypercore import CctpAttestation

DEP = {
    "id": 1,
    "user_id": 42,
    "recipient": "0x1111111111111111111111111111111111111111",
    "from_chain": "arbitrum",
    "burn_tx_hash": "0xburn",
    "amount_raw": 100_000_000,
    "status": "burned",
}


def _relayer():
    r = CctpRelayer()
    # Stub the EVM/DB side effects; we assert on the state-machine flow.
    r._relayer_send = AsyncMock(return_value="0xmint")
    r._gas_drop = AsyncMock(return_value=None)
    r._user_credit = AsyncMock(return_value="0xcredit")
    r._set_status = MagicMock()
    r._notify = AsyncMock(return_value=None)
    return r


def test_is_enabled_requires_flag_and_key():
    r = CctpRelayer()
    with patch("bot.services.cctp_relayer.settings") as s:
        s.cctp_relayer_enabled = True
        s.cctp_relayer_private_key = "0xkey"
        assert r.is_enabled() is True
        s.cctp_relayer_private_key = None
        assert r.is_enabled() is False
        s.cctp_relayer_enabled = False
        s.cctp_relayer_private_key = "0xkey"
        assert r.is_enabled() is False


@pytest.mark.asyncio
async def test_burned_waits_when_attestation_incomplete():
    r = _relayer()
    incomplete = CctpAttestation(status="pending", message=None, attestation=None)
    with (
        patch("bot.services.cctp_relayer.rpc_manager.get_web3", MagicMock()),
        patch(
            "bot.services.cctp_relayer.cctp_hypercore.get_attestation",
            AsyncMock(return_value=incomplete),
        ),
    ):
        await r._advance(dict(DEP))
    # Nothing advanced: no mint, no status change.
    r._relayer_send.assert_not_awaited()
    r._set_status.assert_not_called()


@pytest.mark.asyncio
async def test_burned_completes_full_flow_when_attested():
    r = _relayer()
    complete = CctpAttestation(status="complete", message="0xmsg", attestation="0xatt")
    with (
        patch("bot.services.cctp_relayer.rpc_manager.get_web3", MagicMock()),
        patch(
            "bot.services.cctp_relayer.cctp_hypercore.get_attestation",
            AsyncMock(return_value=complete),
        ),
        patch(
            "bot.services.cctp_relayer.cctp_hypercore.build_receive_tx",
            MagicMock(return_value={"to": "0xmt", "data": "0x", "value": 0}),
        ),
    ):
        await r._advance(dict(DEP))

    # mint + gas-drop + credit + notify all happened, in order of status sets.
    r._relayer_send.assert_awaited_once()
    r._gas_drop.assert_awaited_once()
    r._user_credit.assert_awaited_once()
    r._notify.assert_awaited_once()
    statuses = [c.args[1] for c in r._set_status.call_args_list]
    assert statuses == ["minted", "credited"]


@pytest.mark.asyncio
async def test_minted_resumes_at_credit():
    r = _relayer()
    dep = dict(DEP, status="minted")
    with (
        patch("bot.services.cctp_relayer.rpc_manager.get_web3", MagicMock()),
        patch("bot.services.cctp_relayer.cctp_hypercore.get_attestation", AsyncMock()) as get_att,
    ):
        await r._advance(dep)
    # Already minted: no attestation poll, no mint; just credit + notify.
    get_att.assert_not_awaited()
    r._relayer_send.assert_not_awaited()
    r._user_credit.assert_awaited_once()
    statuses = [c.args[1] for c in r._set_status.call_args_list]
    assert statuses == ["credited"]


@pytest.mark.asyncio
async def test_failed_deposit_bumped_after_error():
    r = _relayer()
    # mint blows up -> _advance raises -> process_once bumps the error.
    r._relayer_send = AsyncMock(side_effect=RuntimeError("rpc down"))
    r._bump_error = MagicMock()
    complete = CctpAttestation(status="complete", message="0xmsg", attestation="0xatt")
    with (
        patch(
            "bot.services.cctp_relayer.CctpRelayer._pending", MagicMock(return_value=[dict(DEP)])
        ),
        patch("bot.services.cctp_relayer.rpc_manager.get_web3", MagicMock()),
        patch(
            "bot.services.cctp_relayer.cctp_hypercore.get_attestation",
            AsyncMock(return_value=complete),
        ),
        patch(
            "bot.services.cctp_relayer.cctp_hypercore.build_receive_tx",
            MagicMock(return_value={"to": "0xmt", "data": "0x", "value": 0}),
        ),
    ):
        await r.process_once()
    r._bump_error.assert_called_once()
    assert r._bump_error.call_args.args[0] == DEP["id"]
