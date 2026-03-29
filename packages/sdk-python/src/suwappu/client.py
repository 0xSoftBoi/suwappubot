from __future__ import annotations

import os
from typing import Any

import httpx

from suwappu.types import (
    Chain,
    LendingMarket,
    LendingMarketDetail,
    PerpMarket,
    PerpPosition,
    PerpQuote,
    PredictionMarket,
    PredictionMarketDetail,
    Quote,
    SuwappuConfig,
    SwapResult,
    Token,
    TokenBalance,
    TokenPrice,
)

DEFAULT_BASE_URL = "https://api.suwappu.bot"


class SuwappuError(Exception):
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Suwappu API error {status}: {body}")


class SuwappuClient:
    """Async client for the Suwappu cross-chain DEX API."""

    def __init__(self, config: SuwappuConfig | None = None) -> None:
        api_key = config.api_key if config else ""
        if not api_key:
            api_key = os.environ.get("SUWAPPU_API_KEY", "")
        base_url = config.base_url if config else DEFAULT_BASE_URL

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=30.0,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        response = await self._client.request(
            method, path, params=params, json=json
        )
        if response.status_code >= 400:
            raise SuwappuError(response.status_code, response.text)
        return response.json()

    async def get_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        chain: str,
    ) -> Quote:
        data = await self._request(
            "POST",
            "/v1/agent/quote",
            json={
                "from_token": from_token,
                "to_token": to_token,
                "amount": str(amount),
                "chain": chain,
            },
        )
        return Quote(
            id=data["id"],
            from_token=data.get("fromToken", ""),
            to_token=data.get("toToken", ""),
            from_amount=data.get("fromAmount", ""),
            to_amount=data.get("toAmount", ""),
            route=data.get("route", ""),
            gas=data.get("gas", ""),
            fee=data.get("fee", ""),
            chain=data.get("chain", ""),
        )

    async def execute_swap(self, quote_id: str) -> SwapResult:
        data = await self._request(
            "POST",
            "/v1/agent/swap",
            json={"quote_id": quote_id},
        )
        return SwapResult(
            tx_hash=data.get("txHash", ""),
            status=data.get("status", "pending"),
            chain=data.get("chain", ""),
        )

    async def get_portfolio(self, wallet_address: str, chain: str | None = None) -> list[TokenBalance]:
        params: dict[str, str] = {"wallet_address": wallet_address}
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/agent/portfolio", params=params)
        return [
            TokenBalance(
                token=b.get("token", ""),
                balance=b.get("balance", ""),
                usd_value=b.get("usdValue", ""),
                chain=b.get("chain", ""),
            )
            for b in data.get("balances", [])
        ]

    async def get_prices(
        self, symbols: str, chain: str | None = None
    ) -> list[TokenPrice]:
        params: dict[str, str] = {"symbols": symbols}
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/agent/prices", params=params)
        return [
            TokenPrice(
                token=token,
                price_usd=str(info.get("usd", "")),
                change_24h=str(info.get("change_24h", 0)),
            )
            for token, info in data.get("prices", {}).items()
        ]

    async def list_chains(self) -> list[Chain]:
        data = await self._request("GET", "/v1/agent/chains")
        return [
            Chain(
                id=c.get("id", 0),
                key=c.get("key", ""),
                name=c.get("name", ""),
                native_token=c.get("native_token", ""),
                type=c.get("type", ""),
            )
            for c in data.get("chains", [])
        ]

    async def list_tokens(self, chain: str) -> list[Token]:
        data = await self._request(
            "GET", "/v1/agent/tokens", params={"chain": chain}
        )
        return [
            Token(
                symbol=t.get("symbol", ""),
                address=t.get("address", ""),
                decimals=t.get("decimals", 0),
                chain=t.get("chain", ""),
            )
            for t in data
        ]

    # --- Perps (Hyperliquid) ---

    @property
    def perps(self) -> _PerpsNamespace:
        return _PerpsNamespace(self)

    # --- Predictions (Polymarket) ---

    @property
    def predict(self) -> _PredictNamespace:
        return _PredictNamespace(self)

    # --- Lending (Morpho) ---

    @property
    def lend(self) -> _LendNamespace:
        return _LendNamespace(self)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> SuwappuClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()


