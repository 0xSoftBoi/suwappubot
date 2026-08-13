from __future__ import annotations

import asyncio
import inspect
import json
import os
from typing import Any, Awaitable, Callable
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
    DataMetadata,
    DataStatus,
    DataUsage,
    KillSwitch,
    LendingMarket,
    LinkCodeResult,
    LendingMarketDetail,
    LiveCandle,
    LiveTick,
    OhlcvMultiResult,
    OhlcvResult,
    PerpMarket,
    PerpPosition,
    PerpQuote,
    PredictionMarket,
    PredictionMarketDetail,
    PredictionMarketToken,
    Quote,
    ReferenceChain,
    ReferenceTokensResult,
    RegisterAgentResult,
    ResolvedSymbol,
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


class _LiveSubscription:
    """Handle returned by :meth:`SuwappuClient.subscribe_live`.

    Wraps the underlying `websockets` connection and the background task
    driving the receive loop.
    """

    def __init__(self, ws: Any, task: "asyncio.Task[None]") -> None:
        self._ws = ws
        self._task = task

    async def subscribe(self, symbols: list[str]) -> None:
        """Add symbols to the live tick subscription."""
        await self._ws.send(json.dumps({"action": "subscribe", "symbols": [s.upper() for s in symbols]}))

    async def unsubscribe(self, symbols: list[str]) -> None:
        """Remove symbols from the live tick subscription."""
        await self._ws.send(
            json.dumps({"action": "unsubscribe", "symbols": [s.upper() for s in symbols]})
        )

    async def subscribe_candles(self, symbols: list[str]) -> None:
        """Add symbols to the 1m OHLCV candle subscription (`ohlcv` channel)."""
        await self._ws.send(
            json.dumps(
                {
                    "action": "subscribe",
                    "channel": "ohlcv",
                    "timeframe": "1m",
                    "symbols": [s.upper() for s in symbols],
                }
            )
        )

    async def unsubscribe_candles(self, symbols: list[str]) -> None:
        """Remove symbols from the 1m OHLCV candle subscription."""
        await self._ws.send(
            json.dumps(
                {
                    "action": "unsubscribe",
                    "channel": "ohlcv",
                    "timeframe": "1m",
                    "symbols": [s.upper() for s in symbols],
                }
            )
        )

    async def close(self) -> None:
        """Cancel the receive loop and close the WebSocket connection."""
        self._task.cancel()
        await self._ws.close()


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

        self._api_key = api_key
        self._base_url = base_url
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

    async def _request_text(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
    ) -> str:
        """Like `_request`, but returns the raw response text (used for `format=csv`)."""
        response = await self._client.request(method, path, params=params)
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
        return response.text

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

    # --- Market data (/v1/data/*) ---

    async def get_ohlcv(
        self,
        symbol: str,
        chain: str,
        *,
        timeframe: str = "1h",
        start: str | int | None = None,
        end: str | int | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> OhlcvResult:
        """GET /v1/data/history/ohlcv — historical candles.

        Served from persisted candles when available; falls back to a
        DexScreener-derived synthetic series otherwise (see `.source` on the
        result). `timeframe` is one of "1m", "5m", "1h", "1d". `start`/`end`
        accept an ISO 8601 string or unix seconds. Pass `cursor` (from a
        previous result's `.next_cursor`) to page forward.
        """
        params: dict[str, str] = {"symbol": symbol, "chain": chain, "timeframe": timeframe}
        if start is not None:
            params["start"] = str(start)
        if end is not None:
            params["end"] = str(end)
        if limit is not None:
            params["limit"] = str(limit)
        if cursor is not None:
            params["cursor"] = cursor
        data = await self._request("GET", "/v1/data/history/ohlcv", params=params)
        return OhlcvResult.model_validate(data)

    async def get_ohlcv_multi(
        self,
        symbols: list[str],
        chain: str,
        *,
        timeframe: str = "1h",
        start: str | int | None = None,
        end: str | int | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> OhlcvMultiResult:
        """GET /v1/data/history/ohlcv?symbols=A,B — the multi-symbol variant
        of `get_ohlcv`, grouped by symbol in the response."""
        params: dict[str, str] = {"symbols": ",".join(symbols), "chain": chain, "timeframe": timeframe}
        if start is not None:
            params["start"] = str(start)
        if end is not None:
            params["end"] = str(end)
        if limit is not None:
            params["limit"] = str(limit)
        if cursor is not None:
            params["cursor"] = cursor
        data = await self._request("GET", "/v1/data/history/ohlcv", params=params)
        return OhlcvMultiResult.model_validate(data)

    async def get_ohlcv_csv(
        self,
        *,
        symbol: str | None = None,
        symbols: list[str] | None = None,
        chain: str,
        timeframe: str = "1h",
        start: str | int | None = None,
        end: str | int | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> str:
        """GET /v1/data/history/ohlcv?...&format=csv — returns the raw CSV
        text (header: symbol,chain,timeframe,ts,open,high,low,close,volume,source).
        Pass exactly one of `symbol` or `symbols`."""
        params: dict[str, str] = {"chain": chain, "timeframe": timeframe, "format": "csv"}
        if symbols:
            params["symbols"] = ",".join(symbols)
        elif symbol:
            params["symbol"] = symbol
        if start is not None:
            params["start"] = str(start)
        if end is not None:
            params["end"] = str(end)
        if limit is not None:
            params["limit"] = str(limit)
        if cursor is not None:
            params["cursor"] = cursor
        return await self._request_text("GET", "/v1/data/history/ohlcv", params=params)

    async def get_reference_chains(self) -> list[ReferenceChain]:
        """GET /v1/data/reference/chains — supported chain slugs + names."""
        data = await self._request("GET", "/v1/data/reference/chains")
        return [ReferenceChain.model_validate(c) for c in data.get("chains", [])]

    async def get_reference_tokens(self, chain: str | None = None) -> ReferenceTokensResult:
        """GET /v1/data/reference/tokens?chain=... — omit `chain` for every
        chain's registry at once (see `.chains` on the result in that case)."""
        params = {"chain": chain} if chain else None
        data = await self._request("GET", "/v1/data/reference/tokens", params=params)
        return ReferenceTokensResult.model_validate(data)

    async def resolve_symbol(self, symbol: str, chain: str | None = None) -> ResolvedSymbol:
        """GET /v1/data/reference/resolve?symbol=&chain= — canonical
        address/decimals/coingecko id for a symbol on a chain. Omitting
        `chain` now returns entries across every known chain on the API side;
        this method still returns the single-pair shape for backward
        compatibility — use `resolve_symbols([symbol])` for the grouped
        all-chains result."""
        params: dict[str, str] = {"symbol": symbol}
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/data/reference/resolve", params=params)
        return ResolvedSymbol.model_validate(data)

    async def resolve_symbols(
        self, symbols: list[str], chain: str | None = None
    ) -> dict[str, list[ResolvedSymbol]]:
        """GET /v1/data/reference/resolve?symbols=A,B[&chain=] — batch
        resolve, grouped by symbol. Without `chain`, each symbol's list
        covers every known chain; with `chain`, each list has 0 or 1 entries.
        """
        params: dict[str, str] = {"symbols": ",".join(symbols)}
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/data/reference/resolve", params=params)
        results = data.get("results", {})
        return {
            symbol: [ResolvedSymbol.model_validate(e) for e in entries]
            for symbol, entries in results.items()
        }

    async def resolve_address(self, address: str, chain: str) -> ResolvedSymbol:
        """GET /v1/data/reference/resolve?address=0x...&chain= — reverse
        lookup: canonical address -> symbol/decimals."""
        data = await self._request(
            "GET", "/v1/data/reference/resolve", params={"address": address, "chain": chain}
        )
        return ResolvedSymbol.model_validate(data)

    async def get_data_usage(self) -> DataUsage:
        """GET /v1/data/usage — this caller's /v1/data/* request counts."""
        data = await self._request("GET", "/v1/data/usage")
        return DataUsage.model_validate(data)

    async def get_data_metadata(
        self, *, symbol: str | None = None, chain: str | None = None
    ) -> DataMetadata:
        """GET /v1/data/metadata?symbol=&chain= — dataset coverage from
        `market_candles`, grouped by (symbol, chain, timeframe). Omit both
        params to list every tracked dataset (capped at 500 — see
        `.truncated`)."""
        params: dict[str, str] = {}
        if symbol:
            params["symbol"] = symbol
        if chain:
            params["chain"] = chain
        data = await self._request("GET", "/v1/data/metadata", params=params or None)
        return DataMetadata.model_validate(data)

    async def get_data_status(self) -> DataStatus:
        """GET /v1/data/status — capture freshness per timeframe (newest
        candle + age in seconds) plus per-source candle counts. `.healthy`
        is true when 1m data is fresher than 5 minutes."""
        data = await self._request("GET", "/v1/data/status")
        return DataStatus.model_validate(data)

    def _ws_url(self, path: str) -> str:
        base = self._base_url.rstrip("/")
        if base.startswith("https://"):
            base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            base = "ws://" + base[len("http://") :]
        return f"{base}{path}"

    async def subscribe_live(
        self,
        symbols: list[str] | str,
        on_tick: Callable[[LiveTick], Any | Awaitable[Any]],
        *,
        candle_symbols: list[str] | str | None = None,
        on_candle: Callable[[LiveCandle], Any | Awaitable[Any]] | None = None,
        on_error: Callable[[Exception], Any | Awaitable[Any]] | None = None,
    ) -> "_LiveSubscription":
        """WS /v1/data/live — subscribe to live price ticks, pushed on
        change (plus a ~30s keepalive when unchanged). `on_tick` (and
        `on_error`) may be sync or async callables.

        Pass `candle_symbols` (+ `on_candle`) to also subscribe to the 1m
        OHLCV candle channel — `on_candle` fires with the in-progress candle
        on each price change, and once more (`final=True`) when the minute
        closes.

        Requires the optional `websockets` dependency:
        `pip install "suwappu[live]"`. Runs the receive loop as a background
        asyncio task; use the returned handle's `.subscribe()`,
        `.unsubscribe()`, `.subscribe_candles()`, `.unsubscribe_candles()`,
        and `.close()` to manage the connection.

        ```python
        live = await client.subscribe_live(
            ["ETH", "SOL"],
            on_tick=lambda t: print(t.symbol, t.price_usd),
            candle_symbols=["ETH"],
            on_candle=lambda c: print(c.symbol, c.close, c.final),
        )
        # later:
        await live.subscribe(["BTC"])
        await live.close()
        ```
        """
        try:
            import websockets
        except ImportError as e:
            raise ImportError(
                "subscribe_live() requires the optional 'websockets' dependency. "
                'Install it with: pip install "suwappu[live]"'
            ) from e

        if isinstance(symbols, str):
            symbols = [s.strip() for s in symbols.split(",") if s.strip()]
        if isinstance(candle_symbols, str):
            candle_symbols = [s.strip() for s in candle_symbols.split(",") if s.strip()]

        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else None
        ws = await websockets.connect(self._ws_url("/v1/data/live"), additional_headers=headers)

        async def _dispatch(fn: Callable[..., Any], *fn_args: Any) -> None:
            result = fn(*fn_args)
            if inspect.isawaitable(result):
                await result

        async def _run() -> None:
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    if msg.get("type") == "tick":
                        tick = LiveTick(
                            symbol=msg.get("symbol", ""),
                            price_usd=msg.get("price_usd", 0),
                            ts=msg.get("ts", ""),
                        )
                        await _dispatch(on_tick, tick)
                    elif msg.get("type") == "candle" and on_candle is not None:
                        candle = LiveCandle(
                            symbol=msg.get("symbol", ""),
                            final=bool(msg.get("final", False)),
                            ts=msg.get("ts", ""),
                            open=msg.get("open", 0),
                            high=msg.get("high", 0),
                            low=msg.get("low", 0),
                            close=msg.get("close", 0),
                        )
                        await _dispatch(on_candle, candle)
                    elif msg.get("type") == "error" and on_error is not None:
                        await _dispatch(on_error, RuntimeError(msg.get("message", "live stream error")))
            except asyncio.CancelledError:
                pass
            except Exception as err:  # connection dropped, etc.
                if on_error is not None:
                    await _dispatch(on_error, err)

        task = asyncio.create_task(_run())
        await ws.send(json.dumps({"action": "subscribe", "symbols": [s.upper() for s in symbols]}))
        if candle_symbols:
            await ws.send(
                json.dumps(
                    {
                        "action": "subscribe",
                        "channel": "ohlcv",
                        "timeframe": "1m",
                        "symbols": [s.upper() for s in candle_symbols],
                    }
                )
            )
        return _LiveSubscription(ws, task)

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
        params = {"chainId": str(chain_id)} if chain_id is not None else None
        data = await self._c._request("GET", "/v1/agent/lend/markets", params=params)
        return [
            LendingMarket(
                id=m["id"],
                loan_token=m["loanToken"],
                collateral_token=m["collateralToken"],
                lltv=m["lltv"],
                supply_apy=m["supplyApy"],
                borrow_apy=m["borrowApy"],
                total_supply=m["totalSupply"],
                total_borrow=m["totalBorrow"],
                total_supply_usd=m["totalSupplyUsd"],
                total_borrow_usd=m["totalBorrowUsd"],
                available_liquidity_usd=m["availableLiquidityUsd"],
                utilization=m["utilization"],
                chain_id=m["chainId"],
                listed=m["listed"],
                warnings=m["warnings"],
            )
            for m in data.get("markets", [])
        ]

    async def market(self, id: str, chain_id: int | None = None) -> LendingMarketDetail:
        params = {"chainId": str(chain_id)} if chain_id is not None else None
        data = await self._c._request(
            "GET", f"/v1/agent/lend/market/{quote(id, safe='')}", params=params
        )
        return LendingMarketDetail(
            id=data["id"],
            loan_token=data["loanToken"],
            collateral_token=data["collateralToken"],
            lltv=data["lltv"],
            supply_apy=data["supplyApy"],
            borrow_apy=data["borrowApy"],
            total_supply=data["totalSupply"],
            total_borrow=data["totalBorrow"],
            total_supply_usd=data["totalSupplyUsd"],
            total_borrow_usd=data["totalBorrowUsd"],
            available_liquidity_usd=data["availableLiquidityUsd"],
            utilization=data["utilization"],
            chain_id=data["chainId"],
            listed=data["listed"],
            warnings=data["warnings"],
            oracle=data["oracle"],
            irm=data["irm"],
            created_at=data["createdAt"],
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
