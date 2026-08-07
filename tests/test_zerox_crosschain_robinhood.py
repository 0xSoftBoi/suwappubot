"""0x Cross-Chain regressions for Robinhood launch-token funding.

The Robinhood paste-buy flow is deliberately single-wallet because bridge/swap
calldata is recipient-bound.  These tests pin the same invariant for the 0x
Cross-Chain fallback: the selected wallet is both the origin and destination,
the displayed platform fee is carried into the provider request, execution
re-quotes before signing, and background polling waits for destination fill.
"""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.models.swap import SwapStatus
from bot.services.swap_engine import SwapEngine, SwapQuote
from bot.services.tx_poller import TransactionPoller
from bot.services.zerox_api import ZeroXAPI
from bot.utils.exceptions import SwapError

BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
ROBINHOOD_LAUNCH = "0x6245e67affA44a23077f0Ea7f981a8DC743a0c47"
WALLET = "0x00000000000000000000000000000000000000b2"
COLLECTOR = "0x00000000000000000000000000000000000000f0"


def _cross_chain_response(*, min_buy_amount: str = "900000000000000000") -> dict:
    return {
        "liquidityAvailable": True,
        "originChainId": 8453,
        "destinationChainId": 4663,
        "sellToken": BASE_USDC,
        "buyToken": ROBINHOOD_LAUNCH,
        "quotes": [
            {
                "sellAmount": "1000000",
                "buyAmount": "1000000000000000000",
                "minBuyAmount": min_buy_amount,
                "estimatedTimeSeconds": 4,
                "gasCosts": {"gasLimit": "250000", "totalNetworkFee": "1000"},
                "issues": {"allowance": {"spender": "0x0000000000001ff3684f28c67538d4d072c22734"}},
                "transaction": {
                    "chainType": "evm",
                    "details": {
                        "to": "0x0000000000001ff3684f28c67538d4d072c22734",
                        "data": "0x1234",
                        "gas": "250000",
                        "gasPrice": "1000000",
                        "value": "0",
                    },
                },
                "quoteId": "0xquote-robinhood",
            }
        ],
    }


def test_zerox_cross_chain_quote_binds_destination_and_platform_fee():
    """Provider request must encode the selected recipient and exact fee bps."""
    api = ZeroXAPI()
    api.api_key = "test-key"
    api._request = AsyncMock(return_value=_cross_chain_response())

    with patch("bot.services.zerox_api.settings.fee_collector_address", COLLECTOR):
        quote = asyncio.run(
            api.get_cross_chain_quote(
                origin_chain_id=8453,
                destination_chain_id=4663,
                from_token=BASE_USDC,
                to_token=ROBINHOOD_LAUNCH,
                amount="1000000",
                origin_address=WALLET,
                destination_address=WALLET,
                slippage=0.5,
                platform_fee_bps=80,
            )
        )

    path, params = api._request.await_args.args
    assert path == "/cross-chain/quotes"
    assert params["originChain"] == 8453
    assert params["destinationChain"] == 4663
    assert params["originAddress"] == WALLET
    assert params["destinationAddress"] == WALLET
    assert params["slippageBps"] == 50
    assert params["sortQuotesBy"] == "price"
    assert params["maxNumQuotes"] == 1
    assert params["feeBps"] == 80
    assert params["feeRecipient"] == COLLECTOR
    assert quote.quote_id == "0xquote-robinhood"
    assert quote.to_amount_min == "900000000000000000"
    assert quote.tx_data["to"].lower().endswith("22734")


