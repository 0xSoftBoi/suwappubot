"""Tests for the Atomiq BTC bridge (Starknet Phase 3) — httpx-mocked, no network."""

import hashlib
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from bot.config.settings import settings
from bot.models.btc_swap import BtcSwap
from bot.services.atomiq_api import AtomiqAPI
from bot.services.btc_bridge import AtomiqValidationError, BtcBridge, BtcBridgeError
from bot.services.btc_bridge_poller import MAX_CONSECUTIVE_FAILURES, BtcBridgePoller
from bot.utils.encryption import decrypt_private_key
from database.db import get_session


def _stub_starknet_py(monkeypatch):
    """Stub starknet_py modules (not installed in the test venv).

    Provides get_selector_from_name and a Call type compatible with the
    lazy imports inside BtcBridge._execute_invoke. Uses monkeypatch.setitem
    (restores ONLY these keys) rather than patch.dict, which would snapshot
    all of sys.modules and evict modules other tests imported meanwhile.
    """
    import sys
    import types
    from dataclasses import dataclass, field

    if "starknet_py" in sys.modules:  # real lib present — no stubbing needed
        return

    @dataclass
    class Call:
        to_addr: int
        selector: int
        calldata: list = field(default_factory=list)

    root = types.ModuleType("starknet_py")
    hash_mod = types.ModuleType("starknet_py.hash")
    selector_mod = types.ModuleType("starknet_py.hash.selector")
    selector_mod.get_selector_from_name = lambda name: int.from_bytes(name.encode(), "big")
    net_mod = types.ModuleType("starknet_py.net")
    client_models_mod = types.ModuleType("starknet_py.net.client_models")
    client_models_mod.Call = Call

    for name, mod in {
        "starknet_py": root,
        "starknet_py.hash": hash_mod,
        "starknet_py.hash.selector": selector_mod,
        "starknet_py.net": net_mod,
        "starknet_py.net.client_models": client_models_mod,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)


BASE = "https://atomiq.test"
WALLET_ADDR = "0x" + "ab" * 32
BOLT11 = "lnbc1500n1pj9test_invoice"


class FakeAtomiqServer:
    """Routes httpx requests to canned responses and records them."""

    def __init__(self):
        self.requests = []  # (method, path, params-or-json)
        self.routes = {}  # (method, path) -> callable(request) -> dict

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET":
            payload = dict(request.url.params)
        else:
            payload = json.loads(request.content.decode() or "{}")
        self.requests.append((request.method, path, payload))
        route = self.routes.get((request.method, path))
        if route is None:
            return httpx.Response(404, json={"error": f"no route {path}"})
        result = route(payload)
        if isinstance(result, httpx.Response):
            return result
        return httpx.Response(200, json=result)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler), base_url=BASE)


@pytest.fixture
def server():
    srv = FakeAtomiqServer()
    # Default benign routes
    srv.routes[("GET", "/getSwapLimits")] = lambda p: {
        "input": {"min": {"rawAmount": "100"}, "max": {"rawAmount": "2000000"}},
        "output": {"min": {"rawAmount": "1"}},
    }
    return srv


@pytest.fixture
def wallet():
    w = MagicMock()
    w.id = 1
    w.address = WALLET_ADDR
    return w


@pytest.fixture
def bridge(server, tmp_db, wallet):
    ws = MagicMock()
    ws.get_wallet_by_id.return_value = wallet
    ws.get_private_key.return_value = "0x1234"
    ws.ensure_starknet_deployed = AsyncMock()
    return BtcBridge(
        api=AtomiqAPI(base_url=BASE, client=server.client()),
        wallet_service=ws,
    )


def _create_swap_response(swap_id="swap-1", action=None, state=None):
    resp = {
        "swapId": swap_id,
        "swapType": "TEST",
        "state": state or {"number": 0, "name": "CREATED"},
        "quote": {
            "inputAmount": {"rawAmount": "1000"},
            "outputAmount": {"rawAmount": "990"},
            "fees": {"total": "10"},
        },
        "isFinished": False,
        "isSuccess": False,
        "isFailed": False,
        "isExpired": False,
    }
    if action:
        resp["currentAction"] = action
    return resp


def _send_to_address_action(invoice=BOLT11):
    return {"type": "SendToAddress", "txs": [{"address": invoice}]}


