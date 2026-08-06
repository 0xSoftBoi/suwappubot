from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from suwappu import create_client
from suwappu.client import SuwappuClient, SuwappuError
from suwappu.types import (
    Chain, LendingMarket, PerpMarket, PerpQuote, PredictionMarket,
    Quote, SwapResult, SwapSimulation, Token, TokenBalance, TokenPrice, TokenRef,
)

MOCK_BASE = "https://test.suwappu.bot"
MOCK_KEY = "test-api-key-123"


def _mock_response(data: object, status: int = 200) -> httpx.Response:
    import json

    return httpx.Response(
        status_code=status,
        content=json.dumps(data).encode(),
        headers={"content-type": "application/json"},
        request=httpx.Request("GET", MOCK_BASE),
    )


@pytest.fixture
def client() -> SuwappuClient:
    return create_client(api_key=MOCK_KEY, base_url=MOCK_BASE)


class TestCreateClient:
    def test_returns_suwappu_client(self) -> None:
        c = create_client(api_key="k", base_url="http://localhost")
        assert isinstance(c, SuwappuClient)

    def test_has_all_methods(self) -> None:
        c = create_client()
        methods = [
            "get_quote",
            "execute_managed_swap",
            "execute_swap",
            "prepare_swap",
            "simulate_swap",
            "get_portfolio",
            "get_prices",
            "list_chains",
            "list_tokens",
        ]
        for m in methods:
            assert hasattr(c, m), f"Missing method: {m}"
            assert callable(getattr(c, m))

    def test_sets_auth_header(self) -> None:
        c = create_client(api_key="my-key", base_url=MOCK_BASE)
        assert c._client.headers["authorization"] == "Bearer my-key"

    def test_no_auth_header_without_key(self) -> None:
        c = create_client(base_url=MOCK_BASE)
        assert "authorization" not in c._client.headers