def test_engine_builds_robinhood_0x_cross_chain_quote_for_selected_wallet():
    """The engine adapter keeps raw launch-token addresses and recipient binding."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            to_amount="1000000000000000000",
            to_amount_min="900000000000000000",
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xquote-robinhood",
            tx_data={"to": "0x0000000000001ff3684f28c67538d4d072c22734"},
            raw_response=_cross_chain_response(),
        )
    )
    engine._real_gas_cost_usd = AsyncMock(return_value=(0.01, True))

    quote = asyncio.run(
        engine._get_0x_cross_chain_quote(
            from_chain="base",
            to_chain="robinhood",
            from_token="USDC",
            to_token=ROBINHOOD_LAUNCH,
            amount=1.0,
            amount_raw="1000000",
            from_address=WALLET,
            to_address=WALLET,
            slippage=0.5,
            platform_fee_bps=80,
        )
    )

    kwargs = engine.zerox.get_cross_chain_quote.await_args.kwargs
    assert kwargs["origin_chain_id"] == 8453
    assert kwargs["destination_chain_id"] == 4663
    assert kwargs["destination_address"] == WALLET
    assert kwargs["to_token"] == ROBINHOOD_LAUNCH
    assert kwargs["platform_fee_bps"] == 80
    assert quote.provider == "0x_crosschain"
    assert quote.platform_fee_bps == 80
    assert quote.raw_quote["quote_id"] == "0xquote-robinhood"


def test_cross_chain_execution_requotes_for_signer_and_rejects_worse_min_out():
    """No stale/wrong-recipient 0x calldata may be signed after confirmation."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock(
        return_value=SimpleNamespace(
            origin_chain_id=8453,
            destination_chain_id=4663,
            to_amount="950000000000000000",
            to_amount_min="800000000000000000",
            estimated_gas="250000",
            estimated_time=4,
            quote_id="0xfresh",
            tx_data={"to": "0x0000000000001ff3684f28c67538d4d072c22734"},
            raw_response=_cross_chain_response(min_buy_amount="800000000000000000"),
        )
    )
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"slippage": 0.5, "quote_id": "0xold"},
    )

    with pytest.raises(SwapError, match="min-out"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))

    kwargs = engine.zerox.get_cross_chain_quote.await_args.kwargs
    assert kwargs["origin_address"] == WALLET
    assert kwargs["destination_address"] == WALLET
    assert kwargs["platform_fee_bps"] == 80
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


