"""Centralized RPC endpoint manager with health tracking and smart selection.

Replaces all scattered Web3 creation patterns with a single entry point that:
- Fetches RPCs from chainlist.org on startup (with fallback to settings.py defaults)
- Health-checks every endpoint (latency + success rate)
- Routes traffic via weighted random selection (fast + reliable = higher weight)
- Circuit-breaks failing endpoints with exponential backoff
- Periodically refreshes health + discovers new endpoints
"""

import asyncio
import logging
import random
import ssl
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional
from urllib.parse import urlparse

import aiohttp
from web3 import Web3

try:
    from web3.middleware import ExtraDataToPOAMiddleware as poa_middleware
except ImportError:
    from web3.middleware import geth_poa_middleware as poa_middleware

from bot.config.settings import settings

logger = logging.getLogger(__name__)


def _build_ssl_context() -> Optional[ssl.SSLContext]:
    """SSL context backed by certifi's CA bundle.

    aiohttp uses the system trust store, which in minimal containers can be
    missing/stale — that silently fails EVERY https RPC health check (while
    httpx/web3, which bundle certifi, keep working). Pin certifi explicitly.
    """
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception as e:  # pragma: no cover - certifi should be present
        logger.warning(f"RPC health check: certifi SSL context unavailable ({e}); using default")
        return None


# Chain ID map for chainlist.org lookup
CHAINLIST_IDS: Dict[str, int] = {
    "ethereum": 1,
    "bsc": 56,
    "polygon": 137,
    "arbitrum": 42161,
    "optimism": 10,
    "base": 8453,
    "base-sepolia": 84532,
    "avalanche": 43114,
    "fantom": 250,
    "linea": 59144,
    "mantle": 5000,
    "gnosis": 100,
    "scroll": 534352,
    # New Li.Fi-supported chains (2025-2026)
    "flare": 14,
    "unichain": 130,
    "sonic": 146,
    "opbnb": 204,
    "fraxtal": 252,
    "zksync": 324,
    "worldchain": 480,
    "flow": 747,
    "hyperevm": 999,
    "lisk": 1135,
    "sei": 1329,
    "soneium": 1868,
    "swellchain": 1923,
    "abstract": 2741,
    "kaia": 8217,
    "apechain": 33139,
    "mode": 34443,
    "hemi": 43111,
    "bob": 60808,
    "berachain": 80094,
    "taiko": 167000,
    # GOAT Network (Bitcoin L2) — same-chain swaps route via GOATSwap, not aggregators
    "goat": 2345,
    # Rootstock (Bitcoin sidechain) — routes via Li.Fi only; legacy gas, EIP-1191 checksums
    "rootstock": 30,
    # Citrea (Bitcoin ZK rollup) — same-chain swaps route via JuiceSwap, not aggregators
    "citrea": 4114,
}

# Chains needing PoA middleware
POA_CHAINS = {
    "bsc",
    "polygon",
    "arbitrum",
    "optimism",
    "base",
    "base-sepolia",
    "gnosis",
    "scroll",
    "linea",
    "mantle",
    "opbnb",
    "zksync",
    "mode",
    "bob",
}

