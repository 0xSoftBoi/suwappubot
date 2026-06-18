"""Morpho Blue (Base) — cbBTC-collateralized USDC borrowing + MetaMorpho USDC earn.

Borrow flow (sequential txs, receipt-confirmed each step, no Bundler3):
  cbBTC.approve(MORPHO, exact) → Morpho.supplyCollateral(params, amount, user, "")
  → Morpho.borrow(params, assets, 0, user, user)   # onBehalf == sender, no auth needed
Repay: USDC.approve → repay(params, assets, 0, ...) partial, or
  repay(params, 0, position.borrowShares, ...) for FULL repay (shares-exact kills dust).
Exit: withdrawCollateral(params, amount, user, user) — guarded by a post-withdraw
health-factor floor (MIN_WITHDRAW_HF) unless debt is zero.
Earn: ERC-4626 approve+deposit / redeem on MetaMorpho USDC vaults.

Signing/sending mirrors bot/services/savings_service.py exactly (WalletService →
Turnkey or local key; keys never touch this module). All web3 calls are blocking;
async callers must use asyncio.to_thread.

Money-path invariants:
- exact-amount approvals only (full-repay approves debt + a tiny interest-accrual
  buffer, documented at the call site — never unlimited);
- never auto-borrow beyond the requested amount; total debt is hard-capped at
  MAX_LTV of collateral value;
- market id asserted against keccak(abi.encode(params)) at import/startup.

Oracle staleness: see bot/config/morpho_config.py — we trust the same
MorphoChainlinkOracleV2 the protocol liquidates against (Chainlink heartbeat).
"""

import logging
import math
import time
from typing import Any, Callable, Dict, Optional, TypeVar

from web3 import Web3

from bot.config.morpho_config import (
    BASE_CHAIN_ID,
    CBBTC,
    CBBTC_DECIMALS,
    LLTV,
    MARKET_ID,
    ORACLE_USD_SCALE,
    MARKET_PARAMS,
    MAX_LTV,
    METAMORPHO_SHARE_DECIMALS,
    MIN_WITHDRAW_HF,
    MORPHO_BLUE,
    ORACLE,
    ORACLE_PRICE_SCALE,
    STEAKHOUSE_USDC,
    USDC_BASE,
    USDC_DECIMALS,
    VIRTUAL_ASSETS,
    VIRTUAL_SHARES,
    WAD,
    assert_market_id,
)

T = TypeVar("T")

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://blue-api.morpho.org/graphql"
SECONDS_PER_YEAR = 31_536_000

# Fail fast if the hardcoded market id doesn't match the params it claims to hash.
assert_market_id()

# ── Minimal ABIs ─────────────────────────────────────────────────────────────
_MARKET_PARAMS_COMPONENTS = [
    {"name": "loanToken", "type": "address"},
    {"name": "collateralToken", "type": "address"},
    {"name": "oracle", "type": "address"},
    {"name": "irm", "type": "address"},
    {"name": "lltv", "type": "uint256"},
]

MORPHO_BLUE_ABI = [
    {
        "name": "supplyCollateral",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "marketParams", "type": "tuple", "components": _MARKET_PARAMS_COMPONENTS},
            {"name": "assets", "type": "uint256"},
            {"name": "onBehalf", "type": "address"},
            {"name": "data", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "name": "borrow",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "marketParams", "type": "tuple", "components": _MARKET_PARAMS_COMPONENTS},
            {"name": "assets", "type": "uint256"},
            {"name": "shares", "type": "uint256"},
            {"name": "onBehalf", "type": "address"},
            {"name": "receiver", "type": "address"},
        ],
        "outputs": [
            {"name": "assetsBorrowed", "type": "uint256"},
            {"name": "sharesBorrowed", "type": "uint256"},
        ],
    },
    {
        "name": "repay",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "marketParams", "type": "tuple", "components": _MARKET_PARAMS_COMPONENTS},
            {"name": "assets", "type": "uint256"},
            {"name": "shares", "type": "uint256"},
            {"name": "onBehalf", "type": "address"},
            {"name": "data", "type": "bytes"},
        ],
        "outputs": [
            {"name": "assetsRepaid", "type": "uint256"},
            {"name": "sharesRepaid", "type": "uint256"},
        ],
    },
    {
        "name": "withdrawCollateral",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "marketParams", "type": "tuple", "components": _MARKET_PARAMS_COMPONENTS},
            {"name": "assets", "type": "uint256"},
            {"name": "onBehalf", "type": "address"},
            {"name": "receiver", "type": "address"},
        ],
        "outputs": [],
    },
    {
        "name": "position",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "id", "type": "bytes32"},
            {"name": "user", "type": "address"},
        ],
        "outputs": [
            {"name": "supplyShares", "type": "uint256"},
            {"name": "borrowShares", "type": "uint128"},
            {"name": "collateral", "type": "uint128"},
        ],
    },
    {
        "name": "market",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "id", "type": "bytes32"}],
        "outputs": [
            {"name": "totalSupplyAssets", "type": "uint128"},
            {"name": "totalSupplyShares", "type": "uint128"},
            {"name": "totalBorrowAssets", "type": "uint128"},
            {"name": "totalBorrowShares", "type": "uint128"},
            {"name": "lastUpdate", "type": "uint128"},
            {"name": "fee", "type": "uint128"},
        ],
    },
    {
        "name": "idToMarketParams",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "id", "type": "bytes32"}],
        "outputs": [
            {"name": "loanToken", "type": "address"},
            {"name": "collateralToken", "type": "address"},
            {"name": "oracle", "type": "address"},
            {"name": "irm", "type": "address"},
            {"name": "lltv", "type": "uint256"},
        ],
    },
]