class TestGetQuote:
    @pytest.mark.asyncio
    async def test_posts_to_correct_path_evm(self, client: SuwappuClient) -> None:
        # Real shape returned by api-ts agent.ts POST /v1/agent/quote (EVM/Li.Fi branch).
        mock_data = {
            "success": True,
            "quote_id": "lifi_abc123",
            "from_chain": "Arbitrum",
            "from_chain_id": 42161,
            "to_chain": "Arbitrum",
            "to_chain_id": 42161,
            "chain_type": "evm",
            "from_token": {"symbol": "ETH", "address": "0xETH", "decimals": 18},
            "to_token": {"symbol": "USDC", "address": "0xUSDC", "decimals": 6},
            "amount_in": "1",
            "amount_out": "2847.320000",
            "amount_out_min": "2800.000000",
            "exchange_rate": "2847.32",
            "price_impact": "0.1%",
            "estimated_gas_usd": "$1.20",
            "bridge_fee_usd": "$0.00",
            "route": "uniswap",
            "slippage": "3.0%",
            "estimated_time_seconds": 30,
            "expires_in_seconds": 60,
            "dex": "Li.Fi",
        }

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            quote = await client.get_quote("ETH", "USDC", 1.0, "arbitrum")

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/quote",
            params=None,
            json={
                "from_token": "ETH",
                "to_token": "USDC",
                "amount": "1.0",
                "chain": "arbitrum",
            },
        )
        assert isinstance(quote, Quote)
        assert quote.quote_id == "lifi_abc123"
        assert quote.amount_out == "2847.320000"
        assert quote.amount_out_min == "2800.000000"
        assert isinstance(quote.from_token, TokenRef)
        assert quote.from_token.symbol == "ETH"
        assert quote.to_token.address == "0xUSDC"

    @pytest.mark.asyncio
    async def test_posts_to_correct_path_solana(self, client: SuwappuClient) -> None:
        # Real shape returned by api-ts agent.ts POST /v1/agent/quote (Solana/Jupiter branch).
        mock_data = {
            "success": True,
            "quote_id": "jupiter_abc123",
            "chain": "Solana",
            "chain_type": "solana",
            "from_token": {"symbol": "SOL", "address": "So1...", "decimals": 9},
            "to_token": {"symbol": "USDC", "address": "EPj...", "decimals": 6},
            "amount_in": "1",
            "amount_out": "150.000000",
            "amount_out_min": "148.000000",
            "exchange_rate": "150.0",
            "price_impact": "0.05%",
            "route": "Jupiter",
            "slippage": "3.0%",
            "expires_in_seconds": 60,
            "dex": "Jupiter",
            "requires_wallet": True,
            "wallet_type": "solana",
        }

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            quote = await client.get_quote("SOL", "USDC", 1.0, "solana")

        assert quote.chain == "Solana"
        assert quote.chain_type == "solana"
        assert quote.amount_out_min == "148.000000"

    @pytest.mark.asyncio
    async def test_supports_wallet_bound_cross_chain_quotes(self, client: SuwappuClient) -> None:
        mock_data = {
            "quote_id": "q-cross",
            "chain_type": "evm",
            "from_token": {"symbol": "USDC", "address": "0xUSDC", "decimals": 6},
            "to_token": {"symbol": "ETH", "address": "0xETH", "decimals": 18},
            "amount_in": "100.0",
            "amount_out": "0.03",
        }
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            quote = await client.get_quote(
                "USDC",
                "ETH",
                100.0,
                wallet_address="0xabc",
                from_chain="base",
                to_chain="arbitrum",
                slippage=0.01,
            )

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/quote",
            params=None,
            json={
                "from_token": "USDC",
                "to_token": "ETH",
                "amount": "100.0",
                "from_chain": "base",
                "to_chain": "arbitrum",
                "wallet_address": "0xabc",
                "slippage": 0.01,
            },
        )
        assert quote.quote_id == "q-cross"

    @pytest.mark.asyncio
    async def test_raises_clear_error_on_malformed_response(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response({"success": True, "id": "legacy-shape"})
            with pytest.raises(SuwappuError):
                await client.get_quote("ETH", "USDC", 1.0, "arbitrum")


class TestExecuteSwap:
    @pytest.mark.asyncio
    async def test_posts_to_correct_path(self, client: SuwappuClient) -> None:
        # Real shape returned by api-ts agent.ts POST /v1/agent/swap/execute.
        mock_data = {
            "success": True,
            "swap_id": 42,
            "status": "pending",
            "tx_hash": "0xabc",
            "tracking": {
                "poll_url": "/v1/agent/swap/status/42",
                "webhook_note": "Set callback_url via PATCH /v1/agent/me",
            },
        }

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            result = await client.execute_swap("q1")

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/swap/execute",
            params=None,
            json={"quote_id": "q1"},
        )
        assert isinstance(result, SwapResult)
        assert result.tx_hash == "0xabc"
        assert result.status == "pending"
        assert result.swap_id == 42
        assert result.poll_url == "/v1/agent/swap/status/42"

    @pytest.mark.asyncio
    async def test_raises_clear_error_on_malformed_response(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response({"success": True, "txHash": "0xabc"})
            with pytest.raises(SuwappuError):
                await client.execute_swap("q1")


    @pytest.mark.asyncio
    async def test_explicit_managed_method_uses_execute_endpoint(self, client: SuwappuClient) -> None:
        mock_data = {"swap_id": 43, "status": "pending", "tx_hash": None}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            result = await client.execute_managed_swap("q-managed")

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/swap/execute",
            params=None,
            json={"quote_id": "q-managed"},
        )
        assert result.swap_id == 43

    @pytest.mark.asyncio
    async def test_managed_method_forwards_idempotency_key(self, client: SuwappuClient) -> None:
        mock_data = {"swap_id": 44, "status": "pending", "tx_hash": None}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            await client.execute_managed_swap(
                "q-idempotent", idempotency_key="strategy-run-44"
            )

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/swap/execute",
            params=None,
            json={"quote_id": "q-idempotent"},
            headers={"Idempotency-Key": "strategy-run-44"},
        )

    @pytest.mark.asyncio
    async def test_simulate_swap_validates_full_report(self, client: SuwappuClient) -> None:
        mock_data = {
            "success": True,
            "would_execute": True,
            "quote_id": "q-sim",
            "chain_type": "evm",
            "expected_output": {"token": "USDC", "amount": "3190", "amount_usd": "3190"},
            "min_output_after_slippage": "3174.05",
            "price_impact_pct": 0.12,
            "fees": {"protocol": "25.52", "gas_estimate": "0.08"},
            "checks": [{"name": "balance", "status": "pass", "detail": "sufficient"}],
            "warnings": [],
        }
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            report = await client.simulate_swap(quote_id="q-sim", wallet_address="0xabc")

        assert isinstance(report, SwapSimulation)
        assert report.would_execute is True
        assert report.expected_output.amount_usd == "3190"
        assert report.fees.gas_estimate == "0.08"
        assert report.checks[0].status == "pass"

    @pytest.mark.asyncio
    async def test_prepare_swap_uses_unsigned_self_custody_endpoint(self, client: SuwappuClient) -> None:
        mock_data = {"status": "ready", "transaction": {"to": "0xdef"}}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            result = await client.prepare_swap(
                quote_id="q-self-custody",
                wallet_address="0xabc",
            )

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/swap",
            params=None,
            json={
                "quote_id": "q-self-custody",
                "wallet_address": "0xabc",
            },
        )
        assert result["status"] == "ready"