def _row(swap_id):
    with get_session() as session:
        row = session.query(BtcSwap).filter(BtcSwap.swap_id == swap_id).first()
        session.expunge(row)
        return row


# ---------------------------------------------------------------------------
# createSwap body shapes
# ---------------------------------------------------------------------------


class TestLightningDeposit:
    async def test_ln_in_body_has_payment_hash_and_invoice_returned(self, server, bridge, wallet):
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            action=_send_to_address_action()
        )
        result = await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=1500)

        body = next(p for m, path, p in server.requests if path == "/createSwap")
        assert body["srcToken"] == "LIGHTNING-BTC"
        assert body["dstToken"] == settings.btc_deposit_default_token
        assert body["amountType"] == "EXACT_IN"
        assert body["amount"] == "1500"
        assert body["dstAddress"] == WALLET_ADDR
        # paymentHash present and well-formed (sha256 hex, 64 chars)
        assert len(body["paymentHash"]) == 64
        int(body["paymentHash"], 16)
        assert result["invoice"] == BOLT11

    async def test_secret_encrypt_decrypt_roundtrip_matches_payment_hash(
        self, server, bridge, wallet
    ):
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            action=_send_to_address_action()
        )
        await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=1500)

        body = next(p for m, path, p in server.requests if path == "/createSwap")
        row = _row("swap-1")
        assert row.secret_encrypted
        secret_hex = decrypt_private_key(row.secret_encrypted, settings.encryption_key)
        assert hashlib.sha256(bytes.fromhex(secret_hex)).hexdigest() == body["paymentHash"]
        assert row.direction == "ln_in"
        assert row.invoice == BOLT11

    async def test_rejects_non_positive_amount(self, bridge, wallet):
        with pytest.raises(BtcBridgeError):
            await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=0)

    async def test_citrea_dst_chain_body_shape(self, server, bridge):
        """dst_chain='citrea' → dstToken CITREA-CBTC, dstAddress = EVM address,
        and the BtcSwap row records dst_chain."""
        evm_wallet = MagicMock()
        evm_wallet.id = 2
        evm_wallet.address = "0x" + "cd" * 20  # 20-byte EVM address
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            swap_id="swap-citrea-1", action=_send_to_address_action()
        )
        result = await bridge.start_lightning_deposit(
            user_id=7, wallet=evm_wallet, sats=1500, dst_chain="citrea"
        )

        body = next(p for m, path, p in server.requests if path == "/createSwap")
        assert body["srcToken"] == "LIGHTNING-BTC"
        assert body["dstToken"] == "CITREA-CBTC"
        assert body["dstAddress"] == evm_wallet.address
        assert result["invoice"] == BOLT11

        row = _row("swap-citrea-1")
        assert row.dst_chain == "citrea"
        assert row.dst_token == "CITREA-CBTC"
        assert row.dst_address == evm_wallet.address

    async def test_starknet_default_records_dst_chain(self, server, bridge, wallet):
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            swap_id="swap-stark-1", action=_send_to_address_action()
        )
        await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=1500)
        body = next(p for m, path, p in server.requests if path == "/createSwap")
        assert body["dstToken"] == settings.btc_deposit_default_token
        assert _row("swap-stark-1").dst_chain == "starknet"

    async def test_botanix_dst_chain_rejected(self, bridge, wallet):
        with pytest.raises(BtcBridgeError, match="Botanix"):
            await bridge.start_lightning_deposit(
                user_id=7, wallet=wallet, sats=1500, dst_chain="botanix"
            )

    async def test_botanix_dst_token_rejected(self, bridge, wallet):
        with pytest.raises(BtcBridgeError, match="Botanix"):
            await bridge.start_lightning_deposit(
                user_id=7, wallet=wallet, sats=1500, dst_token="BOTANIX-BBTC"
            )

    async def test_unknown_dst_chain_rejected(self, bridge, wallet):
        with pytest.raises(BtcBridgeError, match="Unsupported deposit destination"):
            await bridge.start_lightning_deposit(
                user_id=7, wallet=wallet, sats=1500, dst_chain="dogechain"
            )