ORACLE_ABI = [
    {
        "name": "price",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    }
]

IRM_ABI = [
    {
        "name": "borrowRateView",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "marketParams", "type": "tuple", "components": _MARKET_PARAMS_COMPONENTS},
            {
                "name": "market",
                "type": "tuple",
                "components": [
                    {"name": "totalSupplyAssets", "type": "uint128"},
                    {"name": "totalSupplyShares", "type": "uint128"},
                    {"name": "totalBorrowAssets", "type": "uint128"},
                    {"name": "totalBorrowShares", "type": "uint128"},
                    {"name": "lastUpdate", "type": "uint128"},
                    {"name": "fee", "type": "uint128"},
                ],
            },
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    }
]

ERC4626_ABI = [
    {
        "name": "deposit",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "assets", "type": "uint256"},
            {"name": "receiver", "type": "address"},
        ],
        "outputs": [{"name": "shares", "type": "uint256"}],
    },
    {
        "name": "redeem",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "shares", "type": "uint256"},
            {"name": "receiver", "type": "address"},
            {"name": "owner", "type": "address"},
        ],
        "outputs": [{"name": "assets", "type": "uint256"}],
    },
    {
        "name": "withdraw",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "assets", "type": "uint256"},
            {"name": "receiver", "type": "address"},
            {"name": "owner", "type": "address"},
        ],
        "outputs": [{"name": "shares", "type": "uint256"}],
    },
    {
        "name": "convertToAssets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "maxWithdraw",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "totalAssets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]