# Registrable domains we trust to host RPC endpoints. Only endpoints whose host
# matches one of these (exact, or a subdomain) are accepted from the UNTRUSTED
# chainlist.org discovery feed — this prevents a poisoned/MitM'd chainlist
# response from injecting attacker-controlled RPC URLs that could read pending
# transactions, front-run, or forge responses. Configured endpoints from
# settings.py are trusted regardless of this list.
TRUSTED_RPC_DOMAINS = frozenset(
    {
        # Multi-chain public/paid providers
        "publicnode.com",
        "1rpc.io",
        "drpc.org",
        "blockpi.network",
        "alchemy.com",
        "infura.io",
        # NOTE: llamarpc.com is deliberately absent, for the same reason as
        # ankr.com below. Its unauthenticated public endpoints no longer serve:
        # `eth.llamarpc.com` answers HTTP 403 and `polygon.llamarpc.com` does not
        # resolve at all (measured). Because it was trusted, chainlist discovery
        # kept selecting it and a USDT0 quoteSend on ethereum failed with a bare
        # 403 — the provider failed closed correctly, but the route was silently
        # unavailable until the circuit breaker rotated away. Trusting the domain
        # only gates the UNTRUSTED chainlist feed; an authenticated LlamaNodes URL
        # in settings.py still bypasses this list.
        # NOTE: ankr.com is deliberately absent. Ankr retired its unauthenticated
        # public endpoints, so every chainlist-discovered `rpc.ankr.com/<chain>`
        # answers `-32000 Unauthorized` and does nothing but trip the circuit
        # breaker on repeat (observed continuously on polygon + gnosis in prod).
        # Trusting the domain here only gates the UNTRUSTED chainlist feed — an
        # authenticated Ankr URL configured in settings.py still bypasses this
        # list, so re-adding it is not needed to use a paid Ankr key.
        "blastapi.io",
        "nodereal.io",
        "meowrpc.com",
        "tenderly.co",
        # Chain-native / first-party RPC domains
        # plasma.to is Plasma's own RPC (rpc.plasma.to, verified serving chainId
        # 0x2611 = 9745). Without it Plasma had NO endpoints at all, which meant
        # the arbitrum<->plasma USDT0 corridor could never be quoted — and that
        # corridor is the reason USDT0 matters for Plasma in the first place,
        # since Plasma has no native USDT deployment.
        "plasma.to",
        "binance.org",
        "bnbchain.org",
        "arbitrum.io",
        "optimism.io",
        "base.org",
        "avax.network",
        "fantom.network",
        "ftm.tools",
        "linea.build",
        "mantle.xyz",
        "gnosischain.com",
        "scroll.io",
        "tempo.xyz",
        "soniclabs.com",
        "frax.com",
        "zksync.io",
        "onflow.org",
        "hyperliquid.xyz",
        "lisk.com",
        "sei-apis.com",
        "soneium.org",
        "alt.technology",
        "abs.xyz",
        "kaia.io",
        "apechain.com",
        "mode.network",
        "hemi.network",
        "gobob.xyz",
        "berachain.com",
        "taiko.xyz",
        "unichain.org",
        "flare.network",
    }
)


def _is_method_unsupported(error) -> bool:
    """True only when a JSON-RPC error means the method itself is missing.

    Deliberately narrow. An execution error ("invalid: failed transaction",
    "execution reverted") proves the opposite — the node ran the call. Treating
    those as unsupported evicts healthy endpoints, which is what happened to
    Flow's node the first time this check shipped.
    """
    if not isinstance(error, dict):
        return False
    # -32601 is JSON-RPC's standard "Method not found".
    if error.get("code") == -32601:
        return True
    message = str(error.get("message", "")).lower()
    return any(
        phrase in message
        for phrase in ("not supported", "method not found", "unsupported method", "not available")
    )


def _is_trusted_rpc_url(url: str) -> bool:
    """Return True only for https URLs whose host is a trusted RPC domain.

    Used to gate endpoints discovered from the untrusted chainlist.org feed.
    Rejects non-https schemes, missing/malformed hosts, and any host that is not
    exactly a trusted domain or a subdomain of one (dot-anchored to block
    registrable-suffix bypasses like ``evilpublicnode.com``).
    """
    try:
        parsed = urlparse(url)
    except (ValueError, TypeError):
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    return any(host == d or host.endswith("." + d) for d in TRUSTED_RPC_DOMAINS)


class RPCTier(Enum):
    PAID = 1  # Infura, Alchemy (user-configured keys)
    PUBLIC = 2  # Free public RPCs from settings.py
    DISCOVERED = 3  # Fetched from chainlist.org at runtime


