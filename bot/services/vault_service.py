"""Generic, chain-agnostic ERC-4626 vault engine.

Cross-protocol yield across any chain the repo has an RPC for: read a
vault's config from bot/config/vaults.py, and this service can price it,
show a user's position, and deposit/withdraw — no protocol-specific code
per vault, because ERC-4626 defines a common interface (asset, totalAssets,
convertToAssets, previewDeposit, previewRedeem, deposit, redeem).

Signing/sending and RPC failover mirror bot/services/morpho_api.py exactly
(same _get_web3 / _failover / _sign_transaction / _build_and_send / _send_seq
patterns), generalized to take a chain name instead of being Base-only. All
web3 calls are blocking — async callers (handlers) must use asyncio.to_thread.

APY: computed generically from share-price growth (convertToAssets(1 share)
now vs. ~7 days ago), annualized. If the historical read is unavailable for
any reason, APY is None — we never fabricate or hardcode a number. Results
are cached in-process (TTL ~1h) to avoid hammering RPCs with historical
block lookups on every /earn render.

Money-path invariants (mirrors morpho_api.vault_deposit / vault_redeem):
- exact-amount approvals only, never unlimited;
- deposit does a pre-flight balance check against the underlying asset;
- withdraw with shares_raw=None redeems the full live on-chain share balance
  (never a number cached from an earlier screen);
- once the first tx of a sequence is broadcast, a later failure never
  triggers a retry on another RPC (that could double-send) — see _SentTx.
"""

import logging
import threading
import time
from typing import Any, Callable, Dict, Optional, TypeVar

from web3 import Web3

from bot.config.vaults import VaultConfig, get_vault

T = TypeVar("T")

logger = logging.getLogger(__name__)

# Chain id per chain name — kept local (not imported from morpho_config, which
# is Base-only) since this service is intentionally multi-chain.
CHAIN_IDS: Dict[str, int] = {
    "ethereum": 1,
    "base": 8453,
}

# Roughly the average block time per chain, used to estimate how many blocks
# back ~7 days is before refining via actual block timestamps.
AVG_BLOCK_SECONDS: Dict[str, float] = {
    "ethereum": 12.0,
    "base": 2.0,
}

APY_LOOKBACK_SECONDS = 7 * 24 * 3600  # ~7 days
APY_CACHE_TTL_SECONDS = 3600  # ~1h for a successfully computed APY
# Archive-RPC rejection (see _historical_share_price docstring) is a property
# of the endpoint's config, not a transient blip — retrying every 5 minutes
# just re-hammers the same rejecting endpoints on every /earn render and adds
# thread-pool pressure (fix for earn.py cold-cache latency). 30 min still
# recovers promptly if an operator swaps in an archive-capable endpoint.
APY_NONE_CACHE_TTL_SECONDS = 1800  # ~30min for "unavailable"

# Below this, a single block-timestamp's granularity/estimation error can
# dominate the growth ratio when annualized — refuse rather than annualize.
MIN_APY_ELAPSED_SECONDS = 24 * 3600  # ~24h
# An honest ERC-4626 share-price APY is never this high; treat a reading
# above it as a bad/stale historical sample (wrong block, dust vault, RPC
# lying) rather than fabricate a headline number. "APY is measured, never
# invented" — this is the ceiling half of that guarantee.
APY_CEILING = 2.0  # 200%

# A partial-withdraw request within this fraction of the live full position
# value redeems the ENTIRE share balance instead — no dust left behind, and
# no ambiguity between "redeem some" and "redeem everything" (fix for the
# earn.py partial-withdraw-drains-everything defect). Kept tight (0.1%, not
# the old buggy code's 0.5%) so a deliberate near-but-not-full request (e.g.
# 996,000 of a 1,000,000 position — 99.6%) stays a genuine partial redeem
# instead of silently draining the whole position.
FULL_REDEEM_EPSILON = 0.001

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
        "name": "convertToAssets",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "previewDeposit",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "assets", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "previewRedeem",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "convertToShares",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "assets", "type": "uint256"}],
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
]


