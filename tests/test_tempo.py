"""Tests for Tempo (chain 4217) first-class native support.

Covers:
- bot/config/chains.py     — "tempo" ChainConfig (4217, native USD 6dp)
- bot/config/settings.py   — tempo native-feature flags (permit, sponsorship, slippage)
- bot/config/tokens.py     — Tempo TIP-20 stablecoins (pathUSD ...)
- bot/services/tempo_dex_api.py — is_supported_pair (stablecoin-only)
- bot/services/swap_engine.py   — Tempo-only routing, slippage on the enshrined-DEX
  quote, execute_swap hard guard (tempo pair → provider must be "tempo_dex"), and
  the _execute_tempo_dex_swap executor (approval + swap, legacy gas).
- bot/services/tempo_fee_sponsor.py — DB-backed sponsorship limits/budget.

All web3 / RPC / signing is mocked — no network.
"""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

# ---------------------------------------------------------------------------
# chain config
# ---------------------------------------------------------------------------

from bot.config.chains import CHAINS, ChainType, get_chain_by_id, get_chain_by_name  # noqa: E402


class TestTempoChainConfig:
    def test_tempo_present_and_evm(self):
        assert "tempo" in CHAINS
        assert CHAINS["tempo"].chain_type == ChainType.EVM

    def test_tempo_chain_id(self):
        assert CHAINS["tempo"].chain_id == 4217
        assert get_chain_by_id(4217).name == "tempo"

    def test_tempo_native_usd_6_decimals(self):
        # Tempo's native gas token is USD with 6 decimals (payments chain).
        assert CHAINS["tempo"].native_token == "USD"
        assert CHAINS["tempo"].native_decimals == 6

    def test_tempo_rpc_env_and_explorer(self):
        assert CHAINS["tempo"].rpc_url_env == "TEMPO_RPC_URL"
        assert "tempo.xyz" in CHAINS["tempo"].explorer_url

    def test_get_chain_by_name_case_insensitive(self):
        assert get_chain_by_name("Tempo").chain_id == 4217


class TestTempoTestnets:
    """Testnet registry is for tooling only — must NOT leak into the bot's
    user-selectable CHAINS, and must carry the real testnet chain IDs."""

    def test_moderato_and_andantino_present(self):
        from bot.config.chains import TEMPO_TESTNETS

        assert TEMPO_TESTNETS["moderato"]["chain_id"] == 42431
        assert TEMPO_TESTNETS["andantino"]["chain_id"] == 42429

    def test_testnets_not_in_user_facing_chains(self):
        # Testnets must never appear in the production chain picker.
        assert "moderato" not in CHAINS
        assert "andantino" not in CHAINS
        assert get_chain_by_id(42431) is None


class TestTempoSettings:
    def test_native_feature_flags_defaults(self):
        from bot.config.settings import settings

        # Permit (gasless approval) on by default; sponsorship off by default so
        # the bot never spends funds unexpectedly.
        assert settings.tempo_use_permit is True
        # tempo_fee_sponsor_enabled is the REAL gate read by
        # tempo_fee_sponsor.is_enabled(). The old `tempo_fee_sponsorship_enabled`
        # twin had no consumers and was removed — assert it stays gone so the
        # footgun cannot be reintroduced.
        assert settings.tempo_fee_sponsor_enabled is False
        assert not hasattr(settings, "tempo_fee_sponsorship_enabled")
        assert not hasattr(settings, "tempo_sponsor_address")
        assert settings.tempo_swap_slippage_pct == 0.1
        assert settings.tempo_sponsor_max_txs == 3
        assert settings.tempo_sponsor_daily_budget_usd == 100.0


# ---------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------

from bot.config.tokens import get_token_address, TOKENS  # noqa: E402


class TestTempoTokens:
    def test_pathusd_present_and_stablecoin(self):
        assert get_token_address("PATHUSD", "tempo") == (
            "0x20c0000000000000000000000000000000000000"
        )
        assert TOKENS["PATHUSD"].is_stablecoin is True

    def test_all_four_tip20_stablecoins(self):
        for sym in ("PATHUSD", "ALPHAUSD", "BETAUSD", "THETAUSD"):
            assert get_token_address(sym, "tempo")
            assert TOKENS[sym].is_stablecoin is True


