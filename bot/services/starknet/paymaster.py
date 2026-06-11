"""AVNU SNIP-29 paymaster client (Starknet gasless UX — Phase 2).

Hand-rolled JSON-RPC client over httpx for https://starknet.paymaster.avnu.fi
(override via settings.starknet_paymaster_url, e.g. the Sepolia paymaster).

SNIP-29 contract (verified from starknet.js paymaster/rpc.ts + types-js):
- paymaster_isAvailable            -> bool
- paymaster_getSupportedTokens     -> list of accepted gas tokens
- paymaster_buildTransaction       -> typed_data (SNIP-12) to sign + fee estimate
    request: {transaction: {type: "invoke"|"deploy"|"deploy_and_invoke",
                            invoke?: {user_address, calls},
                            deployment?: {address, class_hash, salt, calldata, version: 1}},
              parameters: {version: "0x1",
                           fee_mode: {mode: "sponsored"} | {mode: "default", gas_token},
                           time_bounds?: {execute_after, execute_before}}}
- paymaster_executeTransaction     -> {tracking_id, transaction_hash}
    request: {transaction: {type, invoke?: {user_address, typed_data, signature},
                            deployment?}, parameters}

Pure "deploy" requires NO user signature. "deploy_and_invoke" deploys the
account and runs the first action in one sponsored call. Sponsored mode needs
the `x-paymaster-api-key` header; gas-token ("default") mode needs no key.

starknet_py is imported lazily (signing only) so the bot boots without it.
"""

import logging
import time
from typing import Optional

import httpx

from bot.config.settings import settings
from bot.config.starknet_addresses import ARGENT_V040_CLASS_HASH

logger = logging.getLogger(__name__)

# Typed-data signatures expire after this many seconds (spec: keep <= 5 min).
EXECUTE_WINDOW_SECONDS = 300


class PaymasterError(Exception):
    """Raised for any AVNU paymaster JSON-RPC failure."""

    def __init__(self, message: str, response: Optional[dict] = None):
        self.message = message
        self.response = response
        super().__init__(self.message)


class PaymasterUnavailableError(PaymasterError):
    """Raised when paymaster_isAvailable returns false (callers should fall back)."""


def _to_hex(value) -> str:
    """Normalize int/decimal-str/hex-str to a 0x-prefixed hex felt string."""
    if isinstance(value, int):
        return hex(value)
    s = str(value).strip()
    if s.lower().startswith("0x"):
        return s
    return hex(int(s))


def build_argent_deployment(address: str, public_key: int) -> dict:
    """ACCOUNT_DEPLOYMENT_DATA for our Argent v0.4.0 counterfactual wallets.

    salt = owner pubkey, constructor calldata = [0, pubkey, 0]
    (signer_type=Starknet, owner pubkey, guardian=None) — matches
    WalletService._compute_starknet_address.
    """
    pk_hex = hex(public_key)
    return {
        "address": _to_hex(address),
        "class_hash": ARGENT_V040_CLASS_HASH,
        "salt": pk_hex,
        "calldata": ["0x0", pk_hex, "0x0"],
        "version": 1,
    }


