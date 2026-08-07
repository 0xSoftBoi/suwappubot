from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import httpx

from suwappu.types import (
    AgentErrorCode,
    AgentProfile,
    AgentWallet,
    Approval,
    AuditEvent,
    AuditVerifyResult,
    BillingCheckoutResult,
    BillingStatus,
    Chain,
    KillSwitch,
    LendingMarket,
    LinkCodeResult,
    LendingMarketDetail,
    PerpMarket,
    PerpPosition,
    PerpQuote,
    PredictionMarket,
    PredictionMarketDetail,
    PredictionMarketToken,
    Quote,
    RegisterAgentResult,
    RotateKeysResult,
    StepUpChallenge,
    SuwappuConfig,
    SwapHistoryItem,
    SwapHistoryPagination,
    SwapHistoryResult,
    SwapResult,
    SwapSimulation,
    Token,
    TokenBalance,
    TokenPrice,
    TokenRef,
    WalletPolicy,
    WebhookEvent,
    WebhookEventsResult,
    WebhookPagination,
    WebhookTestResult,
)

DEFAULT_BASE_URL = "https://api.suwappu.bot"


class SuwappuError(Exception):
    """Base error for the Suwappu SDK. Kept for backwards compatibility."""

    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Suwappu API error {status}: {body}")