ERC20_ABI = [
    {
        "name": "approve",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "allowance",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
]


class MorphoError(Exception):
    """User-safe Morpho error — message may be surfaced in the UI."""


class _SentTx(Exception):
    """A raw tx was broadcast but a follow-up step failed — never retry elsewhere."""


# ── Pure math (unit-tested, no web3) ─────────────────────────────────────────


def shares_to_assets_up(shares: int, total_assets: int, total_shares: int) -> int:
    """SharesMathLib.toAssetsUp: shares.mulDivUp(totalAssets + 1, totalShares + 1e6)."""
    numerator = shares * (total_assets + VIRTUAL_ASSETS)
    denominator = total_shares + VIRTUAL_SHARES
    return (numerator + denominator - 1) // denominator


def collateral_value_usdc_raw(collateral_raw: int, price: int) -> int:
    """Collateral value in USDC raw units: collateral.mulDivDown(price, 1e36)."""
    return collateral_raw * price // ORACLE_PRICE_SCALE


def max_borrow_usdc_raw(collateral_raw: int, price: int, lltv: int = LLTV) -> int:
    """Protocol liquidation threshold: collateralValue.wMulDown(lltv)."""
    return collateral_value_usdc_raw(collateral_raw, price) * lltv // WAD


def compute_health_factor(collateral_raw: int, price: int, debt_usdc_raw: int) -> float:
    """HF = maxBorrow / debt. inf when debt is zero."""
    if debt_usdc_raw <= 0:
        return math.inf
    return max_borrow_usdc_raw(collateral_raw, price) / debt_usdc_raw


def compute_ltv(collateral_raw: int, price: int, debt_usdc_raw: int) -> float:
    """Current LTV = debt / collateralValue (0.0 when no collateral or no debt)."""
    if debt_usdc_raw <= 0:
        return 0.0
    value = collateral_value_usdc_raw(collateral_raw, price)
    if value <= 0:
        return math.inf
    return debt_usdc_raw / value


def compute_liquidation_price(collateral_raw: int, debt_usdc_raw: int) -> float:
    """BTC price (USD) at which the position becomes liquidatable.

    Liquidation when collateral_btc * price_usd * LLTV == debt_usd, so
    price = debt / (collateral * LLTV), converted out of raw units.
    """
    if debt_usdc_raw <= 0 or collateral_raw <= 0:
        return 0.0
    debt_usd = debt_usdc_raw / 10**USDC_DECIMALS
    collateral_btc = collateral_raw / 10**CBBTC_DECIMALS
    return debt_usd / (collateral_btc * (LLTV / WAD))


def rate_per_second_to_apy(rate_wad: int) -> float:
    """AdaptiveCurveIRM per-second rate (wad) → compounded APY fraction."""
    r = rate_wad / WAD
    return math.expm1(r * SECONDS_PER_YEAR)


class MorphoAPI:
    """Direct web3.py client for Morpho Blue + MetaMorpho vaults on Base."""

    # ── plumbing (mirrors SavingsService) ────────────────────────────────────

    def _get_web3(self) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3("base")

    def _failover(self, op: Callable[[Web3], T], attempts: int = 4) -> T:
        """Run op(web3) across Base RPCs. A _SentTx (tx already broadcast) is
        NEVER retried on another endpoint — that could double-send."""
        from bot.services.rpc_manager import rpc_manager

        urls = rpc_manager.get_all_urls("base")[:attempts]
        if not urls:
            return op(self._get_web3())

        last_exc: Optional[Exception] = None
        for url in urls:
            web3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 15}))
            started = time.monotonic()
            try:
                result = op(web3)
                rpc_manager.report_success("base", url, (time.monotonic() - started) * 1000)
                return result
            except _SentTx:
                rpc_manager.report_failure("base", url, "post-send failure")
                raise
            except MorphoError:
                raise  # validation/user error, not an RPC problem
            except Exception as e:
                rpc_manager.report_failure("base", url, str(e))
                logger.warning(f"morpho RPC failed on {url[:48]}: {e}")
                last_exc = e
        raise last_exc if last_exc is not None else MorphoError("No Base RPC available.")

    def _sign_transaction(self, wallet, tx: dict) -> bytes:
        """Sign via WalletService.sign_evm_transaction (Turnkey or local). Keys
        are handled (and zeroized) inside WalletService — never here."""
        import asyncio as _asyncio

        from bot.services.wallet import WalletService

        signed_hex = _asyncio.run(WalletService().sign_evm_transaction(wallet, tx))
        if signed_hex.startswith("0x"):
            signed_hex = signed_hex[2:]
        return bytes.fromhex(signed_hex)

    def _build_and_send(self, web3: Web3, wallet, contract_fn) -> str:
        """nonce + gasPrice + estimate_gas + sign + send + wait_for_receipt."""
        from_addr = Web3.to_checksum_address(wallet.address)
        nonce = web3.eth.get_transaction_count(from_addr)
        gas_price = web3.eth.gas_price
        tx = contract_fn.build_transaction(
            {
                "from": from_addr,
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": BASE_CHAIN_ID,
            }
        )
        tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.2)

        raw = self._sign_transaction(wallet, tx)
        tx_hash = web3.eth.send_raw_transaction(raw)
        try:
            receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        except Exception as e:
            raise _SentTx(f"receipt wait failed for {tx_hash.hex()}: {e}") from e
        if receipt.get("status") != 1:
            raise MorphoError("Transaction failed on-chain. No funds were moved.")
        return tx_hash.hex()

    def _send_seq(self, web3: Web3, wallet, fns: list) -> list:
        """Send contract calls sequentially, waiting for each receipt.

        Once the FIRST tx is broadcast, any later failure is re-raised as
        _SentTx so the _failover loop can never replay the whole sequence on
        another RPC (which would double-send the already-mined txs).
        """
        tx_hashes: list = []
        for fn in fns:
            try:
                tx_hashes.append(self._build_and_send(web3, wallet, fn))
            except (_SentTx, MorphoError):
                raise
            except Exception as e:
                if tx_hashes:
                    raise _SentTx(
                        f"step {len(tx_hashes) + 1} failed after txs {tx_hashes}: {e}"
                    ) from e
                raise
        return tx_hashes

    # ── contract accessors ────────────────────────────────────────────────────

    def _morpho(self, web3: Web3):
        return web3.eth.contract(address=Web3.to_checksum_address(MORPHO_BLUE), abi=MORPHO_BLUE_ABI)

    def _oracle(self, web3: Web3):
        return web3.eth.contract(address=Web3.to_checksum_address(ORACLE), abi=ORACLE_ABI)

    def _erc20(self, web3: Web3, address: str):
        return web3.eth.contract(address=Web3.to_checksum_address(address), abi=ERC20_ABI)

    def _vault(self, web3: Web3, address: str):
        return web3.eth.contract(address=Web3.to_checksum_address(address), abi=ERC4626_ABI)

    @staticmethod
    def _market_params_tuple() -> tuple:
        l, c, o, i, lltv = MARKET_PARAMS
        return (
            Web3.to_checksum_address(l),
            Web3.to_checksum_address(c),
            Web3.to_checksum_address(o),
            Web3.to_checksum_address(i),
            lltv,
        )

    @staticmethod
    def _market_id_bytes() -> bytes:
        return bytes.fromhex(MARKET_ID[2:])

    # ── reads ─────────────────────────────────────────────────────────────────

    def _read_state(self, web3: Web3, user: Optional[str] = None) -> Dict[str, Any]:
        """One-shot read of market + oracle (+ optional user position)."""
        morpho = self._morpho(web3)
        mid = self._market_id_bytes()
        market = morpho.functions.market(mid).call()
        price = self._oracle(web3).functions.price().call()
        out: Dict[str, Any] = {
            "total_supply_assets": int(market[0]),
            "total_supply_shares": int(market[1]),
            "total_borrow_assets": int(market[2]),
            "total_borrow_shares": int(market[3]),
            "last_update": int(market[4]),
            "fee": int(market[5]),
            "price": int(price),
        }
        if user is not None:
            pos = morpho.functions.position(mid, Web3.to_checksum_address(user)).call()
            out["supply_shares"] = int(pos[0])
            out["borrow_shares"] = int(pos[1])
            out["collateral_raw"] = int(pos[2])
        return out

    @staticmethod
    def _position_from_state(state: Dict[str, Any]) -> Dict[str, Any]:
        collateral_raw = state["collateral_raw"]
        borrow_shares = state["borrow_shares"]
        price = state["price"]
        debt_raw = shares_to_assets_up(
            borrow_shares, state["total_borrow_assets"], state["total_borrow_shares"]
        )
        return {
            "collateral_raw": collateral_raw,
            "collateral_btc": collateral_raw / 10**CBBTC_DECIMALS,
            "borrow_shares": borrow_shares,
            "debt_usdc_raw": debt_raw,
            "debt_usdc": debt_raw / 10**USDC_DECIMALS,
            "collateral_value_usdc_raw": collateral_value_usdc_raw(collateral_raw, price),
            "collateral_value_usdc": collateral_value_usdc_raw(collateral_raw, price)
            / 10**USDC_DECIMALS,
            "price_raw": price,
            "btc_price_usd": price / ORACLE_USD_SCALE,
            "ltv": compute_ltv(collateral_raw, price, debt_raw),
            "health_factor": compute_health_factor(collateral_raw, price, debt_raw),
            "liquidation_price": compute_liquidation_price(collateral_raw, debt_raw),
        }

    def get_position(self, user: str) -> Dict[str, Any]:
        """User's borrow position with derived health metrics.

        NOTE: totalBorrowAssets is as of the market's lastUpdate — interest since
        then is not included, so debt can be a hair stale (basis points/day).
        Health alerts and the full-repay buffer account for this.
        """
        try:
            state = self._failover(lambda web3: self._read_state(web3, user))
            return self._position_from_state(state)
        except MorphoError:
            raise
        except Exception as e:
            logger.warning(f"morpho get_position failed for {user[:8]}: {e}")
            raise MorphoError("Could not fetch your Morpho position. Try again shortly.")

    def get_market_state(self) -> Dict[str, Any]:
        """Market totals + oracle price + utilization."""
        try:
            state = self._failover(lambda web3: self._read_state(web3))
            tba, tsa = state["total_borrow_assets"], state["total_supply_assets"]
            state["utilization"] = (tba / tsa) if tsa > 0 else 0.0
            state["btc_price_usd"] = state["price"] / ORACLE_USD_SCALE
            return state
        except MorphoError:
            raise
        except Exception as e:
            logger.warning(f"morpho get_market_state failed: {e}")
            raise MorphoError("Could not fetch the Morpho market state. Try again shortly.")

    def get_vault_info(self, vault: str, user: Optional[str] = None) -> Dict[str, Any]:
        """MetaMorpho vault TVL + share price (+ optional user balance)."""

        def _op(web3: Web3) -> Dict[str, Any]:
            v = self._vault(web3, vault)
            total_assets = int(v.functions.totalAssets().call())
            one_share = 10**METAMORPHO_SHARE_DECIMALS
            share_price = int(v.functions.convertToAssets(one_share).call()) / 10**USDC_DECIMALS
            out: Dict[str, Any] = {
                "vault": Web3.to_checksum_address(vault),
                "tvl_usdc": total_assets / 10**USDC_DECIMALS,
                "share_price": share_price,
            }
            if user is not None:
                owner = Web3.to_checksum_address(user)
                shares = int(v.functions.balanceOf(owner).call())
                assets = int(v.functions.convertToAssets(shares).call()) if shares else 0
                out["shares_raw"] = shares
                out["balance_usdc_raw"] = assets
                out["balance_usdc"] = assets / 10**USDC_DECIMALS
                out["max_withdraw_raw"] = int(v.functions.maxWithdraw(owner).call())
            return out

        try:
            return self._failover(_op)
        except MorphoError:
            raise
        except Exception as e:
            logger.warning(f"morpho get_vault_info failed for {vault[:8]}: {e}")
            raise MorphoError("Could not fetch the vault info. Try again shortly.")

    # ── GraphQL (blue-api.morpho.org) with on-chain fallback ─────────────────

    async def _graphql(self, query: str, variables: Optional[dict] = None) -> Optional[dict]:
        """POST to the Morpho GraphQL API; returns `data` or None on any failure."""
        try:
            import aiohttp

            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    GRAPHQL_URL, json={"query": query, "variables": variables or {}}
                ) as resp:
                    if resp.status != 200:
                        logger.warning(f"morpho graphql HTTP {resp.status}")
                        return None
                    body = await resp.json()
                    if body.get("errors"):
                        logger.warning(f"morpho graphql errors: {str(body['errors'])[:200]}")
                        return None
                    return body.get("data")
        except Exception as e:
            logger.warning(f"morpho graphql unavailable: {str(e)[:200]}")
            return None

    async def get_market_apys(self) -> Dict[str, Any]:
        """Borrow/supply APY + utilization. GraphQL first (field is `marketId` —
        `marketByUniqueKey` is gone), on-chain IRM fallback when the API is down."""
        query = """
        query MarketApys($marketId: String!) {
          markets(where: { marketId_in: [$marketId] }) {
            items {
              marketId
              state { borrowApy supplyApy utilization }
            }
          }
        }
        """
        data = await self._graphql(query, {"marketId": MARKET_ID})
        try:
            items = data["markets"]["items"]  # type: ignore[index]
            st = items[0]["state"]
            return {
                "borrow_apy": float(st["borrowApy"]),
                "supply_apy": float(st["supplyApy"]),
                "utilization": float(st["utilization"]),
                "source": "graphql",
            }
        except Exception:
            pass

        # Fallback: AdaptiveCurveIRM borrowRateView (per-second wad) on-chain.
        import asyncio

        def _onchain() -> Dict[str, Any]:
            def _op(web3: Web3) -> Dict[str, Any]:
                state = self._read_state(web3)
                irm = web3.eth.contract(
                    address=Web3.to_checksum_address(MARKET_PARAMS[3]), abi=IRM_ABI
                )
                market_tuple = (
                    state["total_supply_assets"],
                    state["total_supply_shares"],
                    state["total_borrow_assets"],
                    state["total_borrow_shares"],
                    state["last_update"],
                    state["fee"],
                )
                rate = int(
                    irm.functions.borrowRateView(self._market_params_tuple(), market_tuple).call()
                )
                borrow_apy = rate_per_second_to_apy(rate)
                tsa = state["total_supply_assets"]
                util = (state["total_borrow_assets"] / tsa) if tsa > 0 else 0.0
                return {
                    "borrow_apy": borrow_apy,
                    # fee switch is off on this market → suppliers earn borrow*util
                    "supply_apy": borrow_apy * util,
                    "utilization": util,
                    "source": "onchain",
                }

            return self._failover(_op)

        try:
            return await asyncio.to_thread(_onchain)
        except Exception as e:
            logger.warning(f"morpho on-chain APY fallback failed: {e}")
            raise MorphoError("Could not fetch Morpho rates. Try again shortly.")

    async def get_vault_apys(self, chain_id: int = BASE_CHAIN_ID) -> list:
        """Listed MetaMorpho USDC vaults with netApy; empty list when API is down
        (callers fall back to get_vault_info on-chain reads, without APY)."""
        query = """
        query Vaults($chainId: Int!) {
          vaults(where: { listed: true, chainId_in: [$chainId] }) {
            items {
              address
              name
              state { netApy totalAssetsUsd }
            }
          }
        }
        """
        data = await self._graphql(query, {"chainId": chain_id})
        try:
            items = data["vaults"]["items"]  # type: ignore[index]
            return [
                {
                    "address": it["address"],
                    "name": it.get("name"),
                    "net_apy": float(it["state"]["netApy"]),
                    "tvl_usd": float(it["state"]["totalAssetsUsd"]),
                }
                for it in items
            ]
        except Exception:
            return []

    # ── confirm-screen helpers ────────────────────────────────────────────────

    def preview_borrow(
        self, user: str, add_collateral_raw: int, borrow_usdc_raw: int
    ) -> Dict[str, Any]:
        """What the position looks like AFTER a proposed supply+borrow — for the
        confirmation screen. Always includes liquidation_price."""
        state = self._failover(lambda web3: self._read_state(web3, user))
        collateral = state["collateral_raw"] + int(add_collateral_raw)
        existing_debt = shares_to_assets_up(
            state["borrow_shares"], state["total_borrow_assets"], state["total_borrow_shares"]
        )
        debt = existing_debt + int(borrow_usdc_raw)
        price = state["price"]
        return {
            "collateral_raw": collateral,
            "debt_usdc_raw": debt,
            "ltv": compute_ltv(collateral, price, debt),
            "health_factor": compute_health_factor(collateral, price, debt),
            "liquidation_price": compute_liquidation_price(collateral, debt),
            "max_ltv": MAX_LTV,
            "btc_price_usd": price / ORACLE_USD_SCALE,
        }

    # ── writes ────────────────────────────────────────────────────────────────

    def open_borrow(self, wallet, collateral_raw: int, borrow_usdc_raw: int) -> list:
        """Supply cbBTC collateral and borrow USDC against it (sequential txs,
        each receipt-confirmed before the next).

        Enforces: resulting TOTAL debt ≤ MAX_LTV × TOTAL collateral value
        (policy cap 64.5%, well under the protocol's 86% LLTV). Never borrows
        more than requested. Returns tx hashes [approve, supplyCollateral, borrow].
        """
        collateral_raw = int(collateral_raw)
        borrow_usdc_raw = int(borrow_usdc_raw)
        if collateral_raw <= 0:
            raise MorphoError("Collateral amount must be greater than zero.")
        if borrow_usdc_raw < 0:
            raise MorphoError("Borrow amount cannot be negative.")
        owner = Web3.to_checksum_address(wallet.address)

        def _op(web3: Web3) -> list:
            state = self._read_state(web3, owner)
            balance = self._erc20(web3, CBBTC).functions.balanceOf(owner).call()
            if balance < collateral_raw:
                raise MorphoError(
                    f"Insufficient cbBTC. You have {balance / 10**CBBTC_DECIMALS:.8f} "
                    f"but tried to deposit {collateral_raw / 10**CBBTC_DECIMALS:.8f}."
                )

            new_collateral = state["collateral_raw"] + collateral_raw
            existing_debt = shares_to_assets_up(
                state["borrow_shares"],
                state["total_borrow_assets"],
                state["total_borrow_shares"],
            )
            total_value = collateral_value_usdc_raw(new_collateral, state["price"])
            max_debt = int(total_value * MAX_LTV)
            if borrow_usdc_raw > 0 and existing_debt + borrow_usdc_raw > max_debt:
                raise MorphoError(
                    f"Borrow exceeds the {MAX_LTV:.1%} LTV cap. "
                    f"Max additional borrow: {max(0, max_debt - existing_debt) / 10**USDC_DECIMALS:.2f} USDC."
                )

            # 1. exact-amount cbBTC approval to Morpho; 2. supplyCollateral;
            # 3. borrow exactly the requested assets (shares=0).
            fns = [
                self._erc20(web3, CBBTC).functions.approve(
                    Web3.to_checksum_address(MORPHO_BLUE), collateral_raw
                ),
                self._morpho(web3).functions.supplyCollateral(
                    self._market_params_tuple(), collateral_raw, owner, b""
                ),
            ]
            if borrow_usdc_raw > 0:
                fns.append(
                    self._morpho(web3).functions.borrow(
                        self._market_params_tuple(), borrow_usdc_raw, 0, owner, owner
                    )
                )
            tx_hashes = self._send_seq(web3, wallet, fns)
            logger.info(
                f"morpho open_borrow: collateral={collateral_raw} borrow={borrow_usdc_raw} "
                f"txs={tx_hashes}"
            )
            return tx_hashes

        return self._run_write(_op, "borrow")

    def add_collateral(self, wallet, collateral_raw: int) -> list:
        """Supply additional cbBTC collateral (no borrow)."""
        return self.open_borrow(wallet, collateral_raw, 0)

    def repay(self, wallet, assets_raw: Optional[int] = None) -> list:
        """Repay USDC debt.

        assets_raw=None → FULL repay via repay(params, 0, borrowShares, ...) —
        shares-exact, kills interest dust. The approval covers current debt plus
        a 0.1% buffer (interest accrues between approve and repay; at 10% APR
        0.1% covers ~3.5 days — leftover allowance dust is to Morpho only and
        revoked implicitly on next exact approve).
        assets_raw=<int> → partial repay of exactly that many USDC raw units.
        """
        owner = Web3.to_checksum_address(wallet.address)

        def _op(web3: Web3) -> list:
            state = self._read_state(web3, owner)
            borrow_shares = state["borrow_shares"]
            if borrow_shares <= 0:
                raise MorphoError("You have no Morpho debt to repay.")
            debt = shares_to_assets_up(
                borrow_shares, state["total_borrow_assets"], state["total_borrow_shares"]
            )

            full_repay = assets_raw is None
            if full_repay:
                approve_amount = debt + max(1, debt // 1000)  # +0.1% accrual buffer
                repay_fn = self._morpho(web3).functions.repay(
                    self._market_params_tuple(), 0, borrow_shares, owner, b""
                )
            else:
                amount = int(assets_raw)
                if amount <= 0:
                    raise MorphoError("Repay amount must be greater than zero.")
                if amount >= debt:
                    raise MorphoError(
                        "Amount covers your whole debt — use full repay instead "
                        "(it clears interest dust exactly)."
                    )
                approve_amount = amount
                repay_fn = self._morpho(web3).functions.repay(
                    self._market_params_tuple(), amount, 0, owner, b""
                )

            usdc = self._erc20(web3, USDC_BASE)
            morpho_addr = Web3.to_checksum_address(MORPHO_BLUE)
            balance = usdc.functions.balanceOf(owner).call()
            if full_repay:
                # Block only when genuinely short of the DEBT itself; the buffer
                # is best-effort headroom for interest accrued between approve
                # and repay. balance == debt exactly is allowed.
                if balance < debt:
                    raise MorphoError(
                        f"Insufficient USDC. Need {debt / 10**USDC_DECIMALS:.2f}, "
                        f"you have {balance / 10**USDC_DECIMALS:.2f}."
                    )
                if balance < approve_amount:
                    approve_amount = balance  # still covers debt
            elif balance < approve_amount:
                raise MorphoError(
                    f"Insufficient USDC. Need {approve_amount / 10**USDC_DECIMALS:.2f}, "
                    f"you have {balance / 10**USDC_DECIMALS:.2f}."
                )

            approve_fn = usdc.functions.approve(morpho_addr, approve_amount)
            tx_hashes = self._send_seq(web3, wallet, [approve_fn, repay_fn])
            logger.info(f"morpho repay: assets={assets_raw} txs={tx_hashes}")

            if full_repay:
                # Exact-approval invariant: revoke any residual allowance left by
                # the accrual buffer. Best-effort — the repay already succeeded,
                # so a revoke failure must not surface as a repay failure.
                try:
                    residual = int(usdc.functions.allowance(owner, morpho_addr).call())
                    if residual > 0:
                        revoke_fn = usdc.functions.approve(morpho_addr, 0)
                        tx_hashes.append(self._build_and_send(web3, wallet, revoke_fn))
                except Exception as e:
                    logger.warning(f"morpho repay: allowance revoke skipped: {e}")
            return tx_hashes

        return self._run_write(_op, "repayment")

    def withdraw_collateral(self, wallet, collateral_raw: Optional[int] = None) -> list:
        """Withdraw cbBTC collateral. If debt remains, the post-withdraw health
        factor must stay ≥ MIN_WITHDRAW_HF (1.1).

        collateral_raw=None → withdraw ALL collateral, using the LIVE on-chain
        amount read inside the op (never a number cached by the caller — the
        position can change, e.g. a partial liquidation, between render and
        execution)."""
        withdraw_all = collateral_raw is None
        if not withdraw_all:
            collateral_raw = int(collateral_raw)
            if collateral_raw <= 0:
                raise MorphoError("Withdrawal amount must be greater than zero.")
        owner = Web3.to_checksum_address(wallet.address)

        def _op(web3: Web3) -> list:
            state = self._read_state(web3, owner)
            amount = state["collateral_raw"] if withdraw_all else collateral_raw
            if amount <= 0:
                raise MorphoError("You have no collateral to withdraw.")
            if state["collateral_raw"] < amount:
                raise MorphoError(
                    f"You only have {state['collateral_raw'] / 10**CBBTC_DECIMALS:.8f} cbBTC "
                    "of collateral."
                )
            debt = shares_to_assets_up(
                state["borrow_shares"], state["total_borrow_assets"], state["total_borrow_shares"]
            )
            remaining = state["collateral_raw"] - amount
            if debt > 0:
                hf_after = compute_health_factor(remaining, state["price"], debt)
                if hf_after < MIN_WITHDRAW_HF:
                    raise MorphoError(
                        f"Withdrawal would drop your health factor to {hf_after:.2f} "
                        f"(minimum {MIN_WITHDRAW_HF}). Repay debt first or withdraw less."
                    )
            fn = self._morpho(web3).functions.withdrawCollateral(
                self._market_params_tuple(), amount, owner, owner
            )
            tx_hash = self._build_and_send(web3, wallet, fn)
            logger.info(f"morpho withdraw_collateral: {amount} tx={tx_hash}")
            return [tx_hash]

        return self._run_write(_op, "withdrawal")

    def vault_deposit(self, wallet, assets_raw: int, vault: Optional[str] = None) -> list:
        """ERC-4626 earn deposit: exact-amount USDC approve to the VAULT, then
        vault.deposit(assets, receiver=user)."""
        assets_raw = int(assets_raw)
        if assets_raw <= 0:
            raise MorphoError("Deposit amount must be greater than zero.")
        vault_addr = Web3.to_checksum_address(vault or self._default_vault())
        owner = Web3.to_checksum_address(wallet.address)

        def _op(web3: Web3) -> list:
            balance = self._erc20(web3, USDC_BASE).functions.balanceOf(owner).call()
            if balance < assets_raw:
                raise MorphoError(
                    f"Insufficient USDC. You have {balance / 10**USDC_DECIMALS:.2f} "
                    f"but tried to deposit {assets_raw / 10**USDC_DECIMALS:.2f}."
                )
            approve_fn = self._erc20(web3, USDC_BASE).functions.approve(vault_addr, assets_raw)
            deposit_fn = self._vault(web3, vault_addr).functions.deposit(assets_raw, owner)
            tx_hashes = self._send_seq(web3, wallet, [approve_fn, deposit_fn])
            logger.info(f"morpho vault_deposit: {assets_raw} → {vault_addr} txs={tx_hashes}")
            return tx_hashes

        return self._run_write(_op, "vault deposit")

    def vault_redeem(
        self, wallet, shares_raw: Optional[int] = None, vault: Optional[str] = None
    ) -> list:
        """ERC-4626 redeem. shares_raw=None → redeem the full share balance.
        No approval needed (owner == msg.sender)."""
        vault_addr = Web3.to_checksum_address(vault or self._default_vault())
        owner = Web3.to_checksum_address(wallet.address)

        def _op(web3: Web3) -> list:
            v = self._vault(web3, vault_addr)
            balance = int(v.functions.balanceOf(owner).call())
            shares = balance if shares_raw is None else int(shares_raw)
            if shares <= 0:
                raise MorphoError("Nothing to withdraw from this vault.")
            if shares > balance:
                raise MorphoError("You don't have that many vault shares.")
            fn = v.functions.redeem(shares, owner, owner)
            tx_hash = self._build_and_send(web3, wallet, fn)
            logger.info(f"morpho vault_redeem: {shares} shares from {vault_addr} tx={tx_hash}")
            return [tx_hash]

        return self._run_write(_op, "vault withdrawal")

    # ── DB position registry (used by the health monitor; handlers call these) ─

    def record_position_open(self, user_id: int, wallet_id: Optional[int]) -> None:
        """Upsert an open morpho_positions row for monitoring."""
        try:
            from bot.models.morpho import MorphoPosition
            from database.db import get_session

            with get_session() as session:
                row = (
                    session.query(MorphoPosition)
                    .filter(
                        MorphoPosition.user_id == user_id,
                        MorphoPosition.wallet_id == wallet_id,
                        MorphoPosition.market_id == MARKET_ID,
                        MorphoPosition.closed_at.is_(None),
                    )
                    .first()
                )
                if row is None:
                    session.add(
                        MorphoPosition(user_id=user_id, wallet_id=wallet_id, market_id=MARKET_ID)
                    )
                session.commit()
        except Exception as e:
            logger.warning(f"morpho record_position_open failed: {e}")

    def record_position_closed(self, user_id: int, wallet_id: Optional[int]) -> None:
        """Mark the open morpho_positions row closed (debt repaid + collateral out)."""
        try:
            from datetime import datetime, timezone

            from bot.models.morpho import MorphoPosition
            from database.db import get_session

            with get_session() as session:
                rows = (
                    session.query(MorphoPosition)
                    .filter(
                        MorphoPosition.user_id == user_id,
                        MorphoPosition.wallet_id == wallet_id,
                        MorphoPosition.market_id == MARKET_ID,
                        MorphoPosition.closed_at.is_(None),
                    )
                    .all()
                )
                for row in rows:
                    row.closed_at = datetime.now(timezone.utc)
                session.commit()
        except Exception as e:
            logger.warning(f"morpho record_position_closed failed: {e}")

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _default_vault() -> str:
        try:
            from bot.config.settings import settings

            return getattr(settings, "morpho_vault_default", None) or STEAKHOUSE_USDC
        except Exception:
            return STEAKHOUSE_USDC

    def _run_write(self, op: Callable[[Web3], list], label: str) -> list:
        try:
            return self._failover(op)
        except MorphoError:
            raise
        except _SentTx as e:
            logger.error(f"morpho {label} post-send failure: {e}")
            raise MorphoError(
                f"Your {label} was submitted but confirmation timed out. "
                "Check your wallet on basescan before retrying."
            )
        except Exception as e:
            logger.error(f"morpho {label} failed: {e}", exc_info=True)
            raise MorphoError(
                f"{label.capitalize()} failed. Your funds were not moved. Try again shortly."
            )


morpho_api = MorphoAPI()
