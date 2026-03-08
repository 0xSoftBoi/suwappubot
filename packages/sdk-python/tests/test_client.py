from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from suwappu import create_client
from suwappu.client import SuwappuClient, SuwappuError
from suwappu.types import (
    Chain, LendingMarket, PerpMarket, PerpQuote, PredictionMarket,
    Quote, SwapResult, Token, TokenBalance, TokenPrice,
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
            "execute_swap",
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
    async def test_posts_to_correct_path(self, client: SuwappuClient) -> None:
        mock_data = {
            "id": "q1",
            "fromToken": "ETH",
            "toToken": "USDC",
            "fromAmount": "1.0",
            "toAmount": "2847.32",
            "route": "uniswap",
            "gas": "0.12",
            "fee": "0.01",
            "chain": "arbitrum",
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
                "fromToken": "ETH",
                "toToken": "USDC",
                "amount": 1.0,
                "chain": "arbitrum",
            },
        )
        assert isinstance(quote, Quote)
        assert quote.id == "q1"
        assert quote.to_amount == "2847.32"


class TestExecuteSwap:
    @pytest.mark.asyncio
    async def test_posts_to_correct_path(self, client: SuwappuClient) -> None:
        mock_data = {"txHash": "0xabc", "status": "confirmed", "chain": "arbitrum"}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            result = await client.execute_swap("q1")

        mock_req.assert_called_once_with(
            "POST",
            "/v1/agent/swap",
            params=None,
            json={"quoteId": "q1"},
        )
        assert isinstance(result, SwapResult)
        assert result.tx_hash == "0xabc"
        assert result.status == "confirmed"


class TestGetPortfolio:
    @pytest.mark.asyncio
    async def test_gets_without_chain(self, client: SuwappuClient) -> None:
        mock_data = [
            {"token": "ETH", "balance": "1.5", "usdValue": "4270", "chain": "arbitrum"}
        ]

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            portfolio = await client.get_portfolio()

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/portfolio", params=None, json=None
        )
        assert len(portfolio) == 1
        assert isinstance(portfolio[0], TokenBalance)
        assert portfolio[0].token == "ETH"

    @pytest.mark.asyncio
    async def test_gets_with_chain_filter(self, client: SuwappuClient) -> None:
        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response([])
            await client.get_portfolio("solana")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/portfolio", params={"chain": "solana"}, json=None
        )


class TestGetPrices:
    @pytest.mark.asyncio
    async def test_gets_with_token(self, client: SuwappuClient) -> None:
        mock_data = {"token": "ETH", "priceUsd": "2847.32", "change24h": "-1.2"}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            price = await client.get_prices("ETH")

        mock_req.assert_called_once_with(
            "GET", "/v1/agent/prices", params={"token": "ETH"}, json=None
        )
        assert isinstance(price, TokenPrice)
        assert price.price_usd == "2847.32"

    @pytest.mark.asyncio
    async def test_gets_with_chain_filter(self, client: SuwappuClient) -> None:
        mock_data = {"token": "ETH", "priceUsd": "2847", "change24h": "0"}

        with patch.object(
            client._client, "request", new_callable=AsyncMock
        ) as mock_req:
            mock_req.return_value = _mock_response(mock_data)
            await client.get_prices("ETH", "arbitrum")

        mock_req.assert_called_once_with(
            "GET",
            "/v1/agent/prices",
            params={"token": "ETH", "chain": "arbitrum"},
            json=None,
        )


class TestListChains:
    @pytest.mark.asyncio
    async def test_gets_correct_path(self, client: SuwappuClient) -> None:
        mock_data = [{"name": "arbitrum", "chainId": 42161, "status": "active"}]

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
        assert chains[0].name == "arbitrum"
        assert chains[0].chain_id == 42161


class TestListTokens:
    @pytest.mark.asyncio
    async def test_gets_with_chain_param(self, client: SuwappuClient) -> None:
        mock_data = [
            {"symbol": "USDC", "address": "0x123", "decimals": 6, "chain": "arbitrum"}
        ]

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
            id="1", from_token="ETH", to_token="USDC",
            from_amount="1", to_amount="2847",
            route="uni", gas="0.1", fee="0.01", chain="arb",
        )
        assert q.id == "1"

    def test_swap_result_model(self) -> None:
        s = SwapResult(tx_hash="0x1", status="confirmed", chain="arb")
        assert s.status == "confirmed"

    def test_chain_model(self) -> None:
        c = Chain(name="arb", chain_id=42161, status="active")
        assert c.chain_id == 42161

    def test_token_model(self) -> None:
        t = Token(symbol="ETH", address="0x0", decimals=18, chain="arb")
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