class TestGetPortfolio:
    @pytest.mark.asyncio
    async def test_gets_without_chain(self, client: SuwappuClient) -> None:
        # Real shape returned by api-ts agent.ts GET /v1/agent/portfolio.
        mock_data = {"balances": [
            {"symbol": "ETH", "name": "Ethereum", "chain": "arbitrum", "balance": "1.5", "usd_value": "4270.00"}
        ]}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            portfolio = await client.get_portfolio("0xabc123")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/portfolio", params={"wallet_address": "0xabc123"}, json=None
        )
        assert len(portfolio) == 1
        assert isinstance(portfolio[0], TokenBalance)
        assert portfolio[0].symbol == "ETH"
        assert portfolio[0].usd_value == "4270.00"

    @pytest.mark.asyncio
    async def test_gets_with_chain_filter(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response({"balances": []})
            await client.get_portfolio("0xabc123", "solana")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/portfolio", params={"wallet_address": "0xabc123", "chain": "solana"}, json=None
        )

    @pytest.mark.asyncio
    async def test_raises_clear_error_on_malformed_response(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response({"balances": [{"token": "ETH"}]})
            with pytest.raises(SuwappuError):
                await client.get_portfolio("0xabc123")


class TestGetPrices:
    @pytest.mark.asyncio
    async def test_gets_with_symbols(self, client: SuwappuClient) -> None:
        mock_data = {"prices": {"ETH": {"usd": 2847.32, "change_24h": -1.2}}}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            prices = await client.get_prices("ETH")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/prices", params={"symbols": "ETH"}, json=None
        )
        assert len(prices) == 1
        assert isinstance(prices[0], TokenPrice)
        assert prices[0].price_usd == "2847.32"

    @pytest.mark.asyncio
    async def test_gets_with_chain_filter(self, client: SuwappuClient) -> None:
        mock_data = {"prices": {"ETH": {"usd": 2847, "change_24h": 0}}}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            await client.get_prices("ETH", "arbitrum")

        mock_req.assert_called_once_with(
            "GET",
            "/v1/agent/prices",
            params={"symbols": "ETH", "chain": "arbitrum"},
            json=None,
        )


class TestListChains:
    @pytest.mark.asyncio
    async def test_gets_correct_path(self, client: SuwappuClient) -> None:
        mock_data = {"chains": [{"id": 42161, "key": "arbitrum", "name": "Arbitrum", "native_token": "ETH", "type": "evm"}]}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            chains = await client.list_chains()

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/chains", params=None, json=None
        )
        assert len(chains) == 1
        assert isinstance(chains[0], Chain)
        assert chains[0].name == "Arbitrum"
        assert chains[0].id == 42161