@dataclass
class RPCEndpoint:
    """Health-tracked RPC endpoint."""

    url: str
    chain: str
    tier: RPCTier

    total_requests: int = 0
    successful_requests: int = 0
    total_latency_ms: float = 0.0
    consecutive_failures: int = 0
    circuit_open_until: float = 0.0
    last_error: Optional[str] = None

    @property
    def success_rate(self) -> float:
        if self.total_requests == 0:
            return 1.0  # Untested = benefit of the doubt
        return self.successful_requests / self.total_requests

    @property
    def avg_latency_ms(self) -> float:
        if self.successful_requests == 0:
            return 5000.0
        return self.total_latency_ms / self.successful_requests

    @property
    def is_circuit_open(self) -> bool:
        return time.monotonic() < self.circuit_open_until

    @property
    def health_score(self) -> float:
        """Score 0..~1.5 combining success rate, latency, and tier."""
        if self.is_circuit_open:
            return 0.0
        latency_factor = max(0.01, 1.0 - (self.avg_latency_ms / 5000.0))
        tier_bonus = {RPCTier.PAID: 1.5, RPCTier.PUBLIC: 1.0, RPCTier.DISCOVERED: 0.8}
        return self.success_rate * latency_factor * tier_bonus.get(self.tier, 1.0)

    def record_success(self, latency_ms: float):
        self.total_requests += 1
        self.successful_requests += 1
        self.total_latency_ms += latency_ms
        self.consecutive_failures = 0
        self.circuit_open_until = 0.0

    def record_failure(self, error: str, fatal: bool = False):
        """Record a failed probe/request.

        `fatal=True` opens the circuit on the FIRST occurrence, for failures
        that are a property of the endpoint rather than a transient blip —
        "the method eth_call is not supported" will be just as true on the next
        attempt. Waiting for three of those keeps a known-broken endpoint in
        rotation for minutes, which is how a chainlist-discovered node that
        rejects eth_call ended up serving contract reads on dev.
        """
        self.total_requests += 1
        self.last_error = error
        self.consecutive_failures += 1
        if fatal:
            self.circuit_open_until = time.monotonic() + 600
            logger.warning(f"RPC circuit OPEN (fatal) {self.url[:60]}... (600s, reason={error})")
            return
        if self.consecutive_failures >= 3:
            backoff = min(600, 30 * (2 ** (self.consecutive_failures - 3)))
            self.circuit_open_until = time.monotonic() + backoff
            logger.warning(
                f"RPC circuit OPEN {self.url[:60]}... ({backoff}s, "
                f"{self.consecutive_failures} failures, reason={error})"
            )

    def decay_stats(self):
        """Halve counters so recent performance dominates."""
        if self.total_requests > 20:
            self.total_requests = max(1, self.total_requests // 2)
            self.successful_requests = max(0, self.successful_requests // 2)
            self.total_latency_ms /= 2


class RPCManager:
    """Centralized RPC manager with health tracking and smart selection."""

    def __init__(self):
        self._endpoints: Dict[str, List[RPCEndpoint]] = {}
        self._web3_cache: Dict[str, tuple[Web3, str]] = {}  # chain -> (web3, url)
        self._bg_task: Optional[asyncio.Task] = None
        self._running = False
        self._chainlist_last_fetch: float = 0.0
        self._ssl_ctx: Optional[ssl.SSLContext] = _build_ssl_context()
        # Throttle the "all circuits open" warning to at most once per chain
        # per interval — under a full-outage storm this line was emitting
        # thousands of identical entries per second.
        self._circuit_open_warned: Dict[str, float] = {}

    async def start(self):
        """Initialize endpoints and start background health checker."""
        self._load_configured_endpoints()
        # Fetch chainlist in background — don't block startup. The fetch probes
        # whatever it adds before those endpoints can be selected.
        asyncio.create_task(self._fetch_chainlist_endpoints())
        self._running = True
        # Probe immediately rather than waiting for the first background cycle.
        # Until an endpoint has been probed it has no latency sample, so every
        # endpoint scores near-identically and selection is effectively a coin
        # flip — which on a cold deploy is exactly when a broken endpoint gets
        # picked. Kicked off as a task so startup is not blocked on the sweep.
        asyncio.create_task(self._health_check_all())
        self._bg_task = asyncio.create_task(self._background_loop())
        total = sum(len(v) for v in self._endpoints.values())
        logger.info(f"RPCManager started: {total} endpoints across {len(self._endpoints)} chains")

    async def stop(self):
        self._running = False
        if self._bg_task:
            self._bg_task.cancel()
            try:
                await self._bg_task
            except asyncio.CancelledError:
                pass

    # === LOADING ===

    def _load_configured_endpoints(self):
        """Load endpoints from settings.py — Infura, Alchemy, and public defaults."""
        all_chains = list(CHAINLIST_IDS.keys())
        # Also add chains absent from CHAINLIST_IDS, which would otherwise get no
        # endpoints at all — not even their configured default — and raise
        # "No RPC endpoints for <chain>" on first use. plasma was in exactly that
        # state, which made the arbitrum<->plasma USDT0 corridor unquotable.
        for extra in ("tempo", "solana", "tron", "plasma"):
            if extra not in all_chains:
                all_chains.append(extra)

        for chain_name in all_chains:
            endpoints: List[RPCEndpoint] = []

            # Tier 1: Infura
            if settings.infura_api_key:
                infura_net = settings.INFURA_NETWORKS.get(chain_name)
                if infura_net:
                    endpoints.append(
                        RPCEndpoint(
                            url=f"https://{infura_net}.infura.io/v3/{settings.infura_api_key}",
                            chain=chain_name,
                            tier=RPCTier.PAID,
                        )
                    )

            # Tier 1: Alchemy
            alchemy_url = settings.get_alchemy_rpc_url(chain_name)
            if alchemy_url:
                endpoints.append(
                    RPCEndpoint(
                        url=alchemy_url,
                        chain=chain_name,
                        tier=RPCTier.PAID,
                    )
                )

            # Tier 2: Public RPCs from settings
            attr_name = f"{chain_name.lower().replace('-', '_')}_rpc_url"
            rpc_str = getattr(settings, attr_name, "") or ""
            for url in rpc_str.split(","):
                url = url.strip()
                if url:
                    endpoints.append(
                        RPCEndpoint(
                            url=url,
                            chain=chain_name,
                            tier=RPCTier.PUBLIC,
                        )
                    )

            self._endpoints[chain_name] = endpoints

    async def _fetch_chainlist_endpoints(self):
        """Fetch additional RPCs from chainlist.org (graceful failure)."""
        # Declared outside the try so the probe below still runs if the fetch
        # raises partway through having already appended some endpoints.
        newly_added: List[RPCEndpoint] = []
        try:
            connector = aiohttp.TCPConnector(ssl=self._ssl_ctx) if self._ssl_ctx else None
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    "https://chainlist.org/rpcs.json",
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status != 200:
                        logger.warning(f"Chainlist fetch failed: HTTP {resp.status}")
                        return
                    data = await resp.json()

            # data is a list of chain objects with chainId and rpc arrays
            chain_id_to_name = {v: k for k, v in CHAINLIST_IDS.items()}
            added = 0

            for chain_data in data:
                chain_id = chain_data.get("chainId")
                chain_name = chain_id_to_name.get(chain_id)
                if not chain_name:
                    continue

                existing_urls = {ep.url for ep in self._endpoints.get(chain_name, [])}
                rpcs = chain_data.get("rpc", [])

                for rpc_entry in rpcs:
                    if isinstance(rpc_entry, dict):
                        rpc_url = rpc_entry.get("url", "")
                        tracking = rpc_entry.get("tracking", "")
                    elif isinstance(rpc_entry, str):
                        rpc_url = rpc_entry
                        tracking = ""
                    else:
                        continue

                    # Filter: skip wss, auth-required, tracking, duplicates
                    if not rpc_url or rpc_url.startswith("wss://"):
                        continue
                    if "${" in rpc_url or "{" in rpc_url:
                        continue
                    if tracking == "yes":
                        continue
                    if rpc_url in existing_urls:
                        continue
                    # SECURITY: chainlist.org is untrusted (no signature / cert
                    # pinning). Only accept https endpoints on trusted domains to
                    # prevent injection of attacker-controlled RPC URLs.
                    if not _is_trusted_rpc_url(rpc_url):
                        logger.debug(f"Chainlist: rejected untrusted RPC {rpc_url[:80]}")
                        continue

                    discovered = RPCEndpoint(
                        url=rpc_url,
                        chain=chain_name,
                        tier=RPCTier.DISCOVERED,
                    )
                    self._endpoints.setdefault(chain_name, []).append(discovered)
                    newly_added.append(discovered)
                    existing_urls.add(rpc_url)
                    added += 1

            self._chainlist_last_fetch = time.monotonic()
            total = sum(len(v) for v in self._endpoints.values())
            logger.info(f"Chainlist: added {added} endpoints ({total} total)")

        except Exception as e:
            logger.warning(f"Chainlist fetch failed (using defaults): {e}")

        # Probe what was just added, before it can be selected. These arrive
        # after startup's sweep, so without this they sit unprobed — and an
        # unprobed endpoint is indistinguishable from a good one at selection
        # time. This is the path that put an eth_call-rejecting node into
        # rotation on dev.
        if newly_added:
            sem = asyncio.Semaphore(20)
            await asyncio.gather(
                *(self._health_check_one(sem, ep) for ep in newly_added),
                return_exceptions=True,
            )

    # === SELECTION ===

    def _select_endpoint(self, chain_name: str) -> RPCEndpoint:
        """Weighted random selection by health score."""
        endpoints = self._endpoints.get(chain_name, [])
        if not endpoints:
            # Lazy-load if start() hasn't been called yet (import-time access)
            if not self._endpoints:
                self._load_configured_endpoints()
                endpoints = self._endpoints.get(chain_name, [])
            if not endpoints:
                raise ValueError(f"No RPC endpoints for {chain_name}")

        available = [ep for ep in endpoints if not ep.is_circuit_open]

        if not available:
            # Emergency: all circuits open — pick one closing soonest
            now = time.monotonic()
            if now - self._circuit_open_warned.get(chain_name, 0.0) >= 30.0:
                logger.warning(f"All RPCs circuit-open for {chain_name}, using earliest recovery")
                self._circuit_open_warned[chain_name] = now
            return min(endpoints, key=lambda ep: ep.circuit_open_until)

        scores = [ep.health_score for ep in available]
        total = sum(scores)
        if total == 0:
            return random.choice(available)

        r = random.random() * total
        cumulative = 0.0
        for ep, score in zip(available, scores):
            cumulative += score
            if r <= cumulative:
                return ep
        return available[-1]

    # === PUBLIC API ===

    def get_web3(self, chain_name: str) -> Web3:
        """Get a Web3 instance for the given chain (cached, auto-failover)."""
        chain_name = chain_name.lower()

        cached = self._web3_cache.get(chain_name)
        if cached:
            web3, cached_url = cached
            ep = self._find_endpoint(chain_name, cached_url)
            if ep and not ep.is_circuit_open:
                return web3
            self._web3_cache.pop(chain_name, None)

        ep = self._select_endpoint(chain_name)
        web3 = self._create_web3(chain_name, ep.url)
        self._web3_cache[chain_name] = (web3, ep.url)
        return web3

    def get_rpc_url(self, chain_name: str) -> str:
        """Get the best RPC URL (for raw aiohttp callers)."""
        return self._select_endpoint(chain_name.lower()).url

    def get_all_urls(self, chain_name: str) -> List[str]:
        """Get all URLs sorted by health score (best first)."""
        chain_name = chain_name.lower()
        endpoints = self._endpoints.get(chain_name, [])
        return [ep.url for ep in sorted(endpoints, key=lambda e: e.health_score, reverse=True)]

    def report_success(self, chain_name: str, url: str, latency_ms: float):
        """Report a successful RPC call."""
        ep = self._find_endpoint(chain_name.lower(), url)
        if ep:
            ep.record_success(latency_ms)

    def report_failure(self, chain_name: str, url: str, error: str):
        """Report a failed RPC call."""
        chain_name = chain_name.lower()
        ep = self._find_endpoint(chain_name, url)
        if ep:
            ep.record_failure(error)
            cached = self._web3_cache.get(chain_name)
            if cached and cached[1] == url:
                self._web3_cache.pop(chain_name, None)

    def invalidate(self, chain_name: str):
        """Force re-selection of endpoint for a chain."""
        self._web3_cache.pop(chain_name.lower(), None)

    def get_health_report(self) -> Dict:
        """Health report for admin status."""
        report = {}
        for chain_name, endpoints in sorted(self._endpoints.items()):
            eps = []
            for ep in sorted(endpoints, key=lambda e: e.health_score, reverse=True):
                eps.append(
                    {
                        "url": ep.url[:60] + ("..." if len(ep.url) > 60 else ""),
                        "tier": ep.tier.name,
                        "score": round(ep.health_score, 3),
                        "success_rate": round(ep.success_rate, 2),
                        "latency_ms": round(ep.avg_latency_ms, 0),
                        "reqs": ep.total_requests,
                        "circuit": "OPEN" if ep.is_circuit_open else "ok",
                    }
                )
            report[chain_name] = eps
        return report

    # === INTERNAL ===

    def _find_endpoint(self, chain_name: str, url: str) -> Optional[RPCEndpoint]:
        for ep in self._endpoints.get(chain_name, []):
            if ep.url == url:
                return ep
        return None

    def _create_web3(self, chain_name: str, rpc_url: str) -> Web3:
        web3 = Web3(
            Web3.HTTPProvider(
                rpc_url,
                request_kwargs={"timeout": 3, "headers": {"Content-Type": "application/json"}},
            )
        )
        if chain_name in POA_CHAINS:
            web3.middleware_onion.inject(poa_middleware, layer=0)
        return web3

    # === BACKGROUND HEALTH CHECKER ===

    async def _background_loop(self):
        await asyncio.sleep(30)  # Let app stabilize
        while self._running:
            try:
                await self._health_check_all()
                self._decay_all_stats()
                # Re-fetch chainlist every 6 hours
                if time.monotonic() - self._chainlist_last_fetch > 21600:
                    await self._fetch_chainlist_endpoints()
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.error(f"RPCManager background error: {e}")
            await asyncio.sleep(120)

    async def _health_check_all(self):
        """Ping all EVM endpoints with eth_blockNumber."""
        sem = asyncio.Semaphore(20)
        tasks = []

        for chain_name, endpoints in self._endpoints.items():
            # Skip non-EVM chains for health checks
            if chain_name in ("solana", "tron"):
                continue
            for ep in endpoints:
                tasks.append(self._health_check_one(sem, ep))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _health_check_one(self, sem: asyncio.Semaphore, ep: RPCEndpoint):
        async with sem:
            payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
            start = time.monotonic()
            try:
                connector = aiohttp.TCPConnector(ssl=self._ssl_ctx) if self._ssl_ctx else None
                async with aiohttp.ClientSession(connector=connector) as session:
                    async with session.post(
                        ep.url,
                        json=payload,
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        latency = (time.monotonic() - start) * 1000
                        if resp.status == 429:
                            ep.record_failure("rate_limited_429")
                            return
                        if resp.status != 200:
                            ep.record_failure(f"http_{resp.status}")
                            return
                        data = await resp.json()
                        if "error" in data:
                            ep.record_failure(f"rpc_error: {str(data['error'])[:80]}")
                            return

                    # eth_blockNumber alone is not enough to call an endpoint
                    # healthy. Some free providers serve it but reject
                    # eth_call ("The method eth_call is not supported"), which
                    # passes this check and then breaks every contract READ we
                    # do — quotes, allowances, balances. Observed on dev, where
                    # a USDT0 quoteSend failed against an endpoint this probe
                    # had marked healthy.
                    #
                    # to=0x0 with empty data is chain-agnostic and trivial for
                    # the node: any compliant EVM endpoint answers "0x".
                    if not await self._supports_eth_call(session, ep):
                        return

                    ep.record_success(latency)
            except asyncio.TimeoutError:
                ep.record_failure("timeout")
            except Exception as e:
                ep.record_failure(str(e)[:80])

    async def _supports_eth_call(self, session, ep: RPCEndpoint) -> bool:
        """Probe whether the endpoint implements eth_call at all.

        The distinction that matters is capability, not outcome. If the node
        *executes* the probe and complains about it, eth_call works and the
        endpoint is fine — some chains reject the synthetic to=0x0 payload
        (Flow answers "invalid: failed transaction"), and quarantining those
        would evict perfectly healthy nodes. Only a genuine method-not-found
        means contract reads are impossible here.
        """
        payload = {
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{"to": "0x" + "00" * 20, "data": "0x"}, "latest"],
            "id": 2,
        }
        try:
            async with session.post(
                ep.url, json=payload, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    ep.record_failure(f"eth_call http_{resp.status}")
                    return False
                data = await resp.json()
                error = data.get("error")
                if error and _is_method_unsupported(error):
                    # Not transient: a node either implements the method or it
                    # does not. Quarantine now rather than after three sweeps
                    # (six minutes) of serving broken contract reads.
                    ep.record_failure(f"eth_call unsupported: {str(error)[:60]}", fatal=True)
                    return False
                # Any other error means the call was executed and rejected —
                # the capability is present, which is all this probe asks.
                return True
        except asyncio.TimeoutError:
            ep.record_failure("eth_call timeout")
            return False
        except Exception as e:
            ep.record_failure(f"eth_call {str(e)[:60]}")
            return False

    def _decay_all_stats(self):
        for endpoints in self._endpoints.values():
            for ep in endpoints:
                ep.decay_stats()


# Singleton
rpc_manager = RPCManager()