class SuwappuApiError(SuwappuError):
    """Raised for structured (JSON) API error responses.

    Carries the stable `error_code` (see AgentErrorCode) alongside the raw
    HTTP status and response body, so callers can branch on error type
    without parsing message strings.
    """

    def __init__(
        self,
        status: int,
        body: str,
        *,
        code: AgentErrorCode | str | None = None,
        message: str | None = None,
    ) -> None:
        self.code = code
        self.message = message
        super().__init__(status, body)
        if message:
            self.args = (f"Suwappu API error {status} [{code}]: {message}",)


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
        headers: dict[str, str] | None = None,
    ) -> Any:
        if headers:
            response = await self._client.request(
                method, path, params=params, json=json, headers=headers
            )
        else:
            response = await self._client.request(method, path, params=params, json=json)
        if response.status_code >= 400:
            code: str | None = None
            message: str | None = None
            try:
                error_body = response.json()
                code = error_body.get("error_code")
                message = error_body.get("message") or error_body.get("error")
            except Exception:
                pass
            if code:
                raise SuwappuApiError(
                    response.status_code, response.text, code=code, message=message
                )
            raise SuwappuError(response.status_code, response.text)
        return response.json()

    async def get_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        chain: str | None = None,
        *,
        wallet_address: str | None = None,
        from_chain: str | None = None,
        to_chain: str | None = None,
        slippage: float | None = None,
    ) -> Quote:
        """Get a quote without executing it.

        chain keeps the existing same-chain API. For cross-chain quotes, pass
        from_chain and to_chain. Pass wallet_address when the quote will be
        simulated or prepared for self-custody signing so the route is priced
        against the actual sender.
        """
        payload: dict[str, Any] = {
            "from_token": from_token,
            "to_token": to_token,
            "amount": str(amount),
        }
        if chain is not None:
            payload["chain"] = chain
        if from_chain is not None:
            payload["from_chain"] = from_chain
        if to_chain is not None:
            payload["to_chain"] = to_chain
        if wallet_address is not None:
            payload["wallet_address"] = wallet_address
        if slippage is not None:
            payload["slippage"] = slippage

        data = await self._request(
            "POST",
            "/v1/agent/quote",
            json=payload,
        )
        try:
            return Quote(
                quote_id=data["quote_id"],
                chain_type=data.get("chain_type", ""),
                from_token=TokenRef(**data["from_token"]),
                to_token=TokenRef(**data["to_token"]),
                amount_in=data["amount_in"],
                amount_out=data["amount_out"],
                amount_out_min=data.get("amount_out_min", ""),
                exchange_rate=str(data.get("exchange_rate", "")),
                price_impact=data.get("price_impact", ""),
                route=data.get("route", ""),
                slippage=data.get("slippage", ""),
                dex=data.get("dex", ""),
                expires_in_seconds=data.get("expires_in_seconds", 60),
                chain=data.get("chain"),
                from_chain=data.get("from_chain"),
                to_chain=data.get("to_chain"),
                estimated_gas_usd=data.get("estimated_gas_usd"),
                bridge_fee_usd=data.get("bridge_fee_usd"),
                estimated_time_seconds=data.get("estimated_time_seconds"),
            )
        except KeyError as e:
            raise SuwappuError(
                200,
                f"Malformed quote response from /v1/agent/quote: missing {e}",
            ) from e

    async def execute_managed_swap(
        self, quote_id: str, *, idempotency_key: str | None = None
    ) -> SwapResult:
        """Execute a quote through the server-managed wallet pipeline."""
        data = await self._request(
            "POST",
            "/v1/agent/swap/execute",
            json={"quote_id": quote_id},
            headers={"Idempotency-Key": idempotency_key} if idempotency_key else None,
        )
        try:
            tracking = data.get("tracking") or {}
            return SwapResult(
                swap_id=data["swap_id"],
                status=data["status"],
                tx_hash=data.get("tx_hash"),
                poll_url=tracking.get("poll_url"),
            )
        except KeyError as e:
            raise SuwappuError(
                200,
                f"Malformed swap response from /v1/agent/swap/execute: missing {e}",
            ) from e

    async def execute_swap(self, quote_id: str) -> SwapResult:
        """Backwards-compatible alias for managed execution."""
        return await self.execute_managed_swap(quote_id)

    async def prepare_swap(
        self,
        *,
        quote_id: str,
        wallet_address: str,
    ) -> dict[str, Any]:
        """Build an unsigned self-custody transaction without broadcasting."""
        return await self._request(
            "POST",
            "/v1/agent/swap",
            json={
                "quote_id": quote_id,
                "wallet_address": wallet_address,
            },
        )

    async def simulate_swap(self, *, quote_id: str, wallet_address: str) -> SwapSimulation:
        """Dry-run a swap without broadcasting.

        Use before :meth:`execute_swap` on unfamiliar routes: surfaces reverts
        and gas cost while nothing is at stake.
        """
        data = await self._request(
            "POST",
            "/v1/agent/swap/simulate",
            json={"quote_id": quote_id, "wallet_address": wallet_address},
        )
        return SwapSimulation.model_validate(data)

    async def list_swaps(
        self, *, status: str | None = None, limit: int | None = None, offset: int | None = None
    ) -> SwapHistoryResult:
        """This agent's swap history, newest first."""
        params = {
            k: v
            for k, v in {
                "status": status,
                "limit": str(limit) if limit is not None else None,
                "offset": str(offset) if offset is not None else None,
            }.items()
            if v is not None
        }
        data = await self._request("GET", "/v1/agent/swaps", params=params or None)
        pagination = data.get("pagination") or {}
        return SwapHistoryResult(
            swaps=[SwapHistoryItem.model_validate(x) for x in data.get("swaps", [])],
            pagination=SwapHistoryPagination.model_validate(pagination),
        )

    async def get_portfolio(
        self, wallet_address: str, chain: str | None = None
    ) -> list[TokenBalance]:
        params: dict[str, str] = {"wallet_address": wallet_address}
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/agent/portfolio", params=params)
        if "balances" not in data:
            raise SuwappuError(
                200, "Malformed portfolio response from /v1/agent/portfolio: missing 'balances'"
            )
        try:
            return [
                TokenBalance(
                    symbol=b["symbol"],
                    name=b.get("name", ""),
                    balance=b["balance"],
                    usd_value=b["usd_value"],
                    chain=b["chain"],
                )
                for b in data["balances"]
            ]
        except KeyError as e:
            raise SuwappuError(
                200, f"Malformed portfolio balance entry from /v1/agent/portfolio: missing {e}"
            ) from e

    async def get_prices(self, symbols: str, chain: str | None = None) -> list[TokenPrice]:
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
        data = await self._request("GET", "/v1/agent/tokens", params={"chain": chain})
        if "tokens" not in data:
            raise SuwappuError(
                200, "Malformed tokens response from /v1/agent/tokens: missing 'tokens'"
            )
        try:
            return [
                Token(
                    symbol=t["symbol"],
                    address=t["address"],
                    decimals=t.get("decimals", 0),
                )
                for t in data["tokens"]
            ]
        except KeyError as e:
            raise SuwappuError(
                200, f"Malformed token entry from /v1/agent/tokens: missing {e}"
            ) from e

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

    # --- Agent account management ---

    @property
    def agent(self) -> _AgentNamespace:
        return _AgentNamespace(self)

    # --- Billing (Telegram Mini App auth, not agent API key) ---

    @property
    def billing(self) -> _BillingNamespace:
        return _BillingNamespace(self)

    # --- Agent control plane ---

    @property
    def approvals(self) -> _ApprovalsNamespace:
        return _ApprovalsNamespace(self)

    @property
    def audit(self) -> _AuditNamespace:
        return _AuditNamespace(self)

    @property
    def killswitch(self) -> _KillSwitchNamespace:
        return _KillSwitchNamespace(self)

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
                venue_max_leverage=m.get("venueMaxLeverage", m.get("maxLeverage", 0)),
                mark_price=m["markPrice"],
                funding_rate=m["fundingRate"],
            )
            for m in data.get("markets", [])
        ]

    async def quote(self, market: str, side: str, size: float, leverage: float) -> PerpQuote:
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
            funding_rate=data["fundingRate"],
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
                funding_rate=p["fundingRate"],
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
        data = await self._c._request("GET", "/v1/agent/predict/markets", params=params or None)
        return [
            PredictionMarket(
                id=m.get("id", ""),
                condition_id=m.get("conditionId", ""),
                question=m.get("question", ""),
                outcomes=m.get("outcomes", []),
                outcome_prices=m.get("outcomePrices", []),
                tokens=[
                    PredictionMarketToken(
                        token_id=t.get("tokenId", ""),
                        outcome=t.get("outcome", ""),
                    )
                    for t in m.get("tokens", [])
                ],
                volume=m.get("volume", 0),
                liquidity=m.get("liquidity", 0),
                end_date=m.get("endDate", ""),
                active=m.get("active", False),
                category=m.get("category", ""),
            )
            for m in data.get("markets", [])
        ]

    async def market(self, id: str) -> PredictionMarketDetail:
        data = await self._c._request(
            "GET", f"/v1/agent/predict/market/{quote(id, safe='')}"
        )
        return PredictionMarketDetail(
            id=data.get("id", ""),
            condition_id=data.get("conditionId", ""),
            question=data.get("question", ""),
            description=data.get("description", ""),
            outcomes=data.get("outcomes", []),
            outcome_prices=data.get("outcomePrices", []),
            tokens=[
                PredictionMarketToken(
                    token_id=t.get("tokenId", ""),
                    outcome=t.get("outcome", ""),
                )
                for t in data.get("tokens", [])
            ],
            volume=data.get("volume", 0),
            liquidity=data.get("liquidity", 0),
            end_date=data.get("endDate", ""),
            active=data.get("active", False),
            category=data.get("category", ""),
            created_at=data.get("createdAt", ""),
            resolved_outcome=data.get("resolvedOutcome"),
        )

    async def events(
        self, query: str | None = None, limit: int | None = None
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {}
        if query:
            params["query"] = query
        if limit:
            params["limit"] = str(limit)
        data = await self._c._request("GET", "/v1/agent/predict/events", params=params or None)
        return data.get("events", [])

    async def book(self, market_id: str) -> dict[str, Any]:
        return await self._c._request(
            "GET", f"/v1/agent/predict/market/{quote(market_id, safe='')}/book"
        )

    async def price(self, market_id: str) -> dict[str, Any]:
        return await self._c._request(
            "GET", f"/v1/agent/predict/market/{quote(market_id, safe='')}/price"
        )

    async def trades(self, market_id: str, limit: int | None = 20) -> dict[str, Any]:
        params: dict[str, str] = {}
        if limit:
            params["limit"] = str(limit)
        return await self._c._request(
            "GET",
            f"/v1/agent/predict/market/{quote(market_id, safe='')}/trades",
            params=params or None,
        )

    async def order(
        self,
        *,
        token_id: str,
        price: str,
        size: str,
        side: str,
    ) -> dict[str, Any]:
        data = await self._c._request(
            "POST",
            "/v1/agent/predict/order",
            json={
                "tokenId": token_id,
                "price": price,
                "size": size,
                "side": side,
            },
        )
        return data.get("order", {})

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        return await self._c._request(
            "DELETE", f"/v1/agent/predict/order/{quote(order_id, safe='')}"
        )

    async def positions(self) -> list[dict[str, Any]]:
        data = await self._c._request("GET", "/v1/agent/predict/positions")
        return data.get("positions", [])

    async def orders(self, status: str | None = None) -> list[dict[str, Any]]:
        params = {"status": status} if status else None
        data = await self._c._request("GET", "/v1/agent/predict/orders", params=params)
        if isinstance(data, list):
            return data
        return data.get("orders", [])


class _LendNamespace:
    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def markets(self, chain_id: int | None = None) -> list[LendingMarket]:
        params = {"chainId": str(chain_id)} if chain_id else None
        data = await self._c._request("GET", "/v1/agent/lend/markets", params=params)
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


def _to_agent_profile(data: dict[str, Any]) -> AgentProfile:
    return AgentProfile(
        id=data.get("id", ""),
        name=data.get("name", ""),
        description=data.get("description"),
        callback_url=data.get("callback_url"),
        metadata=data.get("metadata"),
        active=data.get("active", True),
        created_at=data.get("created_at"),
    )


class _AgentNamespace:
    """Agent account management: registration, profile, keys, wallet
    policies, webhooks, and billing top-ups. Mirrors the /v1/agent/* routes
    used by the TypeScript SDK's `client.agent` namespace.
    """

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def register(
        self,
        name: str,
        *,
        description: str | None = None,
        callback_url: str | None = None,
        metadata: dict | None = None,
    ) -> RegisterAgentResult:
        data = await self._c._request(
            "POST",
            "/v1/agent/register",
            json={
                "name": name,
                "description": description,
                "callback_url": callback_url,
                "metadata": metadata,
            },
        )
        agent_data = data.get("agent", {})
        return RegisterAgentResult(
            agent=_to_agent_profile(agent_data),
            api_key=agent_data.get("api_key", ""),
            message=data.get("message"),
            important=data.get("important"),
        )

    async def get_me(self) -> AgentProfile:
        data = await self._c._request("GET", "/v1/agent/me")
        return _to_agent_profile(data.get("agent", {}))

    async def update_me(
        self,
        *,
        description: str | None = None,
        callback_url: str | None = None,
        metadata: dict | None = None,
    ) -> AgentProfile:
        data = await self._c._request(
            "PATCH",
            "/v1/agent/me",
            json={
                "description": description,
                "callback_url": callback_url,
                "metadata": metadata,
            },
        )
        return _to_agent_profile(data.get("agent", {}))

    async def deactivate(self) -> dict[str, Any]:
        return await self._c._request("POST", "/v1/agent/me/deactivate")

    async def reactivate(self) -> dict[str, Any]:
        return await self._c._request("POST", "/v1/agent/reactivate")

    async def rotate_keys(self) -> RotateKeysResult:
        data = await self._c._request("POST", "/v1/agent/keys/rotate")
        return RotateKeysResult(api_key=data.get("api_key", ""), message=data.get("message"))

    async def topup(self, *, tx_hash: str, chain: str, amount: str | None = None) -> dict[str, Any]:
        return await self._c._request(
            "POST",
            "/v1/agent/billing/topup",
            json={"txHash": tx_hash, "chain": chain, "amount": amount},
        )

    async def create_policy(self, **kwargs: Any) -> WalletPolicy:
        data = await self._c._request("POST", "/v1/agent/wallet/policy", json=kwargs)
        return WalletPolicy.model_validate(data.get("policy", {}))

    async def list_policies(self) -> list[WalletPolicy]:
        data = await self._c._request("GET", "/v1/agent/wallet/policies")
        return [WalletPolicy.model_validate(p) for p in data.get("policies", [])]

    async def delete_policy(self, policy_id: str) -> dict[str, Any]:
        return await self._c._request("DELETE", f"/v1/agent/wallet/policy/{policy_id}")

    async def list_webhooks(
        self,
        *,
        status: str | None = None,
        event_type: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> WebhookEventsResult:
        params: dict[str, str] = {}
        if status:
            params["status"] = status
        if event_type:
            params["event_type"] = event_type
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        data = await self._c._request("GET", "/v1/agent/webhooks", params=params or None)
        pagination = data.get("pagination", {})
        return WebhookEventsResult(
            events=[WebhookEvent.model_validate(e) for e in data.get("events", [])],
            pagination=WebhookPagination(
                total=pagination.get("total", 0),
                limit=pagination.get("limit", 0),
                offset=pagination.get("offset", 0),
                has_more=pagination.get("has_more", False),
            ),
        )

    async def create_wallet(self) -> AgentWallet:
        """Provision a managed wallet for this agent.

        Idempotent per agent: an agent that already has a wallet gets it back.
        """
        data = await self._c._request("POST", "/v1/agent/wallets")
        return AgentWallet.model_validate(data.get("wallet", data))

    async def list_wallets(self) -> list[AgentWallet]:
        """Empty until :meth:`create_wallet` has been called."""
        data = await self._c._request("GET", "/v1/agent/wallets")
        return [AgentWallet.model_validate(w) for w in data.get("wallets", [])]

    async def link_code(self) -> LinkCodeResult:
        """Mint a short-lived code the human owner redeems to link this agent.

        Raises a 409 if the agent is already linked to an owner.
        """
        data = await self._c._request("POST", "/v1/agent/link/code")
        return LinkCodeResult.model_validate(data)

    async def test_webhook(self) -> WebhookTestResult:
        data = await self._c._request("POST", "/v1/agent/webhooks/test")
        return WebhookTestResult(
            success=data.get("success", False),
            callback_url=data.get("callback_url"),
            status_code=data.get("status_code"),
            response_time_ms=data.get("response_time_ms"),
            error=data.get("error"),
        )


class _BillingNamespace:
    """Subscription billing. Authenticates via Telegram Mini App auth
    (telegramAuth), not the agent API key — included for SDK completeness.
    """

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def stripe_checkout(self, tier: str, *, format: str = "json") -> BillingCheckoutResult:
        data = await self._c._request(
            "GET", "/billing/stripe/checkout", params={"tier": tier, "format": format}
        )
        return BillingCheckoutResult(url=data.get("url", ""))

    async def pay_crypto(
        self, *, tx_hash: str, amount: float, tier: str, chain: str = "base"
    ) -> dict[str, Any]:
        return await self._c._request(
            "POST",
            "/billing/crypto",
            json={"txHash": tx_hash, "chain": chain, "amount": amount, "tier": tier},
        )

    async def status(self) -> BillingStatus:
        data = await self._c._request("GET", "/billing/status")
        return BillingStatus.model_validate(data)


class _ApprovalsNamespace:
    """Human-in-the-loop approvals.

    Auth note: listing and deciding approvals is an *owner* action and
    authenticates as the linked human (Mini App / owner JWT), not the agent
    API key. Only ``get()`` accepts a plain agent key.
    """

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def list(self, *, status: str | None = None) -> list[Approval]:
        params = {"status": status} if status else None
        data = await self._c._request("GET", "/v1/agent/approvals", params=params)
        return [Approval.model_validate(a) for a in data.get("approvals", [])]

    async def get(self, approval_id: str) -> Approval:
        data = await self._c._request("GET", f"/v1/agent/approvals/{quote(approval_id, safe='')}")
        return Approval.model_validate(data.get("approval", data))

    async def approve(self, approval_id: str, *, step_up_challenge: str | None = None) -> Approval:
        """Approve a pending action.

        When the deployment sets APPROVAL_STEP_UP_REQUIRED=true, get a challenge
        from :meth:`step_up_challenge` first and pass it here.
        """
        data = await self._c._request(
            "POST",
            f"/v1/agent/approvals/{quote(approval_id, safe='')}/approve",
            json={"step_up_challenge": step_up_challenge},
        )
        return Approval.model_validate(data.get("approval", data))

    async def deny(self, approval_id: str) -> Approval:
        data = await self._c._request(
            "POST", f"/v1/agent/approvals/{quote(approval_id, safe='')}/deny"
        )
        return Approval.model_validate(data.get("approval", data))

    async def step_up_challenge(self, approval_id: str) -> StepUpChallenge:
        data = await self._c._request(
            "POST", f"/v1/agent/approvals/{quote(approval_id, safe='')}/step-up/challenge"
        )
        return StepUpChallenge.model_validate(data)


class _AuditNamespace:
    """Tamper-evident audit chain."""

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def list(
        self,
        *,
        event_type: str | None = None,
        agent_id: str | None = None,
        since: str | None = None,
        limit: int | None = None,
    ) -> list[AuditEvent]:
        params = {
            k: v
            for k, v in {
                "event_type": event_type,
                "agent_id": agent_id,
                "since": since,
                "limit": str(limit) if limit is not None else None,
            }.items()
            if v is not None
        }
        data = await self._c._request("GET", "/v1/agent/audit", params=params or None)
        return [AuditEvent.model_validate(e) for e in data.get("events", [])]

    async def verify(self) -> AuditVerifyResult:
        """Recompute the hash chain. Requires an **org** API key.

        Chain verification is inherently whole-chain, and org-less agents share
        one global chain, so the API refuses this for plain agent tokens rather
        than leaking other tenants' rows.
        """
        data = await self._c._request("GET", "/v1/agent/audit/verify")
        return AuditVerifyResult.model_validate(data)


class _KillSwitchNamespace:
    """Org-wide kill switch. Requires an org API key."""

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client

    async def list(self) -> list[KillSwitch]:
        data = await self._c._request("GET", "/v1/agent/killswitch")
        return [KillSwitch.model_validate(k) for k in data.get("killswitches", [])]

    async def set(self, *, scope: str, active: bool, reason: str | None = None) -> KillSwitch:
        data = await self._c._request(
            "POST",
            "/v1/agent/killswitch",
            json={"scope": scope, "active": active, "reason": reason},
        )
        return KillSwitch.model_validate({"scope": scope, "active": active, **(data or {})})


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