# ---------------------------------------------------------------------------
# tempo_dex_api — enshrined DEX pair support
# ---------------------------------------------------------------------------

from bot.services.tempo_dex_api import tempo_dex_api, TempoDexQuote  # noqa: E402


class TestTempoDexSupportedPair:
    def test_stablecoin_pair_supported(self):
        assert tempo_dex_api.is_supported_pair("PATHUSD", "ALPHAUSD") is True

    def test_non_stablecoin_pair_unsupported(self):
        # WETH is not a stablecoin (and not on Tempo) — the enshrined DEX is
        # stablecoin-only.
        assert tempo_dex_api.is_supported_pair("PATHUSD", "WETH") is False


class TestTempoDexAbiGroundTruth:
    """Lock the on-chain ABI to tempoxyz/tempo-std reality. The enshrined DEX
    swapExactAmountIn takes (tokenIn, tokenOut, amountIn, minAmountOut) — 4 args,
    NO recipient — and market swaps settle directly to the wallet."""

    def test_dex_address_matches_tempo_std(self):
        assert tempo_dex_api.dex_address == "0xDEc0000000000000000000000000000000000000"

    def test_swap_calldata_uses_4arg_selector(self):
        from web3 import Web3

        expected = (
            "0x" + Web3.keccak(text="swapExactAmountIn(address,address,uint128,uint128)")[:4].hex()
        )
        # Encode offline with a provider-less Web3 (ABI encoding needs no RPC).
        with patch("bot.services.tempo_dex_api._get_tempo_web3", return_value=Web3()):
            bundle = tempo_dex_api.build_swap_tx(
                "PATHUSD", "ALPHAUSD", 1_000_000, 990_000, sender="0x" + "11" * 20
            )
        assert bundle["swap_tx"]["data"].startswith(expected)
        # approval targets the DEX as spender
        assert bundle["approval_tx"]["to"].lower().startswith("0x20c0")


