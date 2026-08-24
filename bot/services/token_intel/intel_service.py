"""Token Intel service — deployer profile, holder concentration, cluster/bundle/snipe
detection, built entirely from free/keyless data sources:

  - Blockscout public REST v2 (EVM chains) — bot/services/token_intel/evm_source.py
  - Solana JSON-RPC (via rpc_manager)      — bot/services/token_intel/solana_source.py
  - DexScreener free public API            — pair/launch metadata, chain-agnostic

Every per-field enrichment degrades gracefully: a failed call sets the field
to None/empty and appends a short machine-readable note; it never raises out
of ``analyze()``.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex/tokens/{address}"

CACHE_TTL_SECONDS = 120

# Flag thresholds — tuned as simple, explainable heuristics rather than a
# scored model, so /intel output stays auditable.
HIGH_TOP10_THRESHOLD_PCT = 50.0
BUNDLE_BUYER_THRESHOLD = 3
SNIPE_BUYER_THRESHOLD = 3
SERIAL_DEPLOYER_DEAD_THRESHOLD = 2


@dataclass
class HolderInfo:
    address: str
    balance: float
    pct: Optional[float] = None
    # Whether this holder is a contract. A liquidity pool, a vesting escrow or a
    # Safe is not "a wallet that could dump on you", which is the only question
    # holder concentration is asked to answer.
    is_contract: bool = False
    label: Optional[str] = None


@dataclass
class TokenIntelReport:
    token_address: str
    chain: str

    name: Optional[str] = None
    symbol: Optional[str] = None
    total_supply: Optional[float] = None

    deployer: Optional[str] = None
    deployer_prior_deploys: Optional[int] = None
    deployer_dead_deploys: Optional[int] = None

    mint_authority: Optional[str] = None  # Solana only

    top_holders: List[HolderInfo] = field(default_factory=list)
    # Concentration across the top wallets (contracts excluded). None means we
    # could not measure it — callers must treat that as unknown, not as safe.
    top10_pct: Optional[float] = None
    # How much of supply sits in contracts (pools, vesting, bridges). Informative,
    # deliberately not folded into top10_pct.
    contract_held_pct: Optional[float] = None

    cluster_groups: List[List[str]] = field(default_factory=list)
    bundle_buyer_count: Optional[int] = None
    snipe_buyer_count: Optional[int] = None

    pair_created_at: Optional[int] = None  # ms epoch, from DexScreener
    pair_address: Optional[str] = None  # deepest pair, from DexScreener
    # Tri-state on purpose: True = burned/locked, False = pullable,
    # None = undetermined. Coercing None to False flags every V3 pool as a rug.
    lp_locked: Optional[bool] = None
    lp_lock_reason: Optional[str] = None

    flags: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    generated_at: float = field(default_factory=time.time)

    def set_top_holders(self, holders: List[dict]) -> None:
        """Set top holders from plain dicts and recompute top10 concentration."""
        self.top_holders = [
            HolderInfo(
                address=h.get("address"),
                balance=h.get("balance", 0.0),
                pct=h.get("pct"),
                is_contract=bool(h.get("is_contract")),
                label=h.get("label"),
            )
            for h in holders
            if h.get("address")
        ]
        pcts = [h.pct for h in self.top_holders if h.pct is not None]
        self.top10_pct = round(sum(pcts), 2) if pcts else None


class _ReportCache:
    """Simple in-memory TTL cache, following bot/utils/cache.py's AsyncCache pattern."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS):
        self._ttl = ttl_seconds
        self._store: Dict[str, Tuple[float, TokenIntelReport]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[TokenIntelReport]:
        entry = self._store.get(key)
        if not entry:
            return None
        ts, report = entry
        if time.time() - ts > self._ttl:
            return None
        return report

    async def set(self, key: str, report: TokenIntelReport) -> None:
        async with self._lock:
            self._store[key] = (time.time(), report)

    async def invalidate(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)


class TokenIntelService:
    """Assembles a TokenIntelReport for a token address on a given chain."""

    def __init__(self):
        self._cache = _ReportCache()

    @staticmethod
    def _cache_key(token_address: str, chain: str) -> str:
        return f"{chain.lower()}:{token_address.lower()}"

    async def analyze(
        self,
        token_address: str,
        chain: str,
        force_refresh: bool = False,
        quick: bool = False,
    ) -> TokenIntelReport:
        """Build a token intel report.

        quick=True asks the source modules for only the fields a risk gate
        needs, skipping the transfer-walking enrichments that dominate latency.
        Quick and full reports share a cache key deliberately: a full report is
        a superset, so a cached one satisfies a quick caller.
        """
        chain = (chain or "ethereum").lower()
        cache_key = self._cache_key(token_address, chain)

        if not force_refresh:
            cached = await self._cache.get(cache_key)
            if cached:
                return cached

        report = TokenIntelReport(token_address=token_address, chain=chain)

        await self._enrich_dexscreener(report)

        try:
            if chain == "solana":
                from bot.services.token_intel import solana_source

                await solana_source.enrich_report(report)
            else:
                from bot.services.token_intel import evm_source

                await evm_source.enrich_report(report, chain, quick=quick)
        except Exception as e:
            # Belt-and-suspenders: source modules are already defensive, but a
            # single report must never fail the whole /intel command.
            logger.error(
                "token_intel source enrichment failed for %s/%s: %s", chain, token_address, e
            )
            report.notes.append("source_enrichment_error")

        # LP lock is the gate that decides whether liquidity can be pulled, so it
        # runs for every report — including quick ones, which is what the risk
        # gate actually calls. Two cheap explorer reads.
        if chain != "solana" and report.pair_address:
            try:
                from bot.services.token_intel.lp_lock import check_lp_lock

                lock = await check_lp_lock(chain, report.pair_address)
                report.lp_locked = lock.locked
                report.lp_lock_reason = lock.reason
            except Exception as e:
                logger.warning("lp_lock check failed for %s/%s: %s", chain, token_address, e)
                report.lp_lock_reason = "lp lock check errored"

        self._derive_flags(report)

        await self._cache.set(cache_key, report)
        return report

    async def invalidate(self, token_address: str, chain: str) -> None:
        await self._cache.invalidate(self._cache_key(token_address, chain))

    async def _enrich_dexscreener(self, report: TokenIntelReport) -> None:
        try:
            await api_limiter.wait_and_acquire("dexscreener")
            session = await get_session()
            url = DEXSCREENER_URL.format(address=report.token_address)
            async with session.get(url) as resp:
                if resp.status != 200:
                    report.notes.append(f"dexscreener_http_{resp.status}")
                    return
                data = await resp.json()
        except Exception as e:
            logger.warning("token_intel dexscreener enrich failed: %s", e)
            report.notes.append("dexscreener_error")
            return

        pairs = (data or {}).get("pairs") or []
        if not pairs:
            report.notes.append("dexscreener_no_pairs")
            return

        pair = pairs[0]
        base = pair.get("baseToken") or {}
        report.name = report.name or base.get("name")
        report.symbol = report.symbol or base.get("symbol")
        report.pair_created_at = pair.get("pairCreatedAt")
        report.pair_address = pair.get("pairAddress")

    def _derive_flags(self, report: TokenIntelReport) -> None:
        flags: List[str] = []

        if report.top10_pct is not None and report.top10_pct >= HIGH_TOP10_THRESHOLD_PCT:
            flags.append("HIGH_TOP10")

        if (
            report.bundle_buyer_count is not None
            and report.bundle_buyer_count >= BUNDLE_BUYER_THRESHOLD
        ):
            flags.append("BUNDLED")

        if (
            report.snipe_buyer_count is not None
            and report.snipe_buyer_count >= SNIPE_BUYER_THRESHOLD
        ):
            flags.append("SNIPED")

        if (
            report.deployer_dead_deploys is not None
            and report.deployer_dead_deploys >= SERIAL_DEPLOYER_DEAD_THRESHOLD
        ):
            flags.append("SERIAL_DEPLOYER")

        if any(len(group) >= 2 for group in report.cluster_groups):
            flags.append("CLUSTERED")

        report.flags = flags


# Global instance, matching the rest of the codebase's service-singleton pattern.
token_intel_service = TokenIntelService()