class VaultError(Exception):
    """User-safe vault error — message may be surfaced in the UI."""


class _SentTx(Exception):
    """A raw tx was broadcast but a follow-up step failed — never retry elsewhere."""


def _require_vault(vault_key: str) -> VaultConfig:
    cfg = get_vault(vault_key)
    if cfg is None:
        raise VaultError(f"Unknown vault '{vault_key}'.")
    return cfg


class VaultService:
    """Generic ERC-4626 read/write engine, driven entirely by bot/config/vaults.py."""

    def __init__(self) -> None:
        self._apy_cache: Dict[str, tuple] = {}  # key -> (value_or_None, expires_at)
        self._apy_lock = threading.Lock()

    # ── plumbing (mirrors MorphoAPI/SavingsService, generalized to any chain) ──

    def _get_web3(self, chain: str) -> Web3:
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain)

    def _failover(self, chain: str, op: Callable[[Web3], T], attempts: int = 4) -> T:
        """Run op(web3) across `chain`'s RPCs. A _SentTx (tx already broadcast)
        is NEVER retried on another endpoint — that could double-send."""
        from bot.services.rpc_manager import rpc_manager

        urls = rpc_manager.get_all_urls(chain)[:attempts]
        if not urls:
            return op(self._get_web3(chain))

        last_exc: Optional[Exception] = None
        for url in urls:
            web3 = Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 15}))
            started = time.monotonic()
            try:
                result = op(web3)
                rpc_manager.report_success(chain, url, (time.monotonic() - started) * 1000)
                return result
            except _SentTx:
                rpc_manager.report_failure(chain, url, "post-send failure")
                raise
            except VaultError:
                raise  # validation/user error, not an RPC problem
            except Exception as e:
                rpc_manager.report_failure(chain, url, str(e))
                logger.warning(f"vault RPC failed on {chain}/{url[:48]}: {e}")
                last_exc = e
        raise last_exc if last_exc is not None else VaultError(f"No {chain} RPC available.")

    def _sign_transaction(self, wallet, tx: dict) -> bytes:
        """Sign via WalletService.sign_evm_transaction (Turnkey or local). Keys
        are handled (and zeroized) inside WalletService — never here."""
        import asyncio as _asyncio

        from bot.services.wallet import WalletService

        signed_hex = _asyncio.run(WalletService().sign_evm_transaction(wallet, tx))
        if signed_hex.startswith("0x"):
            signed_hex = signed_hex[2:]
        return bytes.fromhex(signed_hex)

    def _build_and_send(self, web3: Web3, wallet, contract_fn, chain_id: int) -> str:
        """nonce + gasPrice + estimate_gas + sign + send + wait_for_receipt."""
        from_addr = Web3.to_checksum_address(wallet.address)
        nonce = web3.eth.get_transaction_count(from_addr)
        gas_price = web3.eth.gas_price
        tx = contract_fn.build_transaction(
            {
                "from": from_addr,
                "nonce": nonce,
                "gasPrice": gas_price,
                "chainId": chain_id,
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
            raise VaultError("Transaction failed on-chain. No funds were moved.")
        return tx_hash.hex()

    def _send_seq(self, web3: Web3, wallet, fns: list, chain_id: int) -> list:
        """Send contract calls sequentially, waiting for each receipt.

        Once the FIRST tx is broadcast, any later failure is re-raised as
        _SentTx so the _failover loop can never replay the whole sequence on
        another RPC (which would double-send the already-mined txs).
        """
        tx_hashes: list = []
        for fn in fns:
            try:
                tx_hashes.append(self._build_and_send(web3, wallet, fn, chain_id))
            except (_SentTx, VaultError):
                raise
            except Exception as e:
                if tx_hashes:
                    raise _SentTx(
                        f"step {len(tx_hashes) + 1} failed after txs {tx_hashes}: {e}"
                    ) from e
                raise
        return tx_hashes

    # ── contract accessors ────────────────────────────────────────────────────

    def _vault_contract(self, web3: Web3, address: str):
        return web3.eth.contract(address=Web3.to_checksum_address(address), abi=ERC4626_ABI)

    def _erc20(self, web3: Web3, address: str):
        return web3.eth.contract(address=Web3.to_checksum_address(address), abi=ERC20_ABI)

    def _run_write(self, chain: str, op: Callable[[Web3], list], label: str) -> list:
        try:
            return self._failover(chain, op)
        except VaultError:
            raise
        except _SentTx as e:
            logger.error(f"vault {label} post-send failure: {e}")
            raise VaultError(
                f"Your {label} was submitted but confirmation timed out. "
                "Check a block explorer before retrying."
            )
        except Exception as e:
            logger.error(f"vault {label} failed: {e}", exc_info=True)
            raise VaultError(
                f"{label.capitalize()} failed. Your funds were not moved. Try again shortly."
            )

    # ── reads ─────────────────────────────────────────────────────────────────

    def get_position(self, vault_key: str, address: str) -> Dict[str, Any]:
        """User's vault position: shares, assets, asset symbol/decimals."""
        cfg = _require_vault(vault_key)
        owner = Web3.to_checksum_address(address)

        def _op(web3: Web3) -> Dict[str, Any]:
            v = self._vault_contract(web3, cfg.vault_address)
            shares_raw = int(v.functions.balanceOf(owner).call())
            assets_raw = int(v.functions.convertToAssets(shares_raw).call()) if shares_raw else 0
            return {
                "vault_key": cfg.key,
                "shares_raw": shares_raw,
                "shares": shares_raw / 10**cfg.share_decimals,
                "assets_raw": assets_raw,
                "assets": assets_raw / 10**cfg.asset_decimals,
                "asset_symbol": cfg.asset_symbol,
                "asset_decimals": cfg.asset_decimals,
                "usd_value": None,  # no reliable generic USD oracle across all assets
            }

        try:
            return self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault get_position failed for {vault_key}/{address[:8]}: {e}")
            raise VaultError("Could not fetch your vault position. Try again shortly.")

    def get_asset_balance(self, vault_key: str, address: str) -> Dict[str, Any]:
        """Wallet's idle (un-deposited) balance of a vault's underlying asset."""
        cfg = _require_vault(vault_key)
        owner = Web3.to_checksum_address(address)

        def _op(web3: Web3) -> Dict[str, Any]:
            balance_raw = int(
                self._erc20(web3, cfg.asset_address).functions.balanceOf(owner).call()
            )
            return {
                "balance_raw": balance_raw,
                "balance": balance_raw / 10**cfg.asset_decimals,
                "asset_symbol": cfg.asset_symbol,
                "asset_decimals": cfg.asset_decimals,
            }

        try:
            return self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault get_asset_balance failed for {vault_key}/{address[:8]}: {e}")
            raise VaultError(f"Could not fetch your {cfg.asset_symbol} balance. Try again shortly.")

    def preview_deposit(self, vault_key: str, assets_raw: int) -> int:
        """Shares a deposit of `assets_raw` would mint (previewDeposit)."""
        cfg = _require_vault(vault_key)
        assets_raw = int(assets_raw)

        def _op(web3: Web3) -> int:
            v = self._vault_contract(web3, cfg.vault_address)
            return int(v.functions.previewDeposit(assets_raw).call())

        try:
            return self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault preview_deposit failed for {vault_key}: {e}")
            raise VaultError("Could not preview this deposit. Try again shortly.")

    def preview_redeem(self, vault_key: str, shares_raw: int) -> int:
        """Assets a redeem of `shares_raw` would return (previewRedeem)."""
        cfg = _require_vault(vault_key)
        shares_raw = int(shares_raw)

        def _op(web3: Web3) -> int:
            v = self._vault_contract(web3, cfg.vault_address)
            return int(v.functions.previewRedeem(shares_raw).call())

        try:
            return self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault preview_redeem failed for {vault_key}: {e}")
            raise VaultError("Could not preview this withdrawal. Try again shortly.")

    @staticmethod
    def annualize_share_price_growth(
        now_price: int, past_price: int, elapsed_seconds: int
    ) -> Optional[float]:
        """Pure math: (now/then) ** (365/days) - 1. None on any degenerate input.

        Verified against real sUSDe data (2026-08-26, Ethereum mainnet):
        now=1245101738337669501, then=1244937217373833839 (~7d apart) →
        ratio 1.000132152 → annualized ≈ 0.69%.
        """
        if now_price <= 0 or past_price <= 0 or elapsed_seconds <= 0:
            return None
        if elapsed_seconds < MIN_APY_ELAPSED_SECONDS:
            return None
        days = elapsed_seconds / 86400.0
        if days <= 0:
            return None
        growth = now_price / past_price
        try:
            apy = (growth ** (365.0 / days)) - 1.0
        except (OverflowError, ValueError):
            return None
        if apy > APY_CEILING:
            return None
        return apy

    def _historical_share_price(
        self, cfg: VaultConfig, one_share: int, latest_block_number: int, latest_timestamp: int
    ) -> Optional[tuple]:
        """Best-effort read of convertToAssets(1 share) at a block ~7 days back.

        EMPIRICAL FINDING (2026-08-26): most public RPC endpoints reject
        historical eth_call — publicnode ("Archive requests require a
        personal token"), ankr (needs an API key), cloudflare-eth (internal
        error). Only a subset of endpoints (e.g. drpc.org) actually serve
        archive state. So an archive failure here is the EXPECTED path, not
        an edge case — we try every configured RPC for this chain in turn
        (a working current-state endpoint is not necessarily an archive
        node) and return None only once all of them have failed. Never
        raise out of this method; the caller treats None as "APY unknown".
        """
        from bot.services.rpc_manager import rpc_manager

        urls = rpc_manager.get_all_urls(cfg.chain)[:4]
        avg_block_s = AVG_BLOCK_SECONDS.get(cfg.chain, 12.0)
        est_blocks_back = int(APY_LOOKBACK_SECONDS / avg_block_s)
        target_block = max(1, latest_block_number - est_blocks_back)

        candidates = urls or [None]
        for url in candidates:
            try:
                web3 = (
                    Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 15}))
                    if url
                    else self._get_web3(cfg.chain)
                )
                past_block = web3.eth.get_block(target_block)
                elapsed = latest_timestamp - int(past_block["timestamp"])
                if elapsed <= 0:
                    continue
                v = self._vault_contract(web3, cfg.vault_address)
                past_price = int(
                    v.functions.convertToAssets(one_share).call(block_identifier=target_block)
                )
                if past_price <= 0:
                    continue
                if url:
                    rpc_manager.report_success(cfg.chain, url, 0.0)
                return past_price, elapsed
            except Exception as e:
                if url:
                    rpc_manager.report_failure(cfg.chain, url, str(e))
                logger.debug(
                    f"vault APY historical read failed for {cfg.key} on "
                    f"{(url or 'default')[:48]}: {e}"
                )
                continue
        return None

    def _compute_apy(self, cfg: VaultConfig) -> Optional[float]:
        """Share-price growth over ~7 days, annualized. None if unavailable —
        never fabricated. Not cached here; caller (get_vault_stats) caches."""

        def _current(web3: Web3) -> tuple:
            v = self._vault_contract(web3, cfg.vault_address)
            one_share = 10**cfg.share_decimals
            now_price = int(v.functions.convertToAssets(one_share).call())
            latest_block = web3.eth.get_block("latest")
            return now_price, int(latest_block["number"]), int(latest_block["timestamp"])

        try:
            now_price, latest_number, latest_timestamp = self._failover(cfg.chain, _current)
        except Exception as e:
            logger.debug(f"vault APY current-price read failed for {cfg.key}: {e}")
            return None
        if now_price <= 0:
            return None

        one_share = 10**cfg.share_decimals
        historical = self._historical_share_price(cfg, one_share, latest_number, latest_timestamp)
        if historical is None:
            return None
        past_price, elapsed = historical
        return self.annualize_share_price_growth(now_price, past_price, elapsed)

    def get_vault_stats(self, vault_key: str) -> Dict[str, Any]:
        """totalAssets, share price, and (cached, ~1h TTL) APY. apy is None
        when the historical read is unavailable — never fabricated."""
        cfg = _require_vault(vault_key)

        def _op(web3: Web3) -> Dict[str, Any]:
            v = self._vault_contract(web3, cfg.vault_address)
            total_assets_raw = int(v.functions.totalAssets().call())
            one_share = 10**cfg.share_decimals
            share_price_raw = int(v.functions.convertToAssets(one_share).call())
            return {
                "vault_key": cfg.key,
                "total_assets_raw": total_assets_raw,
                "total_assets": total_assets_raw / 10**cfg.asset_decimals,
                "share_price": share_price_raw / 10**cfg.asset_decimals,
                "asset_symbol": cfg.asset_symbol,
            }

        try:
            stats = self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault get_vault_stats failed for {vault_key}: {e}")
            raise VaultError("Could not fetch vault stats. Try again shortly.")

        stats["apy"] = self._get_cached_apy(cfg)
        return stats

    def _get_cached_apy(self, cfg: VaultConfig) -> Optional[float]:
        now = time.time()
        with self._apy_lock:
            cached = self._apy_cache.get(cfg.key)
            if cached is not None and cached[1] > now:
                return cached[0]
        apy = self._compute_apy(cfg)
        ttl = APY_CACHE_TTL_SECONDS if apy is not None else APY_NONE_CACHE_TTL_SECONDS
        with self._apy_lock:
            self._apy_cache[cfg.key] = (apy, now + ttl)
        return apy

    # ── writes ────────────────────────────────────────────────────────────────

    def deposit(self, wallet, vault_key: str, assets_raw: int) -> list:
        """Exact-amount approve to the vault, then vault.deposit(assets, owner)."""
        cfg = _require_vault(vault_key)
        assets_raw = int(assets_raw)
        if assets_raw <= 0:
            raise VaultError("Deposit amount must be greater than zero.")
        owner = Web3.to_checksum_address(wallet.address)
        vault_addr = Web3.to_checksum_address(cfg.vault_address)
        chain_id = CHAIN_IDS.get(cfg.chain)
        if chain_id is None:
            raise VaultError(f"Unsupported chain '{cfg.chain}' for this vault.")

        def _op(web3: Web3) -> list:
            balance = self._erc20(web3, cfg.asset_address).functions.balanceOf(owner).call()
            if balance < assets_raw:
                raise VaultError(
                    f"Insufficient {cfg.asset_symbol}. You have "
                    f"{balance / 10**cfg.asset_decimals:.6f} but tried to deposit "
                    f"{assets_raw / 10**cfg.asset_decimals:.6f}."
                )
            token = self._erc20(web3, cfg.asset_address)
            approve_fn = token.functions.approve(vault_addr, assets_raw)
            deposit_fn = self._vault_contract(web3, vault_addr).functions.deposit(assets_raw, owner)

            tx_hashes: list = []
            tx_hashes.append(self._build_and_send(web3, wallet, approve_fn, chain_id))
            try:
                tx_hashes.append(self._build_and_send(web3, wallet, deposit_fn, chain_id))
            except _SentTx:
                # Receipt wait itself failed (e.g. fee-spike timeout) — on-chain
                # state is genuinely ambiguous, the deposit tx may still land.
                # Do NOT touch the allowance; _run_write's generic _SentTx
                # message ("submitted but confirmation timed out") already
                # covers this and a blind revoke here could race a pending fill.
                raise
            except VaultError:
                # Deposit reverted on-chain with a receipt in hand (status=0):
                # the approve is CONFIRMED and its allowance is live even
                # though the deposit itself moved no funds. Best-effort revoke
                # so we don't leave a standing spend approval behind; a revoke
                # failure must not mask the real deposit failure.
                try:
                    revoke_fn = token.functions.approve(vault_addr, 0)
                    self._build_and_send(web3, wallet, revoke_fn, chain_id)
                except Exception as revoke_err:
                    logger.warning(f"vault deposit: allowance revoke skipped: {revoke_err}")
                raise VaultError(
                    "Deposit failed on-chain. Your principal was not moved, but a "
                    "spending approval may briefly have been live — we attempted "
                    "to revoke it automatically. Try again shortly."
                )
            logger.info(f"vault deposit: {assets_raw} → {cfg.key} txs={tx_hashes}")
            return tx_hashes

        return self._run_write(cfg.chain, _op, "vault deposit")

    @staticmethod
    def _resolve_withdrawal_shares(
        balance: int, live_position_assets: int, requested_assets_raw: int, shares_for_assets: int
    ) -> tuple:
        """Pure decision, shared by preview_withdrawal (confirm screen) and
        withdraw_assets (execute) so the two screens can never disagree.

        All four inputs must come from ONE live read (same balanceOf +
        convertToAssets/convertToShares call, never a snapshot from an
        earlier screen). Returns (shares_to_redeem, is_full_redeem):
          - empty position → (0, False);
          - request within FULL_REDEEM_EPSILON of the live full position
            value → redeem the ENTIRE balance (no dust left behind, and the
            confirm screen must say so explicitly rather than showing a
            pro-rata estimate that isn't what will actually happen);
          - otherwise → shares_for_assets (convertToShares at live price),
            floored at 1 share (a sub-dust request against a real position
            must still move something — never "Nothing to withdraw") and
            capped at the live balance (never oversend).
        """
        if balance <= 0 or live_position_assets <= 0:
            return 0, False
        if requested_assets_raw >= live_position_assets * (1 - FULL_REDEEM_EPSILON):
            return balance, True
        shares = shares_for_assets if shares_for_assets > 0 else 1
        return min(shares, balance), False

    def preview_withdrawal(self, vault_key: str, address: str, assets_raw: int) -> Dict[str, Any]:
        """Read-only preview of what withdraw_assets(assets_raw) would ACTUALLY
        do right now, using the identical live-price rule (see
        _resolve_withdrawal_shares) — so confirm and execute never disagree."""
        cfg = _require_vault(vault_key)
        assets_raw = int(assets_raw)
        owner = Web3.to_checksum_address(address)
        vault_addr = Web3.to_checksum_address(cfg.vault_address)

        def _op(web3: Web3) -> Dict[str, Any]:
            v = self._vault_contract(web3, vault_addr)
            balance = int(v.functions.balanceOf(owner).call())
            live_position_assets = (
                int(v.functions.convertToAssets(balance).call()) if balance else 0
            )
            shares_for_assets = (
                int(v.functions.convertToShares(assets_raw).call())
                if assets_raw > 0 and live_position_assets > 0
                else 0
            )
            shares, full_redeem = self._resolve_withdrawal_shares(
                balance, live_position_assets, assets_raw, shares_for_assets
            )
            actual_assets_raw = int(v.functions.convertToAssets(shares).call()) if shares else 0
            return {
                "shares_raw": shares,
                "assets_raw": actual_assets_raw,
                "full_redeem": full_redeem,
            }

        try:
            return self._failover(cfg.chain, _op)
        except VaultError:
            raise
        except Exception as e:
            logger.warning(f"vault preview_withdrawal failed for {vault_key}: {e}")
            raise VaultError("Could not preview this withdrawal. Try again shortly.")

    def withdraw_assets(self, wallet, vault_key: str, assets_raw: int) -> Dict[str, Any]:
        """Withdraw a TARGET ASSET amount (not a share count). Reads
        balanceOf(owner) AND convertToAssets/convertToShares LIVE inside a
        single _op — never from a number captured on an earlier screen — and
        applies the same rule as preview_withdrawal (_resolve_withdrawal_shares)
        so what actually gets redeemed always matches what the confirm screen
        promised, modulo intra-tx price movement.

        Returns {"tx_hashes": [...], "shares_raw": int, "assets_raw": int,
        "full_redeem": bool}. "assets_raw" is the amount THIS call actually
        redeems (computed from the same live price as the shares, immediately
        before signing) — report this to the user, not their typed request.
        """
        cfg = _require_vault(vault_key)
        assets_raw = int(assets_raw)
        if assets_raw <= 0:
            raise VaultError("Withdrawal amount must be greater than zero.")
        owner = Web3.to_checksum_address(wallet.address)
        vault_addr = Web3.to_checksum_address(cfg.vault_address)
        chain_id = CHAIN_IDS.get(cfg.chain)
        if chain_id is None:
            raise VaultError(f"Unsupported chain '{cfg.chain}' for this vault.")

        def _op(web3: Web3) -> Dict[str, Any]:
            v = self._vault_contract(web3, vault_addr)
            balance = int(v.functions.balanceOf(owner).call())
            if balance <= 0:
                raise VaultError("Nothing to withdraw from this vault.")
            live_position_assets = int(v.functions.convertToAssets(balance).call())
            if live_position_assets <= 0:
                raise VaultError("Nothing to withdraw from this vault.")
            shares_for_assets = int(v.functions.convertToShares(assets_raw).call())
            shares, full_redeem = self._resolve_withdrawal_shares(
                balance, live_position_assets, assets_raw, shares_for_assets
            )
            if shares <= 0:
                raise VaultError("Nothing to withdraw from this vault.")
            actual_assets_raw = int(v.functions.convertToAssets(shares).call())

            fn = v.functions.redeem(shares, owner, owner)
            tx_hash = self._build_and_send(web3, wallet, fn, chain_id)
            logger.info(
                f"vault withdraw_assets: requested={assets_raw} shares={shares} "
                f"actual={actual_assets_raw} full_redeem={full_redeem} → {cfg.key} tx={tx_hash}"
            )
            return {
                "tx_hashes": [tx_hash],
                "shares_raw": shares,
                "assets_raw": actual_assets_raw,
                "full_redeem": full_redeem,
            }

        return self._run_write(cfg.chain, _op, "vault withdrawal")

    def withdraw(self, wallet, vault_key: str, shares_raw: Optional[int] = None) -> list:
        """redeem(shares, owner, owner). shares_raw=None → redeem the full,
        LIVE on-chain share balance (never a number cached from a prior screen)."""
        cfg = _require_vault(vault_key)
        owner = Web3.to_checksum_address(wallet.address)
        vault_addr = Web3.to_checksum_address(cfg.vault_address)
        chain_id = CHAIN_IDS.get(cfg.chain)
        if chain_id is None:
            raise VaultError(f"Unsupported chain '{cfg.chain}' for this vault.")

        def _op(web3: Web3) -> list:
            v = self._vault_contract(web3, vault_addr)
            balance = int(v.functions.balanceOf(owner).call())
            shares = balance if shares_raw is None else int(shares_raw)
            if shares <= 0:
                raise VaultError("Nothing to withdraw from this vault.")
            if shares > balance:
                raise VaultError("You don't have that many vault shares.")
            fn = v.functions.redeem(shares, owner, owner)
            tx_hash = self._build_and_send(web3, wallet, fn, chain_id)
            logger.info(f"vault withdraw: {shares} shares from {cfg.key} tx={tx_hash}")
            return [tx_hash]

        return self._run_write(cfg.chain, _op, "vault withdrawal")


vault_service = VaultService()