class TestWithdrawals:
    async def test_btc_out_body_shape(self, server, bridge, wallet):
        server.routes[("GET", "/parseAddress")] = lambda p: {
            "address": p["address"],
            "type": "BITCOIN",
        }
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response("swap-btc")
        result = await bridge.start_withdrawal(
            user_id=7, wallet=wallet, destination="bc1qdest", sats=20_000
        )
        body = next(p for m, path, p in server.requests if path == "/createSwap")
        assert body["dstToken"] == "BITCOIN-BTC"
        assert body["amountType"] == "EXACT_OUT"
        assert body["amount"] == "20000"
        assert body["srcAddress"] == WALLET_ADDR
        assert body["dstAddress"] == "bc1qdest"
        assert result["direction"] == "btc_out"
        assert "paymentHash" not in body

    async def test_btc_out_enforces_min_sats(self, server, bridge, wallet):
        server.routes[("GET", "/parseAddress")] = lambda p: {"type": "BITCOIN"}
        with pytest.raises(BtcBridgeError, match="11,?548|at least"):
            await bridge.start_withdrawal(user_id=7, wallet=wallet, destination="bc1q", sats=100)

    async def test_ln_out_exact_out_without_amount(self, server, bridge, wallet):
        server.routes[("GET", "/parseAddress")] = lambda p: {"type": "LIGHTNING"}
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response("swap-ln")
        result = await bridge.start_withdrawal(user_id=7, wallet=wallet, destination=BOLT11)
        body = next(p for m, path, p in server.requests if path == "/createSwap")
        assert body["dstToken"] == "LIGHTNING-BTC"
        assert body["amountType"] == "EXACT_OUT"
        assert "amount" not in body  # BOLT11 encodes the amount
        assert result["direction"] == "ln_out"

    async def test_unsupported_destination_type_raises(self, server, bridge, wallet):
        server.routes[("GET", "/parseAddress")] = lambda p: {"type": "STARKNET"}
        with pytest.raises(BtcBridgeError, match="Unsupported"):
            await bridge.start_withdrawal(user_id=7, wallet=wallet, destination="0xabc", sats=20000)


# ---------------------------------------------------------------------------
# advance_swap: terminal mapping, secret reveal, smart-chain execution
# ---------------------------------------------------------------------------


async def _seed_ln_in(server, bridge, wallet) -> int:
    server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
        action=_send_to_address_action()
    )
    result = await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=1500)
    return result["btc_swap_id"]