class _PerpsNamespace:
    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def markets(self) -> list[PerpMarket]:
        data = await self._c._request("GET", "/v1/agent/perps/markets")
        return [
            PerpMarket(
                name=m.get("name", ""),
                asset=m.get("asset", ""),
                sz_decimals=m.get("szDecimals", 0),
                max_leverage=m.get("maxLeverage", 0),
                mark_price=m.get("markPrice", 0),
                funding_rate=m.get("fundingRate", 0),
            )
            for m in data.get("markets", [])
        ]

    async def quote(
        self, market: str, side: str, size: float, leverage: float
    ) -> PerpQuote:
        data = await self._c._request(
            "POST",
            "/v1/agent/perps/quote",
            json={"market": market, "side": side, "size": size, "leverage": leverage},
        )
        return PerpQuote(
            market=data.get("market", ""),
            side=data.get("side", "long"),
            size=data.get("size", 0),
            leverage=data.get("leverage", 0),
            entry_price=data.get("entryPrice", 0),
            margin=data.get("margin", 0),
            liquidation_price=data.get("liquidationPrice", 0),
            funding_rate=data.get("fundingRate", 0),
            fee=data.get("fee", 0),
        )

    async def positions(self, address: str) -> list[PerpPosition]:
        data = await self._c._request(
            "GET", "/v1/agent/perps/positions", params={"address": address}
        )
        return [
            PerpPosition(
                id=p.get("id", ""),
                market=p.get("market", ""),
                side=p.get("side", "long"),
                size=p.get("size", 0),
                leverage=p.get("leverage", 0),
                entry_price=p.get("entryPrice", 0),
                mark_price=p.get("markPrice", 0),
                margin=p.get("margin", 0),
                unrealized_pnl=p.get("unrealizedPnl", 0),
                liquidation_price=p.get("liquidationPrice", 0),
                funding_rate=p.get("fundingRate", 0),
            )
            for p in data.get("positions", [])
        ]


class _PredictNamespace:
    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def markets(
        self, query: str | None = None, limit: int | None = None
    ) -> list[PredictionMarket]:
        params: dict[str, str] = {}
        if query:
            params["query"] = query
        if limit:
            params["limit"] = str(limit)
        data = await self._c._request(
            "GET", "/v1/agent/predict/markets", params=params or None
        )
        return [
            PredictionMarket(
                id=m.get("id", ""),
                question=m.get("question", ""),
                outcomes=m.get("outcomes", []),
                outcome_prices=m.get("outcomePrices", []),
                volume=m.get("volume", 0),
                liquidity=m.get("liquidity", 0),
                end_date=m.get("endDate", ""),
                active=m.get("active", False),
                category=m.get("category", ""),
            )
            for m in data.get("markets", [])
        ]

    async def market(self, id: str) -> PredictionMarketDetail:
        data = await self._c._request("GET", f"/v1/agent/predict/market/{id}")
        return PredictionMarketDetail(
            id=data.get("id", ""),
            question=data.get("question", ""),
            description=data.get("description", ""),
            outcomes=data.get("outcomes", []),
            outcome_prices=data.get("outcomePrices", []),
            volume=data.get("volume", 0),
            liquidity=data.get("liquidity", 0),
            end_date=data.get("endDate", ""),
            active=data.get("active", False),
            category=data.get("category", ""),
            created_at=data.get("createdAt", ""),
            resolved_outcome=data.get("resolvedOutcome"),
        )


class _LendNamespace:
    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def markets(self, chain_id: int | None = None) -> list[LendingMarket]:
        params = {"chainId": str(chain_id)} if chain_id else None
        data = await self._c._request(
            "GET", "/v1/agent/lend/markets", params=params
        )
        return [
            LendingMarket(
                id=m.get("id", ""),
                loan_token=m.get("loanToken", ""),
                collateral_token=m.get("collateralToken", ""),
                lltv=m.get("lltv", 0),
                supply_apy=m.get("supplyApy", 0),
                borrow_apy=m.get("borrowApy", 0),
                total_supply=m.get("totalSupply", 0),
                total_borrow=m.get("totalBorrow", 0),
                utilization=m.get("utilization", 0),
                chain_id=m.get("chainId", 8453),
            )
            for m in data.get("markets", [])
        ]

    async def market(self, id: str) -> LendingMarketDetail:
        data = await self._c._request("GET", f"/v1/agent/lend/market/{id}")
        return LendingMarketDetail(
            id=data.get("id", ""),
            loan_token=data.get("loanToken", ""),
            collateral_token=data.get("collateralToken", ""),
            lltv=data.get("lltv", 0),
            supply_apy=data.get("supplyApy", 0),
            borrow_apy=data.get("borrowApy", 0),
            total_supply=data.get("totalSupply", 0),
            total_borrow=data.get("totalBorrow", 0),
            utilization=data.get("utilization", 0),
            chain_id=data.get("chainId", 8453),
            oracle=data.get("oracle", ""),
            irm=data.get("irm", ""),
            created_at=data.get("createdAt", ""),
        )


def create_client(
    *,
    api_key: str = "",
    base_url: str = DEFAULT_BASE_URL,
) -> SuwappuClient:
    """Create a Suwappu client.

    Args:
        api_key: API key. Falls back to SUWAPPU_API_KEY env var.
        base_url: API base URL. Defaults to https://api.suwappu.bot.
    """
    config = SuwappuConfig(api_key=api_key, base_url=base_url)
    return SuwappuClient(config)