class TestListTokens:
    @pytest.mark.asyncio
    async def test_gets_with_chain_param(self, client: SuwappuClient) -> None:
        # Real shape returned by api-ts agent.ts GET /v1/agent/tokens?chain=...
        mock_data = {
            "success": True,
            "chain": "Arbitrum",
            "chain_id": 42161,
            "tokens": [{"symbol": "USDC", "address": "0x123", "decimals": 6}],
        }

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            tokens = await client.list_tokens("arbitrum")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/tokens", params={"chain": "arbitrum"}, json=None
        )
        assert len(tokens) == 1
        assert isinstance(tokens[0], Token)
        assert tokens[0].symbol == "USDC"

    @pytest.mark.asyncio
    async def test_raises_clear_error_on_malformed_response(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response([{"symbol": "USDC"}])
            with pytest.raises(SuwappuError):
                await client.list_tokens("arbitrum")


class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_raises_on_error_response(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = httpx.Response(
                status_code=401,
                text="Unauthorized",
                request=httpx.Request("GET", MOCK_BASE),
            )
            with pytest.raises(SuwappuError, match="401"):
                await client.list_chains()


class TestContextManager:
    @pytest.mark.asyncio
    async def test_async_context_manager(self) -> None:
        async with create_client(base_url=MOCK_BASE) as client:
            assert isinstance(client, SuwappuClient)


class TestTypes:
    def test_quote_model(self) -> None:
        q = Quote(
            quote_id="1",
            from_token=TokenRef(symbol="ETH", address="0xETH", decimals=18),
            to_token=TokenRef(symbol="USDC", address="0xUSDC", decimals=6),
            amount_in="1", amount_out="2847",
            route="uni",
        )
        assert q.quote_id == "1"
        assert q.from_token.symbol == "ETH"

    def test_swap_result_model(self) -> None:
        s = SwapResult(swap_id=1, tx_hash="0x1", status="confirmed")
        assert s.status == "confirmed"

    def test_chain_model(self) -> None:
        c = Chain(id=42161, key="arbitrum", name="Arbitrum", native_token="ETH", type="evm")
        assert c.id == 42161

    def test_token_model(self) -> None:
        t = Token(symbol="ETH", address="0x0", decimals=18)
        assert t.decimals == 18


class TestPerpsNamespace:
    @pytest.mark.asyncio
    async def test_markets(self, client: SuwappuClient) -> None:
        mock_data = {"markets": [
            {"name": "ETH-USD", "asset": "ETH", "szDecimals": 4, "maxLeverage": 20, "markPrice": 2847, "fundingRate": 0.01}
        ]}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            markets = await client.perps.markets()
        mock_req.assert_called_once_with("GET", "/v1/agent/perps/markets", params=None, json=None)
        assert len(markets) == 1
        assert isinstance(markets[0], PerpMarket)
        assert markets[0].name == "ETH-USD"

    @pytest.mark.asyncio
    async def test_quote(self, client: SuwappuClient) -> None:
        mock_data = {"market": "ETH-USD", "side": "long", "size": 1, "leverage": 5, "entryPrice": 2847, "margin": 569, "liquidationPrice": 2300, "fundingRate": 0.01, "fee": 0.57}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            quote = await client.perps.quote("ETH-USD", "long", 1.0, 5.0)
        mock_req.assert_called_once_with(
            "POST", "/v1/agent/perps/quote", params=None,
            json={"market": "ETH-USD", "side": "long", "size": 1.0, "leverage": 5.0},
        )
        assert isinstance(quote, PerpQuote)
        assert quote.entry_price == 2847

    @pytest.mark.asyncio
    async def test_positions(self, client: SuwappuClient) -> None:
        mock_data = {"positions": []}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            positions = await client.perps.positions("0xabc")
        mock_req.assert_called_once_with(
            "GET", "/v1/agent/perps/positions", params={"address": "0xabc"}, json=None,
        )
        assert positions == []


class TestPredictNamespace:
    @pytest.mark.asyncio
    async def test_markets(self, client: SuwappuClient) -> None:
        mock_data = {"markets": [
            {"id": "m1", "question": "Will ETH hit 5k?", "outcomes": ["Yes", "No"], "outcomePrices": [0.65, 0.35], "volume": 100000, "liquidity": 50000, "endDate": "2026-12-31", "active": True, "category": "crypto"}
        ]}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            markets = await client.predict.markets()
        mock_req.assert_called_once_with("GET", "/v1/agent/predict/markets", params=None, json=None)
        assert len(markets) == 1
        assert isinstance(markets[0], PredictionMarket)

    @pytest.mark.asyncio
    async def test_markets_with_query(self, client: SuwappuClient) -> None:
        mock_data = {"markets": []}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            await client.predict.markets("crypto", 10)
        mock_req.assert_called_once_with(
            "GET", "/v1/agent/predict/markets",
            params={"query": "crypto", "limit": "10"}, json=None,
        )

    @pytest.mark.asyncio
    async def test_market_detail(self, client: SuwappuClient) -> None:
        mock_data = {"id": "m1", "question": "Test?", "description": "d", "outcomes": [], "outcomePrices": [], "volume": 0, "liquidity": 0, "endDate": "", "active": True, "category": "", "createdAt": "", "resolvedOutcome": None}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            market = await client.predict.market("m1")
        mock_req.assert_called_once_with("GET", "/v1/agent/predict/market/m1", params=None, json=None)
        assert market.id == "m1"


class TestLendNamespace:
    @pytest.mark.asyncio
    async def test_markets(self, client: SuwappuClient) -> None:
        mock_data = {"markets": [
            {"id": "mk1", "loanToken": "USDC", "collateralToken": "ETH", "lltv": 0.86, "supplyApy": 5.2, "borrowApy": 7.1, "totalSupply": 1000000, "totalBorrow": 800000, "utilization": 80, "chainId": 8453}
        ]}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            markets = await client.lend.markets()
        mock_req.assert_called_once_with("GET", "/v1/agent/lend/markets", params=None, json=None)
        assert len(markets) == 1
        assert isinstance(markets[0], LendingMarket)
        assert markets[0].loan_token == "USDC"

    @pytest.mark.asyncio
    async def test_markets_with_chain(self, client: SuwappuClient) -> None:
        mock_data = {"markets": []}
        with patch.object(client._client, "request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            await client.lend.markets(chain_id=1)
        mock_req.assert_called_once_with(
            "GET", "/v1/agent/lend/markets", params={"chainId": "1"}, json=None,
        )


# --- Agent control plane (approvals / audit / kill switch) ---
#
# Mirrors packages/sdk/src/__tests__/client.test.ts. Both SDKs must hit the
# same routes with the same wire names; drift between them is a real bug we
# have shipped before.


@pytest.mark.asyncio
async def test_control_plane_endpoints(monkeypatch):
    seen: list[tuple[str, str, dict | None]] = []

    async def fake_request(self, method, path, *, params=None, json=None):
        qs = ""
        if params:
            qs = "?" + "&".join(f"{k}={v}" for k, v in params.items())
        seen.append((method, path + qs, json))
        return {
            "success": True, "approvals": [], "events": [], "killswitches": [],
            "wallets": [], "swaps": [], "pagination": {}, "code": "ABC",
            "expires_at": "T", "challenge": "c", "valid": True,
            "scope": "org", "active": True, "id": "a1", "status": "pending",
            "address": "0x1",
        }

    monkeypatch.setattr(SuwappuClient, "_request", fake_request)
    c = create_client(api_key="k")

    await c.simulate_swap(quote_id="q1", wallet_address="0xabc")
    await c.list_swaps(status="completed", limit=5)
    await c.agent.create_wallet()
    await c.agent.link_code()
    await c.approvals.list(status="pending")
    await c.approvals.get("id 1")
    await c.approvals.approve("a1", step_up_challenge="ch")
    await c.approvals.deny("a1")
    await c.approvals.step_up_challenge("a1")
    await c.audit.list(event_type="swap", limit=10)
    await c.audit.verify()
    await c.killswitch.list()
    await c.killswitch.set(scope="org", active=True, reason="incident")

    paths = [p for _, p, _ in seen]
    assert paths == [
        "/v1/agent/swap/simulate",
        "/v1/agent/swaps?status=completed&limit=5",
        "/v1/agent/wallets",
        "/v1/agent/link/code",
        "/v1/agent/approvals?status=pending",
        "/v1/agent/approvals/id%201",
        "/v1/agent/approvals/a1/approve",
        "/v1/agent/approvals/a1/deny",
        "/v1/agent/approvals/a1/step-up/challenge",
        "/v1/agent/audit?event_type=swap&limit=10",
        "/v1/agent/audit/verify",
        "/v1/agent/killswitch",
        "/v1/agent/killswitch",
    ]
    # Wire names are snake_case, not the Python kwarg names.
    assert seen[0][2] == {"quote_id": "q1", "wallet_address": "0xabc"}
    assert seen[6][2] == {"step_up_challenge": "ch"}
    assert seen[12][2] == {"scope": "org", "active": True, "reason": "incident"}


@pytest.mark.asyncio
async def test_approval_id_is_url_encoded(monkeypatch):
    """An id must never be able to escape its path segment."""
    seen: list[str] = []

    async def fake_request(self, method, path, *, params=None, json=None):
        seen.append(path)
        return {"id": "a1", "status": "pending"}

    monkeypatch.setattr(SuwappuClient, "_request", fake_request)
    c = create_client(api_key="k")
    await c.approvals.get("a/../b 1")
    assert seen == ["/v1/agent/approvals/a%2F..%2Fb%201"]