class TestAdvanceSwap:
    async def test_terminal_success_state_mapped(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: {
            **_create_swap_response(state={"number": 3, "name": "CLAIM_CLAIMED"}),
            "isFinished": True,
            "isSuccess": True,
        }
        assert await bridge.advance_swap(btc_swap_id) is None
        row = _row("swap-1")
        assert row.finished is True
        assert row.success is True
        assert row.state == "CLAIM_CLAIMED"
        assert row.atomiq_state_num == 3
        # Finished swaps are not polled again
        assert await bridge.advance_swap(btc_swap_id) is None

    async def test_terminal_failure_state_mapped(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: {
            **_create_swap_response(state={"number": -1, "name": "EXPIRED"}),
            "isFinished": True,
            "isSuccess": False,
            "isExpired": True,
        }
        await bridge.advance_swap(btc_swap_id)
        row = _row("swap-1")
        assert row.finished is True
        assert row.success is False

    async def test_secret_reveal_passes_decrypted_preimage(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        create_body = next(p for m, path, p in server.requests if path == "/createSwap")

        def status(p):
            if "secret" in p:
                return {
                    **_create_swap_response(state={"number": 3, "name": "CLAIM_CLAIMED"}),
                    "isFinished": True,
                    "isSuccess": True,
                }
            return {
                **_create_swap_response(state={"number": 1, "name": "PR_PAID"}),
                "requiresSecretReveal": True,
            }

        server.routes[("GET", "/getSwapStatus")] = status
        assert await bridge.advance_swap(btc_swap_id) is None

        reveal = next(
            p for m, path, p in server.requests if path == "/getSwapStatus" and "secret" in p
        )
        # The revealed preimage hashes to the paymentHash we registered
        assert (
            hashlib.sha256(bytes.fromhex(reveal["secret"])).hexdigest()
            == create_body["paymentHash"]
        )

    async def test_wait_action_respects_poll_time(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: {
            **_create_swap_response(state={"number": 1, "name": "PR_PAID"}),
            "currentAction": {"type": "Wait", "expectedTimeSeconds": 60, "pollTimeSeconds": 7},
        }
        assert await bridge.advance_swap(btc_swap_id) == 7.0

    async def test_smart_chain_action_builds_calls_and_executes(
        self, server, bridge, wallet, monkeypatch
    ):
        server.routes[("GET", "/parseAddress")] = lambda p: {"type": "BITCOIN"}
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response("swap-btc")
        result = await bridge.start_withdrawal(
            user_id=7, wallet=wallet, destination="bc1qdest", sats=20_000
        )
        server.routes[("GET", "/getSwapStatus")] = lambda p: {
            **_create_swap_response("swap-btc", state={"number": 0, "name": "CREATED"}),
            "currentAction": {
                "type": "SignSmartChainTransaction",
                "txs": [
                    {
                        "type": "INVOKE",
                        "tx": {
                            "calls": [
                                {
                                    "contractAddress": "0x123",
                                    "entrypoint": "commit",
                                    "calldata": ["0x2", "10", "0xff"],
                                }
                            ]
                        },
                    }
                ],
            },
        }

        account = MagicMock()
        receipt = MagicMock()
        receipt.transaction_hash = 0xDEAD
        account.execute_v3 = AsyncMock(return_value=receipt)
        _stub_starknet_py(monkeypatch)
        with patch(
            "bot.services.starknet.client.get_starknet_account",
            new=AsyncMock(return_value=account),
        ):
            next_poll = await bridge.advance_swap(result["btc_swap_id"])

        assert next_poll == 5.0  # quick re-poll after on-chain execution
        account.execute_v3.assert_awaited_once()
        calls = account.execute_v3.await_args.kwargs["calls"]
        assert calls[0].to_addr == 0x123
        assert list(calls[0].calldata) == [2, 10, 255]
        assert account.execute_v3.await_args.kwargs["auto_estimate"] is True
        # tx hash persisted with the server state (idempotency record), no
        # submitTransaction round-trip for smart-chain actions
        row = _row("swap-btc")
        assert json.loads(row.tx_hashes) == [{"tx_hash": hex(0xDEAD), "atomiq_state_num": 0}]
        assert not any(path == "/submitTransaction" for m, path, p in server.requests)
        # The escrow contract is pinned for the swap's lifetime
        assert int(row.escrow_address, 16) == 0x123

    def test_parse_invoke_calls_hex_and_decimal(self):
        calls = BtcBridge.parse_invoke_calls(
            {"calls": [{"to": "0x10", "selector": "0x20", "calldata": ["5", "0x6"]}]}
        )
        assert calls == [{"to": 16, "entrypoint": None, "selector": 32, "calldata": [5, 6]}]

    def test_parse_invoke_calls_missing_target_raises(self):
        with pytest.raises(BtcBridgeError):
            BtcBridge.parse_invoke_calls({"calls": [{"entrypoint": "commit"}]})


# ---------------------------------------------------------------------------
# Poller
# ---------------------------------------------------------------------------


class TestPoller:
    async def test_poll_once_advances_and_stops_on_terminal(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        poller = BtcBridgePoller(bridge=bridge, interval=0.01)

        server.routes[("GET", "/getSwapStatus")] = lambda p: {
            **_create_swap_response(state={"number": 3, "name": "CLAIM_CLAIMED"}),
            "isFinished": True,
            "isSuccess": True,
        }
        assert await poller.poll_once() == 1
        assert _row("swap-1").finished is True
        # Terminal swap is no longer picked up
        assert await poller.poll_once() == 0
        assert btc_swap_id  # silence unused warning

    async def test_poll_once_isolates_per_swap_errors(self, server, bridge, wallet):
        await _seed_ln_in(server, bridge, wallet)
        # Second swap
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            "swap-2", action=_send_to_address_action()
        )
        await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=2000)

        calls = []

        async def flaky_advance(btc_swap_id):
            calls.append(btc_swap_id)
            if len(calls) == 1:
                raise RuntimeError("boom")
            return None

        poller = BtcBridgePoller(bridge=bridge)
        with patch.object(bridge, "advance_swap", side_effect=flaky_advance):
            assert await poller.poll_once() == 2
        assert len(calls) == 2  # second swap still advanced despite first failing

    async def test_poller_gives_up_after_consecutive_failures_and_notifies(
        self, server, bridge, wallet
    ):
        from bot.models.user import User

        with get_session() as session:
            user = User(telegram_id=4242)
            session.add(user)
            session.flush()
            user_id = user.id
        server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(
            "swap-giveup", action=_send_to_address_action()
        )
        await bridge.start_lightning_deposit(user_id=user_id, wallet=wallet, sats=1500)

        poller = BtcBridgePoller(bridge=bridge)
        poller.bot = AsyncMock()
        with patch.object(bridge, "advance_swap", side_effect=RuntimeError("rpc down")):
            for _ in range(MAX_CONSECUTIVE_FAILURES):
                await poller.poll_once()

        row = _row("swap-giveup")
        assert row.finished is True
        assert row.success is False
        assert row.last_error == "gave up after repeated errors"
        poller.bot.send_message.assert_awaited_once()
        text = poller.bot.send_message.await_args.kwargs["text"]
        assert "failed" in text
        assert "completed" not in text
        # Abandoned swap is no longer polled
        assert await poller.poll_once() == 0


# ---------------------------------------------------------------------------
# Smart-chain call validation
# ---------------------------------------------------------------------------


def _smart_chain_status(swap_id, state_num, calls, state_name="CREATED"):
    return {
        **_create_swap_response(swap_id, state={"number": state_num, "name": state_name}),
        "currentAction": {
            "type": "SignSmartChainTransaction",
            "txs": [{"type": "INVOKE", "tx": {"calls": calls}}],
        },
    }


async def _seed_btc_out(server, bridge, wallet, swap_id="swap-btc", sats=20_000) -> int:
    server.routes[("GET", "/parseAddress")] = lambda p: {"type": "BITCOIN"}
    server.routes[("POST", "/createSwap")] = lambda p: _create_swap_response(swap_id)
    result = await bridge.start_withdrawal(
        user_id=7, wallet=wallet, destination="bc1qdest", sats=sats
    )
    return result["btc_swap_id"]


def _mock_account(tx_hash=0xDEAD):
    account = MagicMock()
    receipt = MagicMock()
    receipt.transaction_hash = tx_hash
    account.execute_v3 = AsyncMock(return_value=receipt)
    return account


class TestCallValidation:
    async def test_rejects_unknown_to_for_non_approve(self, server, bridge, wallet):
        btc_swap_id = await _seed_btc_out(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: _smart_chain_status(
            "swap-btc",
            0,
            [{"contractAddress": "0x999", "entrypoint": "transfer", "calldata": ["0x1", "5", "0"]}],
        )
        with pytest.raises(AtomiqValidationError, match="not in the allowed escrow set"):
            await bridge.advance_swap(btc_swap_id)
        # Nothing executed, nothing recorded
        assert _row("swap-btc").tx_hashes is None

    async def test_rejects_approve_amount_above_tolerance(self, server, bridge, wallet):
        from bot.config.starknet_addresses import WBTC

        row = {
            "id": 1,
            "swap_id": "swap-x",
            "amount_raw": "20000",
            "src_token": "STARKNET-WBTC",
            "dst_token": "BITCOIN-BTC",
            "escrow_address": None,
        }
        approve = {
            "to": int(WBTC, 16),
            "entrypoint": "approve",
            "selector": None,
            "calldata": [0x1, 20_401, 0],  # 20000 * 1.02 = 20400 < 20401
        }
        with pytest.raises(AtomiqValidationError, match="exceeds"):
            await bridge._validate_calls(row, [approve])
        # Exactly at the 2% tolerance is accepted
        approve_ok = {**approve, "calldata": [0x1, 20_400, 0]}
        await bridge._validate_calls(row, [approve_ok])

    async def test_rejects_approve_to_unknown_token_contract(self, server, bridge, wallet):
        row = {
            "id": 1,
            "swap_id": "swap-x",
            "amount_raw": "20000",
            "src_token": "STARKNET-WBTC",
            "dst_token": "BITCOIN-BTC",
            "escrow_address": None,
        }
        approve = {"to": 0xBAD, "entrypoint": "approve", "selector": None, "calldata": [1, 5, 0]}
        with pytest.raises(AtomiqValidationError, match="unknown\\s+token contract"):
            await bridge._validate_calls(row, [approve])

    async def test_rejects_escrow_address_change_mid_swap(self, server, bridge, wallet):
        row = {
            "id": 1,
            "swap_id": "swap-x",
            "amount_raw": "20000",
            "src_token": "STARKNET-WBTC",
            "dst_token": "BITCOIN-BTC",
            "escrow_address": "0x123",
        }
        claim = {"to": 0x456, "entrypoint": "claim", "selector": None, "calldata": []}
        with pytest.raises(AtomiqValidationError, match="changed"):
            await bridge._validate_calls(row, [claim])

    async def test_accepts_legit_commit_then_claim_sequence(
        self, server, bridge, wallet, monkeypatch
    ):
        btc_swap_id = await _seed_btc_out(server, bridge, wallet)
        statuses = {
            "phase": 0,
        }

        def status(p):
            if statuses["phase"] == 0:
                return _smart_chain_status(
                    "swap-btc",
                    0,
                    [{"contractAddress": "0x123", "entrypoint": "commit", "calldata": ["1"]}],
                )
            return _smart_chain_status(
                "swap-btc",
                1,
                [{"contractAddress": "0x123", "entrypoint": "claim", "calldata": ["2"]}],
                state_name="COMMITTED",
            )

        server.routes[("GET", "/getSwapStatus")] = status
        account = _mock_account()
        _stub_starknet_py(monkeypatch)
        with patch(
            "bot.services.starknet.client.get_starknet_account",
            new=AsyncMock(return_value=account),
        ):
            await bridge.advance_swap(btc_swap_id)
            statuses["phase"] = 1
            await bridge.advance_swap(btc_swap_id)

        assert account.execute_v3.await_count == 2
        entries = json.loads(_row("swap-btc").tx_hashes)
        assert [e["atomiq_state_num"] for e in entries] == [0, 1]

    async def test_idempotency_skips_reexecution_for_same_state(
        self, server, bridge, wallet, monkeypatch
    ):
        btc_swap_id = await _seed_btc_out(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: _smart_chain_status(
            "swap-btc",
            0,
            [{"contractAddress": "0x123", "entrypoint": "commit", "calldata": ["1"]}],
        )
        account = _mock_account()
        _stub_starknet_py(monkeypatch)
        with patch(
            "bot.services.starknet.client.get_starknet_account",
            new=AsyncMock(return_value=account),
        ):
            await bridge.advance_swap(btc_swap_id)
            await bridge.advance_swap(btc_swap_id)  # same state — must not re-execute

        assert account.execute_v3.await_count == 1
        assert len(json.loads(_row("swap-btc").tx_hashes)) == 1

    async def test_configured_allowlist_admits_contract(self, server, bridge, wallet, monkeypatch):
        monkeypatch.setattr(settings, "atomiq_escrow_contracts", "0x777, 0x888")
        row = {
            "id": 1,
            "swap_id": "swap-x",
            "amount_raw": "20000",
            "src_token": "STARKNET-WBTC",
            "dst_token": "BITCOIN-BTC",
            "escrow_address": None,
        }
        # Even a non-allowed entrypoint passes when the contract is allowlisted
        call = {"to": 0x777, "entrypoint": "anything", "selector": None, "calldata": []}
        await bridge._validate_calls(row, [call])


# ---------------------------------------------------------------------------
# 4xx terminal handling + deposit limits
# ---------------------------------------------------------------------------


class TestClientErrorHandling:
    async def test_4xx_marks_swap_finished_failed(self, server, bridge, wallet):
        btc_swap_id = await _seed_ln_in(server, bridge, wallet)
        server.routes[("GET", "/getSwapStatus")] = lambda p: httpx.Response(
            400, json={"msg": "swap expired and pruned"}
        )
        assert await bridge.advance_swap(btc_swap_id) is None
        row = _row("swap-1")
        assert row.finished is True
        assert row.success is False
        assert "swap expired and pruned" in row.last_error
        # Not polled again
        assert await bridge.advance_swap(btc_swap_id) is None


class TestDepositLimits:
    async def test_deposit_below_min_raises_value_error_with_limits(self, server, bridge, wallet):
        with pytest.raises(ValueError, match="100.*2000000"):
            await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=50)

    async def test_deposit_above_max_raises_value_error_with_limits(self, server, bridge, wallet):
        with pytest.raises(ValueError, match="100.*2000000"):
            await bridge.start_lightning_deposit(user_id=7, wallet=wallet, sats=3_000_000)