class TestTempoTip20Endpoint:
    """The /internal/tempo/tip20/{address} endpoint surfaces TIP-20 metadata to
    api-ts / the bot on demand, and is gated by the internal API key."""

    def _client(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import api.routes.internal as internal

        monkeypatch.setenv("INTERNAL_API_KEY", "secret")
        app = FastAPI()
        app.include_router(internal.router)
        return TestClient(app)

    def test_requires_internal_key(self, monkeypatch):
        client = self._client(monkeypatch)
        r = client.get("/internal/tempo/tip20/0x20c0000000000000000000000000000000000000")
        assert r.status_code == 401

    def test_returns_tip20_metadata(self, monkeypatch):
        from bot.services.tempo_tip20 import TIP20Info

        client = self._client(monkeypatch)
        info = TIP20Info(
            address="0x20c0000000000000000000000000000000000000",
            name="Path USD",
            symbol="pathUSD",
            decimals=18,
            currency_code="USD",
            compliance_policy=None,
            is_tip20=True,
        )
        with patch(
            "bot.services.tempo_tip20.tempo_tip20.get_tip20_info",
            new=AsyncMock(return_value=info),
        ):
            r = client.get(
                "/internal/tempo/tip20/0x20c0000000000000000000000000000000000000",
                headers={"X-Internal-Key": "secret"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["currency_code"] == "USD"
        assert body["is_tip20"] is True
        assert body["symbol"] == "pathUSD"


class TestTempoTip20Memo:
    """transferWithMemo memo is a fixed bytes32 (verified vs ITIP20.sol)."""

    def test_encode_memo_pads_to_32_bytes(self):
        from bot.services.tempo_tip20 import tempo_tip20

        assert tempo_tip20.encode_memo("invoice-7") == b"invoice-7".ljust(32, b"\x00")
        assert tempo_tip20.encode_memo("") == b"\x00" * 32
        # Over-long memos are truncated to 32 bytes, never longer.
        assert len(tempo_tip20.encode_memo("x" * 100)) == 32

    def test_transfer_with_memo_uses_bytes32_selector(self):
        from web3 import Web3
        from bot.services.tempo_tip20 import tempo_tip20

        expected = "0x" + Web3.keccak(text="transferWithMemo(address,uint256,bytes32)")[:4].hex()
        with patch("bot.services.tempo_tip20._get_tempo_web3", return_value=Web3()):
            tx = tempo_tip20.build_transfer_with_memo(
                "0x20c0000000000000000000000000000000000000",
                "0x" + "22" * 20,
                1_000_000,
                "hello",
            )
        assert tx["data"].startswith(expected)


# ---------------------------------------------------------------------------
# swap_engine — Tempo routing + slippage
# ---------------------------------------------------------------------------


class TestTempoRouting:
    @pytest.fixture
    def engine(self):
        from bot.services.swap_engine import SwapEngine

        return SwapEngine.__new__(SwapEngine)

    def test_tempo_pair_is_tempo_only_swap(self, engine):
        assert engine._is_tempo_only_swap("tempo", "tempo") is True
        assert engine._is_tempo_only_swap("TEMPO", "Tempo") is True

    def test_tempo_to_evm_is_not_tempo_only(self, engine):
        assert engine._is_tempo_only_swap("tempo", "ethereum") is False
        assert engine._is_tempo_only_swap("ethereum", "tempo") is False

    def test_tempo_quote_applies_slippage(self, engine):
        """_get_tempo_dex_quote must set to_amount_min below to_amount per the
        configured tempo slippage (stablecoin pairs barely move but micro-drift
        between quote and execution must not revert the swap)."""
        amount_out = 1_000_000_000
        dex_quote = TempoDexQuote(
            token_in="PATHUSD",
            token_in_address="0x20c0000000000000000000000000000000000000",
            token_out="ALPHAUSD",
            token_out_address="0x20c0000000000000000000000000000000000001",
            amount_in=1_000_000_000,
            amount_out=amount_out,
            amount_in_human=1.0,
            amount_out_human=1.0,
            price_impact=0.0,
        )
        with patch(
            "bot.services.swap_engine.tempo_dex_api.get_quote",
            new=AsyncMock(return_value=dex_quote),
        ):
            quote = asyncio.run(
                engine._get_tempo_dex_quote("PATHUSD", "ALPHAUSD", 1.0, "1000000000", 0.5)
            )
        assert quote.provider == "tempo_dex"
        assert quote.from_chain == "tempo" and quote.to_chain == "tempo"
        # min(caller 0.5%, tempo default 0.1%) = 0.1% -> 0.999 * out
        assert int(quote.to_amount_min) == int(amount_out * (1 - 0.1 / 100))
        assert int(quote.to_amount_min) < int(quote.to_amount)


class TestTempoExecuteSwapGuard:
    """The hard guard at the START of execute_swap rejects any tempo same-chain
    quote whose provider is not 'tempo_dex' — before locks/DB/fund movement."""

    def _forged(self, provider, from_chain, to_chain):
        from bot.services.swap_engine import SwapQuote

        return SwapQuote(
            provider=provider,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token="PATHUSD",
            to_token="ALPHAUSD",
            from_amount="1000000000",
            from_amount_human=1.0,
            to_amount="999000000",
            to_amount_human=0.999,
            to_amount_min="999000000",
            gas_cost_usd=0.0,
            fee_cost_usd=0.0,
            total_cost_usd=0.0,
            estimated_time=2,
            price_impact=0.0,
            exchange_rate=0.999,
            raw_quote={},
        )

    def test_forged_lifi_tempo_quote_rejected(self):
        from bot.services.swap_engine import SwapEngine, SwapError

        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="Tempo swaps must route via the enshrined DEX"):
            asyncio.run(
                engine.execute_swap(
                    quote=self._forged("lifi", "tempo", "tempo"), wallet_id=1, user_id=1
                )
            )

    def test_forged_1inch_tempo_quote_rejected(self):
        from bot.services.swap_engine import SwapEngine, SwapError

        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="Tempo swaps must route via the enshrined DEX"):
            asyncio.run(
                engine.execute_swap(
                    quote=self._forged("1inch", "tempo", "tempo"), wallet_id=1, user_id=1
                )
            )


class TestTempoExecutor:
    """_execute_tempo_dex_swap: with permit disabled it sends an approval tx then
    the swap tx (both legacy-gas), returning the swap tx hash."""

    def _quote(self):
        from bot.services.swap_engine import SwapQuote

        return SwapQuote(
            provider="tempo_dex",
            from_chain="tempo",
            to_chain="tempo",
            from_token="PATHUSD",
            to_token="ALPHAUSD",
            from_amount="1000000000",
            from_amount_human=1.0,
            to_amount="999000000",
            to_amount_human=0.999,
            to_amount_min="998000000",
            gas_cost_usd=0.01,
            fee_cost_usd=0.0,
            total_cost_usd=0.01,
            estimated_time=2,
            price_impact=0.0,
            exchange_rate=0.999,
            raw_quote={
                "token_in": "0x20c0000000000000000000000000000000000000",
                "token_out": "0x20c0000000000000000000000000000000000001",
                "amount_in": 1_000_000_000,
                "amount_out": 999_000_000,
            },
        )

    def _mock_web3(self):
        w3 = MagicMock()
        w3.eth.get_transaction_count = MagicMock(return_value=7)
        w3.eth.gas_price = 1_000_000_000
        w3.eth.send_raw_transaction = MagicMock(return_value=bytes.fromhex("ab" * 32))
        w3.eth.wait_for_transaction_receipt = MagicMock(return_value={"status": 1})
        # estimate_gas left to raise (MagicMock*1.3 -> int() TypeError) so the
        # executor falls back to its default gas — exercises that path too.
        return w3

    def test_executor_approval_then_swap_no_permit(self, monkeypatch):
        from bot.services.swap_engine import SwapEngine
        from bot.config.settings import settings

        monkeypatch.setattr(settings, "tempo_use_permit", False)

        engine = SwapEngine.__new__(SwapEngine)
        w3 = self._mock_web3()

        wallet_obj = MagicMock()
        wallet_obj.is_turnkey_wallet = False
        engine._get_wallet_for_signing = AsyncMock(return_value=wallet_obj)
        engine._get_web3_with_fallback = MagicMock(return_value=w3)
        engine.wallet_service = MagicMock()
        engine.wallet_service.sign_evm_transaction = AsyncMock(return_value="0x" + "cd" * 60)

        bundle = {
            "approval_tx": {
                "to": "0x20c0000000000000000000000000000000000000",
                "data": "0x095ea7b3",
                "value": 0,
            },
            "swap_tx": {
                "to": "0xDEc0000000000000000000000000000000000000",
                "data": "0xdeadbeef",
                "value": 0,
            },
        }
        wallet_data = {"address": "0x1111111111111111111111111111111111111111"}

        with patch("bot.services.swap_engine.tempo_dex_api.build_swap_tx", return_value=bundle):
            tx_hash = asyncio.run(engine._execute_tempo_dex_swap(self._quote(), wallet_data, 99))

        assert tx_hash == ("ab" * 32)
        # approval + swap = two signed sends, two broadcasts
        assert engine.wallet_service.sign_evm_transaction.await_count == 2
        assert w3.eth.send_raw_transaction.call_count == 2
        # approval receipt awaited once
        assert w3.eth.wait_for_transaction_receipt.call_count == 1

    def test_executor_uses_permit_path(self, monkeypatch):
        """With permit enabled and a non-Turnkey wallet, the permit signature +
        permit/swap bundle are used and the permit tx replaces approve()."""
        from bot.services.swap_engine import SwapEngine
        from bot.config.settings import settings

        monkeypatch.setattr(settings, "tempo_use_permit", True)

        engine = SwapEngine.__new__(SwapEngine)
        w3 = self._mock_web3()

        wallet_obj = MagicMock()
        wallet_obj.is_turnkey_wallet = False
        engine._get_wallet_for_signing = AsyncMock(return_value=wallet_obj)
        engine._get_web3_with_fallback = MagicMock(return_value=w3)
        engine.wallet_service = MagicMock()
        engine.wallet_service.sign_evm_transaction = AsyncMock(return_value="0x" + "cd" * 60)
        engine.wallet_service.get_private_key = MagicMock(return_value="0x" + "11" * 32)

        permit_bundle = {
            "permit_tx": {
                "to": "0x20c0000000000000000000000000000000000000",
                "data": "0xd505accf",
                "value": 0,
            },
            "swap_tx": {
                "to": "0xDEc0000000000000000000000000000000000000",
                "data": "0xdeadbeef",
                "value": 0,
            },
        }
        swap_bundle = {
            "approval_tx": {"to": "0x20c0", "data": "0x095ea7b3", "value": 0},
            "swap_tx": permit_bundle["swap_tx"],
        }
        wallet_data = {"address": "0x1111111111111111111111111111111111111111"}

        with (
            patch("bot.services.swap_engine.tempo_dex_api.build_swap_tx", return_value=swap_bundle),
            patch(
                "bot.services.tempo_tip20.tempo_tip20.build_permit_signature",
                new=AsyncMock(return_value=(27, b"\x01" * 32, b"\x02" * 32, 1_999_999_999)),
            ),
            patch(
                "bot.services.swap_engine.tempo_dex_api.build_permit_swap_tx",
                return_value=permit_bundle,
            ) as mock_permit_build,
        ):
            tx_hash = asyncio.run(engine._execute_tempo_dex_swap(self._quote(), wallet_data, 99))

        assert tx_hash == ("ab" * 32)
        mock_permit_build.assert_called_once()
        # permit tx + swap tx = two signed sends
        assert engine.wallet_service.sign_evm_transaction.await_count == 2


# ---------------------------------------------------------------------------
# tempo_fee_sponsor — DB-backed limits/budget
# ---------------------------------------------------------------------------


class TestTempoFeeSponsor:
    def test_build_sponsored_tx_rejects_feepayer_equals_sender(self):
        from bot.services.tempo_fee_sponsor import TempoFeeSponsor

        sponsor = TempoFeeSponsor()
        addr = "0xAbC0000000000000000000000000000000000000"
        with pytest.raises(ValueError, match="fee payer cannot equal sender"):
            sponsor.build_sponsored_tx({"from": addr}, sponsor_address=addr)

    def test_constructor_reads_settings_defaults(self):
        from bot.services.tempo_fee_sponsor import TempoFeeSponsor
        from bot.config.settings import settings

        sponsor = TempoFeeSponsor()
        assert sponsor.max_sponsored_txs == settings.tempo_sponsor_max_txs
        assert sponsor.daily_budget_usd == settings.tempo_sponsor_daily_budget_usd

    def test_sponsorship_limit_persists_in_db(self, tmp_db):
        """check_sponsorship/record_sponsored_tx are DB-backed: after recording
        up to the per-user cap, sponsorship is denied."""
        from bot.services.tempo_fee_sponsor import TempoFeeSponsor

        sponsor = TempoFeeSponsor(max_sponsored_txs=2, daily_budget_usd=100.0)
        uid = 4217

        assert sponsor.check_sponsorship(uid).should_sponsor is True
        sponsor.record_sponsored_tx(uid, 0.001)
        sponsor.record_sponsored_tx(uid, 0.001)
        # cap reached -> denied, and a fresh instance (simulating restart) still sees it
        fresh = TempoFeeSponsor(max_sponsored_txs=2, daily_budget_usd=100.0)
        result = fresh.check_sponsorship(uid)
        assert result.should_sponsor is False
        assert result.remaining_txs == 0

    def test_daily_budget_enforced(self, tmp_db):
        from bot.services.tempo_fee_sponsor import TempoFeeSponsor

        sponsor = TempoFeeSponsor(max_sponsored_txs=100, daily_budget_usd=0.0005)
        uid = 9999
        # First tx pushes spend past the tiny daily budget for the next check.
        sponsor.record_sponsored_tx(uid, 0.001)
        assert sponsor.check_sponsorship(uid).should_sponsor is False