def test_cross_chain_execution_rejects_tampered_raw_destination_chain_id():
    """Caller-controlled raw quote metadata cannot redirect a Robinhood swap."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = MagicMock()
    engine.zerox.get_cross_chain_quote = AsyncMock()
    engine._get_wallet_for_signing = AsyncMock(return_value=object())
    engine.wallet_service = MagicMock()
    engine.wallet_service.sign_evm_transaction = AsyncMock()

    approved = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={
            "origin_chain_id": 8453,
            # Forged API payload attempts to redirect the destination to Arbitrum.
            "destination_chain_id": 42161,
            "slippage": 0.5,
            "quote_id": "0xold",
        },
    )

    with pytest.raises(SwapError, match="stored chain IDs do not match"):
        asyncio.run(engine._execute_0x_cross_chain_swap(approved, {"address": WALLET}))

    engine.zerox.get_cross_chain_quote.assert_not_awaited()
    engine.wallet_service.sign_evm_transaction.assert_not_awaited()


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [
        ("origin_tx_pending", SwapStatus.CONFIRMING.value),
        ("bridge_pending", SwapStatus.CONFIRMING.value),
        ("bridge_filled", SwapStatus.COMPLETED.value),
        ("origin_tx_reverted", SwapStatus.FAILED.value),
        ("bridge_failed", SwapStatus.FAILED.value),
    ],
)
def test_tx_poller_waits_for_0x_destination_fill(provider_status, expected):
    """Origin inclusion is not completion; only bridge_filled completes the swap."""
    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        return_value={
            "status": provider_status,
            "transactions": [
                {"chainId": 8453, "txHash": "0xorigin"},
                {"chainId": 4663, "txHash": "0xdestination"},
            ],
        }
    )
    tx = {
        "id": 7,
        "tx_hash": "0xorigin",
        "from_chain": "base",
        "to_chain": "robinhood",
        "route_provider": "0x_crosschain",
        "route_data": json.dumps({"quote_id": "0xquote-robinhood"}),
    }

    status, destination_hash = asyncio.run(poller._check_tx_status_dict(tx))

    poller._zerox.get_cross_chain_status.assert_awaited_once_with(
        origin_chain_id=8453,
        origin_tx_hash="0xorigin",
        quote_id="0xquote-robinhood",
    )
    assert status == expected
    if provider_status == "bridge_filled":
        assert destination_hash == "0xdestination"
    else:
        assert destination_hash is None


def test_tx_poller_repolls_confirming_crosschain_until_destination_fill(tmp_db):
    """A first nonterminal poll must not make the bridge disappear from polling."""
    from bot.models.swap import SwapTransaction
    from bot.models.user import User
    from database.db import get_session as get_db_session

    with get_db_session() as session:
        user = User(telegram_id=4663001)
        session.add(user)
        session.flush()
        tx = SwapTransaction(
            user_id=user.id,
            from_chain="base",
            from_token="USDC",
            from_amount="1000000",
            to_chain="robinhood",
            to_token="FRONG",
            to_amount="1000000000000000000",
            status=SwapStatus.SUBMITTED.value,
            tx_hash="0xorigin",
            route_provider="0x_crosschain",
            route_data=json.dumps({"quote_id": "0xquote-robinhood"}),
        )
        session.add(tx)
        session.commit()
        tx_id = tx.id

    poller = TransactionPoller()
    poller._zerox = MagicMock()
    poller._zerox.get_cross_chain_status = AsyncMock(
        side_effect=[
            {"status": "bridge_pending", "transactions": []},
            {
                "status": "bridge_filled",
                "transactions": [
                    {"chainId": 8453, "txHash": "0xorigin"},
                    {"chainId": 4663, "txHash": "0xdestination"},
                ],
            },
        ]
    )

    asyncio.run(poller._check_pending_transactions())
    with get_db_session() as session:
        assert session.get(SwapTransaction, tx_id).status == SwapStatus.CONFIRMING.value

    asyncio.run(poller._check_pending_transactions())
    with get_db_session() as session:
        stored = session.get(SwapTransaction, tx_id)
        assert stored.status == SwapStatus.COMPLETED.value
        assert stored.destination_tx_hash == "0xdestination"

    assert poller._zerox.get_cross_chain_status.await_count == 2


def test_zerox_crosschain_is_executable_provider():
    from bot.services.swap_engine import EXECUTABLE_PROVIDERS

    assert "0x_crosschain" in EXECUTABLE_PROVIDERS


def test_zerox_crosschain_route_is_scoped_to_robinhood_destination():
    """Do not silently change unrelated bridge routing while adding this fallback."""
    engine = SwapEngine.__new__(SwapEngine)
    engine.zerox = SimpleNamespace(is_configured=True)

    assert engine._is_0x_robinhood_cross_chain_route("base", "robinhood") is True
    assert engine._is_0x_robinhood_cross_chain_route("ethereum", "robinhood") is True
    assert engine._is_0x_robinhood_cross_chain_route("robinhood", "base") is False
    assert engine._is_0x_robinhood_cross_chain_route("base", "arbitrum") is False
    assert engine._is_0x_robinhood_cross_chain_route("solana", "robinhood") is False

    engine.zerox = SimpleNamespace(is_configured=False)
    assert engine._is_0x_robinhood_cross_chain_route("base", "robinhood") is False


def test_multi_wallet_crosschain_execution_isolates_fresh_quote_ids():
    """Concurrent wallets must never share mutable execution quote state."""
    engine = SwapEngine.__new__(SwapEngine)
    seen = {}

    async def fake_execute_swap(*, quote, wallet_id, **_kwargs):
        quote.raw_quote["quote_id"] = f"fresh-{wallet_id}"
        # Force both tasks to mutate before either one records what it sees.
        await asyncio.sleep(0)
        seen[wallet_id] = (quote.raw_quote["quote_id"], id(quote), id(quote.raw_quote))
        return None

    engine.execute_swap = AsyncMock(side_effect=fake_execute_swap)
    shared_quote = SwapQuote(
        provider="0x_crosschain",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_LAUNCH,
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000000000000000",
        to_amount_human=1.0,
        to_amount_min="900000000000000000",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=4,
        price_impact=0.0,
        exchange_rate=1.0,
        platform_fee_bps=80,
        raw_quote={"quote_id": "display-quote"},
    )

    asyncio.run(
        engine.execute_multi_swap(
            [(shared_quote, 11), (shared_quote, 22)],
            user_id=7,
            attempt_id="concurrent-robinhood",
        )
    )

    assert seen[11][0] == "fresh-11"
    assert seen[22][0] == "fresh-22"
    assert seen[11][1:] != seen[22][1:]
    assert shared_quote.raw_quote["quote_id"] == "display-quote"