class AvnuPaymaster:
    """JSON-RPC client for the AVNU SNIP-29 paymaster service."""

    def __init__(self, base_url: Optional[str] = None):
        self._base_url = base_url

    @property
    def base_url(self) -> str:
        return self._base_url or settings.starknet_paymaster_url

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        # Sponsored mode only — gas-token ("default") mode needs no key, and
        # sending a bogus key could get the request rejected.
        if settings.avnu_paymaster_api_key:
            headers["x-paymaster-api-key"] = settings.avnu_paymaster_api_key
        return headers

    async def _rpc(self, method: str, params: dict) -> dict:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(self.base_url, json=payload, headers=self._headers())
        try:
            data = response.json()
        except Exception:
            data = {"raw": response.text}
        if response.status_code >= 400:
            raise PaymasterError(f"Paymaster HTTP {response.status_code}: {str(data)[:200]}", data)
        if isinstance(data, dict) and data.get("error"):
            err = data["error"]
            raise PaymasterError(
                f"Paymaster RPC error ({method}): "
                f"{err.get('message', err) if isinstance(err, dict) else err}",
                data,
            )
        return data.get("result") if isinstance(data, dict) else data

    # ------------------------------------------------------------------
    # SNIP-29 primitives
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        try:
            return bool(await self._rpc("paymaster_isAvailable", {}))
        except Exception as e:
            logger.warning("Paymaster availability check failed: %s", str(e)[:200])
            return False

    async def get_supported_tokens(self) -> list[dict]:
        """Accepted gas tokens: [{token_address, decimals, price_in_strk}, ...]."""
        result = await self._rpc("paymaster_getSupportedTokens", {})
        return result or []

    def fee_mode(self, gas_token: Optional[str] = None) -> dict:
        """Sponsored when an API key is configured, else default (user pays in gas_token)."""
        if settings.avnu_paymaster_api_key:
            return {"mode": "sponsored"}
        if not gas_token:
            raise PaymasterError(
                "No paymaster API key configured and no gas_token supplied — "
                "default fee mode requires a gas token"
            )
        return {"mode": "default", "gas_token": _to_hex(gas_token)}

    @staticmethod
    def _time_bounds() -> dict:
        now = int(time.time())
        return {
            "execute_after": hex(now - 60),
            "execute_before": hex(now + EXECUTE_WINDOW_SECONDS),
        }

    @staticmethod
    def _format_calls(calls: list[dict]) -> list[dict]:
        """Normalize calls to SNIP-29 {to, selector, calldata} hex shape.

        Accepts AVNU-build-shaped dicts ({to|contractAddress, entrypoint|selector,
        calldata}). Entrypoint names are hashed via starknet_py (lazy import).
        """
        formatted = []
        for c in calls:
            to = c.get("to") or c.get("contractAddress")
            selector = c.get("selector")
            if selector is None:
                from starknet_py.hash.selector import get_selector_from_name

                selector = get_selector_from_name(c["entrypoint"])
            formatted.append(
                {
                    "to": _to_hex(to),
                    "selector": _to_hex(selector),
                    "calldata": [_to_hex(x) for x in (c.get("calldata") or [])],
                }
            )
        return formatted

    async def build_transaction(
        self,
        user_address: Optional[str] = None,
        calls: Optional[list[dict]] = None,
        deployment: Optional[dict] = None,
        fee_mode: Optional[dict] = None,
        time_bounds: bool = True,
    ) -> dict:
        """paymaster_buildTransaction — returns {type, typed_data?, parameters, fee}."""
        if calls and deployment:
            transaction = {
                "type": "deploy_and_invoke",
                "deployment": deployment,
                "invoke": {
                    "user_address": _to_hex(user_address),
                    "calls": self._format_calls(calls),
                },
            }
        elif calls:
            transaction = {
                "type": "invoke",
                "invoke": {
                    "user_address": _to_hex(user_address),
                    "calls": self._format_calls(calls),
                },
            }
        elif deployment:
            transaction = {"type": "deploy", "deployment": deployment}
        else:
            raise PaymasterError("build_transaction needs calls and/or deployment")

        parameters: dict = {"version": "0x1", "fee_mode": fee_mode or self.fee_mode()}
        if time_bounds and transaction["type"] != "deploy":
            parameters["time_bounds"] = self._time_bounds()

        return await self._rpc(
            "paymaster_buildTransaction",
            {"transaction": transaction, "parameters": parameters},
        )

    async def execute_transaction(
        self,
        tx_type: str,
        user_address: Optional[str] = None,
        typed_data: Optional[dict] = None,
        signature: Optional[list[str]] = None,
        deployment: Optional[dict] = None,
        parameters: Optional[dict] = None,
    ) -> str:
        """paymaster_executeTransaction — returns the transaction_hash hex string."""
        transaction: dict = {"type": tx_type}
        if deployment is not None:
            transaction["deployment"] = deployment
        if tx_type in ("invoke", "deploy_and_invoke"):
            transaction["invoke"] = {
                "user_address": _to_hex(user_address),
                "typed_data": typed_data,
                "signature": signature or [],
            }
        result = await self._rpc(
            "paymaster_executeTransaction",
            {"transaction": transaction, "parameters": parameters or {"version": "0x1"}},
        )
        tx_hash = (result or {}).get("transaction_hash")
        if not tx_hash:
            raise PaymasterError("Paymaster execute returned no transaction_hash", result)
        return _to_hex(tx_hash)

    # ------------------------------------------------------------------
    # Signing
    # ------------------------------------------------------------------

    @staticmethod
    def sign_typed_data(account, typed_data: dict) -> list[str]:
        """Sign the SNIP-12 typed data returned by paymaster_buildTransaction.

        Uses starknet_py's Account.sign_message, which hashes the typed data
        per SNIP-12 (domain incl. chainId + the signer's account address) and
        signs with the account's stark key. starknet_py >= 0.28 accepts either
        a TypedData object (TypedData.from_dict) or the raw dict; we normalize
        through from_dict so revision/preset parsing is explicit. Returns the
        signature as a list of hex felt strings, as SNIP-29 expects.

        NOTE: the typed data embeds an SNIP-9 nonce and our time_bounds
        (execute_before = now + 300s); a signature is single-use and expires.
        """
        from starknet_py.utils.typed_data import TypedData

        td = TypedData.from_dict(typed_data) if isinstance(typed_data, dict) else typed_data
        signature = account.sign_message(td)
        return [hex(int(s)) for s in signature]

    # ------------------------------------------------------------------
    # High-level helpers
    # ------------------------------------------------------------------

    async def deploy_account_via_paymaster(
        self,
        address: str,
        public_key: int,
        gas_token: Optional[str] = None,
    ) -> str:
        """Deploy an Argent v0.4.0 counterfactual account (type "deploy").

        Pure deploys need NO user signature per SNIP-29. Returns the tx hash.
        """
        deployment = build_argent_deployment(address, public_key)
        fee_mode = self.fee_mode(gas_token)
        build = await self.build_transaction(deployment=deployment, fee_mode=fee_mode)
        parameters = (build or {}).get("parameters") or {"version": "0x1", "fee_mode": fee_mode}
        return await self.execute_transaction(
            tx_type="deploy", deployment=deployment, parameters=parameters
        )

    async def execute_calls_via_paymaster(
        self,
        account,
        calls: list[dict],
        gas_token: Optional[str] = None,
        deployment: Optional[dict] = None,
    ) -> str:
        """Execute calls gaslessly: "invoke", or "deploy_and_invoke" when the
        account is undeployed (pass the deployment data built from the wallet's
        stored pubkey). Builds, signs the returned typed data, executes.
        """
        if not await self.is_available():
            raise PaymasterUnavailableError("AVNU paymaster is not available")

        fee_mode = self.fee_mode(gas_token)
        user_address = hex(account.address)
        build = await self.build_transaction(
            user_address=user_address,
            calls=calls,
            deployment=deployment,
            fee_mode=fee_mode,
        )
        typed_data = (build or {}).get("typed_data")
        if not typed_data:
            raise PaymasterError("Paymaster build returned no typed_data", build)
        signature = self.sign_typed_data(account, typed_data)
        parameters = build.get("parameters") or {"version": "0x1", "fee_mode": fee_mode}
        return await self.execute_transaction(
            tx_type="deploy_and_invoke" if deployment else "invoke",
            user_address=user_address,
            typed_data=typed_data,
            signature=signature,
            deployment=deployment,
            parameters=parameters,
        )


# Global instance
avnu_paymaster = AvnuPaymaster()
