"""Build the node map: native wrappers and validated ERC4626 vaults.

Discovery is automatic and produces a *report*; merging is gated on the
per-chain allowlist in `chains.py`.  Every allowlisted vault is still checked
at runtime, because an allowlist entry can go stale -- a vault can pause
deposits or grow a queue long after it was added.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.codec import encode_call
from ..core.nodes import Conversion, ConversionKind, NodeMap
from ..core.pools import PoolSpec
from ..core.quoter import QuoterClient
from ..core.transport import Call, Status
from ..core.types import ArcKind, PoolArc
from .chains import NATIVE_SENTINEL, Chain

# A vault must accept at least this multiple of the trade before it can be
# treated as a zero-resistance short circuit rather than a capped arc.
MIN_DEPOSIT_HEADROOM = 100
LINEARITY_TOL = 1e-9


@dataclass(slots=True)
class VaultReport:
    token: str
    symbol: str
    asset: str = ""
    decimals: int = 18
    rate_num: int = 0
    rate_den: int = 1
    max_deposit: int = 0
    linearity_error: float = 0.0
    merged: bool = False
    reason: str = ""


@dataclass(slots=True)
class WrapperReport:
    native_merged: list[tuple[str, str]] = field(default_factory=list)
    vaults: list[VaultReport] = field(default_factory=list)
    #: (folded, canonical) pairs found to share a balance; see `discover_aliases`.
    aliases: list[tuple[str, str]] = field(default_factory=list)

    @property
    def merged_vaults(self) -> list[VaultReport]:
        return [v for v in self.vaults if v.merged]

    @property
    def rejected_vaults(self) -> list[VaultReport]:
        return [v for v in self.vaults if not v.merged and v.reason]


def merge_candidates(chain: Chain, facts=None) -> list[str]:
    """Which vaults are worth *trying* to merge, from measurement where there is
    any.

    R5 gates merging on an allowlist because linearity says nothing about whether
    you can get back out: pufETH reports `asset = WETH`, converts with no error
    and caps at `2**256-1`, yet redeems through a queue.  Merging it would declare
    it equal to WETH at NAV and mint the market's discount from nothing.
    `maxRedeem` cannot answer either -- it is per-owner and returns 0 for an
    address holding no shares.

    Executing both directions can, and `data/facts` does, so the list is a
    measurement rather than a judgement.  The hand-written list stays as an
    addition, not a replacement: a vault the harness could not test is absent from
    the facts, and absent must not mean refused.

    And `oneway_vaults` always wins.  A measured redemption is one redemption, of
    one size, at one block, by one holder -- not proof that the exit is open.
    This probe found pufETH's `redeem` answering and would have merged it, which
    is precisely the case R5 exists to forbid.  Measurement may say "this looks
    fine"; only a human may say "and I know why it is fine".  So the deny list is
    a veto over what measurement cannot judge, not a fallback for what it misses.
    """
    hand = [v.lower() for v in chain.erc4626_allowlist]
    wrappers = getattr(facts, "wrappers", None) or {}
    measured = [
        address for address, entry in wrappers.items()
        if entry.get("mint") is True and entry.get("redeem") is True
    ]
    denied = {v.lower() for v in getattr(chain, "oneway_vaults", ())}
    denied |= {token.lower() for token, _, _, _, _ in getattr(chain, "stake_arcs", ())}
    return sorted((set(hand) | set(measured)) - denied)


def build_node_map(
    pools: list[PoolSpec],
    chain: Chain,
    client: QuoterClient,
    *,
    value_wei: int = 0,
    facts=None,
    token_client: QuoterClient | None = None,
) -> tuple[NodeMap, WrapperReport]:
    """Every pool coin as a node, with wrappers and vaults merged in.

    `value_wei` is the size of the trade being routed, used only to decide
    whether a vault's deposit cap is large enough to call it unbounded.
    `facts` supplies measured mint/redeem verdicts; see `merge_candidates`.
    """
    nodes = NodeMap()
    report = WrapperReport()

    for pool in pools:
        for coin in pool.coins:
            nodes.add_token(coin.address, coin.symbol, coin.decimals)

    # Aliases first: two addresses over one balance are one node, and merging
    # them before anything else means every later step -- wrappers, vaults,
    # arcs -- sees the consolidated market rather than two halves of it.
    known = {(a.lower(), b.lower()) for a, b in getattr(chain, "duals", ())}
    for left, right in list(known) + [
            pair for pair in discover_aliases(pools, nodes, token_client or client)
            if (pair[0].lower(), pair[1].lower()) not in known
            and (pair[1].lower(), pair[0].lower()) not in known]:
        # A declared pair names tokens that may not be here at all: the TVL
        # floor cuts pools, not the table.  With neither side in the graph
        # there is nothing to alias onto, and merging anyway raised a KeyError
        # out of `build_node_map` -- `--min-tvl 1000000` on gnosis took every
        # EURe pool with it and the chain failed to load rather than reporting
        # no pools.  Discovered pairs cannot hit this: they come from the coins.
        here = [t for t in (left, right) if nodes.has(t)]
        if not here:
            continue
        # The deeper side is canonical, so the token most pools already hold
        # stays the one legs are denominated in -- but only a side that is
        # here can be, because the alias has to land on a node.
        weight = {left: 0.0, right: 0.0}
        for pool in pools:
            for coin in pool.coins:
                if coin.address.lower() in weight:
                    weight[coin.address.lower()] += pool.tvl_usd
        canonical = max(here, key=lambda t: weight[t])
        other = right if canonical == left else left
        nodes.merge(Conversion(kind=ConversionKind.ALIAS, token=other,
                               canonical=canonical, target=""))
        report.aliases.append((other, canonical))

    # LP tokens are deliberately *not* registered here.  A pool's LP is a node
    # only when some other pool trades it -- 3Crv, crvFRAX, sbtcCrv, gnosis's
    # x3CRV -- and `build_arcs` then finds it already present.  Registering all of
    # them instead makes an arc pair per coin for every pool on the chain, mostly
    # to tokens nothing else trades: 759 arcs became 2,020 on mainnet, and
    # crvUSD -> sDOLA at $2M lost 20% in 2.2x the time.  A dead-end node cannot
    # improve a route, but it can and did drag the price fit and the solver.

    # --- native wrapper: 1:1, no probing needed --------------------------
    #
    # Either side being in the graph is enough.  Gating on the sentinel alone
    # meant the native token existed only where some pool happened to hold it:
    # true on ethereum, arbitrum and optimism, and false on base, gnosis,
    # polygon, monad and etherlink, where the wrapper is traded and the gas
    # token was simply not a node -- `XDAI -> USDC.e` answered "not routable"
    # for a pair whose second leg was already there.  Merging costs no node and
    # no arc; it adds an alias onto the wrapper's own node.
    wrapped = chain.wrapped.lower()
    sentinel = NATIVE_SENTINEL.lower()
    if chain.wraps_native and (nodes.has(sentinel) or nodes.has(wrapped)):
        if not nodes.has(wrapped):
            nodes.add_token(wrapped, f"W{chain.native_symbol}", 18)
        # The wrapped ERC20 is canonical because most pools hold it; only the
        # handful of sentinel pools then need a conversion leg.
        nodes.merge(
            Conversion(
                kind=ConversionKind.NATIVE_WRAP,
                token=sentinel,
                canonical=wrapped,
                rate_num=1,
                rate_den=1,
                target=chain.wrapped,
            )
        )
        nodes.symbol_of.setdefault(sentinel, chain.native_symbol)
        report.native_merged.append((chain.native_symbol, f"W{chain.native_symbol}"))

    # --- wstETH: rate-bearing, but otherwise a native wrapper ------------
    pairs = [
        (t.lower(), c.lower())
        for t, c in chain.wsteth_pairs
        if nodes.has(t.lower()) and nodes.has(c.lower())
    ]
    if pairs:
        _merge_wsteth(nodes, report, pairs, client)

    # --- ERC4626: allowlist, then verify ---------------------------------
    candidates = [v for v in merge_candidates(chain, facts) if nodes.has(v)]
    if candidates:
        _merge_vaults(nodes, report, candidates, client, value_wei)

    return nodes, report


def _merge_wsteth(
    nodes: NodeMap,
    report: WrapperReport,
    pairs: list[tuple[str, str]],
    client: QuoterClient,
) -> None:
    """Merge wstETH into stETH -- lossless, unbounded, and exactly linear.

    Measured: `getStETHByWstETH` is linear to 1.3e-19 across eight decades, and a
    1 stETH round trip loses 1 wei to integer rounding.  No deposit cap, no
    withdrawal queue, no cooldown -- the three things that disqualify pufETH and
    sUSDe under R5 -- so it is a short circuit in value coordinates.

    Not merging it is expensive rather than merely incomplete: wstETH cannot then
    reach the deep ETH/stETH pool, and 50 wstETH -> WETH quoted 10.7% below NAV.
    """
    calls: list[Call] = []
    for token, _canonical in pairs:
        unit = 10 ** nodes.decimals(token)
        calls.extend(
            [
                Call(token, encode_call("getStETHByWstETH(uint256)", unit)),
                Call(token, encode_call("getStETHByWstETH(uint256)", unit * 1_000_000)),
            ]
        )

    answers = client.raw(calls)
    for k, (token, canonical) in enumerate(pairs):
        one_ans, million_ans = answers[2 * k], answers[2 * k + 1]
        entry = VaultReport(token=token, symbol=nodes.symbol(token), asset=canonical)
        report.vaults.append(entry)

        if one_ans.status is not Status.VALUE or one_ans.uint() == 0:
            entry.reason = "getStETHByWstETH returned nothing"
            continue
        unit = 10 ** nodes.decimals(token)
        one = one_ans.uint()
        entry.rate_num, entry.rate_den = one, unit
        entry.decimals = nodes.decimals(token)

        million = million_ans.uint() if million_ans.status is Status.VALUE else 0
        if million == 0:
            entry.reason = "rate is not linear (no answer at scale)"
            continue
        entry.linearity_error = abs(million - one * 1_000_000) / max(million, 1)
        if entry.linearity_error > LINEARITY_TOL:
            entry.reason = f"non-linear ({entry.linearity_error:.2e})"
            continue

        nodes.merge(
            Conversion(
                kind=ConversionKind.WSTETH,
                token=token,
                canonical=canonical,
                rate_num=one,
                rate_den=unit,
                target=token,
            )
        )
        entry.merged = True


def _merge_vaults(
    nodes: NodeMap,
    report: WrapperReport,
    vaults: list[str],
    client: QuoterClient,
    value_wei: int,
) -> None:
    calls: list[Call] = []
    for vault in vaults:
        decimals = nodes.decimals(vault)
        unit = 10**decimals
        calls.extend(
            [
                Call(vault, encode_call("asset()")),
                Call(vault, encode_call("decimals()")),
                Call(vault, encode_call("maxDeposit(address)", "0x" + "11" * 20)),
                Call(vault, encode_call("convertToAssets(uint256)", unit)),
                Call(vault, encode_call("convertToAssets(uint256)", unit * 1_000_000)),
            ]
        )
    answers = client.raw(calls)

    for k, vault in enumerate(vaults):
        chunk = answers[5 * k : 5 * k + 5]
        entry = VaultReport(token=vault, symbol=nodes.symbol(vault))
        report.vaults.append(entry)

        if chunk[0].status is not Status.VALUE:
            entry.reason = "no asset()"
            continue
        asset = "0x" + chunk[0].data[-20:].hex()
        entry.asset = asset
        if chunk[1].status is Status.VALUE:
            entry.decimals = int(chunk[1].uint())
        unit = 10**entry.decimals

        if not nodes.has(asset):
            entry.reason = "asset is not a routable token"
            continue
        if chunk[3].status is not Status.VALUE or chunk[3].uint() == 0:
            entry.reason = "convertToAssets returned nothing"
            continue

        one, million = chunk[3].uint(), chunk[4].uint() if chunk[4].status is Status.VALUE else 0
        entry.rate_num, entry.rate_den = one, unit
        entry.max_deposit = chunk[2].uint() if chunk[2].status is Status.VALUE else 0

        # Linear across six decades?  Necessary, and nowhere near sufficient.
        if million == 0:
            entry.reason = "convertToAssets is not linear (no answer at scale)"
            continue
        entry.linearity_error = abs(million - one * 1_000_000) / max(million, 1)
        if entry.linearity_error > LINEARITY_TOL:
            entry.reason = f"non-linear ({entry.linearity_error:.2e})"
            continue

        # Deposit headroom.  NB `maxRedeem(addr)` is per-owner and returns 0
        # for an address holding no shares, so it cannot be used here; the
        # redeem side is covered by the executed round trip in CI.
        needed = MIN_DEPOSIT_HEADROOM * max(value_wei, unit)
        if entry.max_deposit < needed:
            entry.reason = f"deposit cap {entry.max_deposit} below {needed}"
            continue

        nodes.merge(
            Conversion(
                kind=ConversionKind.ERC4626,
                token=vault,
                canonical=asset,
                rate_num=entry.rate_num,
                rate_den=entry.rate_den,
                target=vault,
            )
        )
        entry.merged = True


def discover_vaults(
    nodes: NodeMap, client: QuoterClient, tokens: list[str] | None = None
) -> list[VaultReport]:
    """Report every ERC4626-looking token, merged or not.

    Diagnostic only: nothing here changes the node map.  It exists so the
    allowlist can be reviewed against what is actually out there.
    """
    targets = [t.lower() for t in (tokens or list(nodes.node_of))]
    calls = [Call(t, encode_call("asset()")) for t in targets]
    answers = client.raw(calls)

    found = []
    for token, answer in zip(targets, answers, strict=True):
        if answer.status is not Status.VALUE:
            continue
        asset = "0x" + answer.data[-20:].hex()
        if int(asset, 16) == 0:
            continue
        found.append(
            VaultReport(
                token=token,
                symbol=nodes.symbol(token),
                asset=asset,
                reason="discovered, not allowlisted",
            )
        )
    return found


#: Whose deposit room to ask about.  `maxDeposit` is per-owner, so it needs
#: *someone*; nobody in particular is the honest choice, and a vault that gates
#: by allowlist then reads as closed, which for routing purposes it is.
DEPOSITOR = "0x" + "11" * 20


#: Holders to compare a suspected alias pair against, beyond `totalSupply`.
#: Two contracts can agree on a supply by coincidence; agreeing on several
#: unrelated accounts' balances, to the wei, is not a coincidence.
ALIAS_PROBES = 3


def discover_aliases(pools: list[PoolSpec], nodes: NodeMap,
                     client: QuoterClient) -> list[tuple[str, str]]:
    """Token pairs that are two addresses over one balance.

    Gnosis EURe is the case this exists for.  Its two contracts report the same
    `totalSupply` to the wei and the same `balanceOf` for every holder tried --
    holding one *is* holding the other -- so treating them as separate nodes
    splits a single market into two thin ones near par, and is why `--to EURe`
    had to pick a side and USDC.e could not reach it.

    Candidates are pairs sharing a symbol, because that is what an alias looks
    like from outside and it keeps this to a handful of calls.  Evidence is equal
    decimals, equal supply, and equal balances at several independent holders --
    the pools themselves, which are exactly the accounts the router is about to
    reason about.

    **These are token reads, so they must not come from the local EVM.**  It holds
    pool storage; an ERC20 it never loaded answers `totalSupply` with zero, the "a
    supply of nothing agrees with everything" guard below correctly refuses to
    merge on that, and the alias is silently not found.
    """
    from ..core.codec import encode_call
    from ..core.transport import Call

    by_symbol: dict[str, list[tuple[str, int]]] = {}
    holders: list[str] = []
    for pool in pools:
        holders.append(pool.address)
        for coin in pool.coins:
            key = coin.symbol.upper().replace("\u20ae", "T")
            entry = (coin.address.lower(), coin.decimals)
            if entry not in by_symbol.setdefault(key, []):
                by_symbol[key].append(entry)

    pairs: list[tuple[str, str]] = []
    for entries in by_symbol.values():
        if len(entries) < 2:
            continue
        for k, (left, left_dec) in enumerate(entries):
            for right, right_dec in entries[k + 1:]:
                if left_dec == right_dec:
                    pairs.append((left, right))
    if not pairs:
        return []

    probes = holders[:ALIAS_PROBES]
    calls: list[Call] = []
    for left, right in pairs:
        for token in (left, right):
            calls.append(Call(token, encode_call("totalSupply()")))
            calls += [Call(token, encode_call("balanceOf(address)", h)) for h in probes]
    answers = client.raw(calls)

    stride = 1 + len(probes)
    found: list[tuple[str, str]] = []
    for k, (left, right) in enumerate(pairs):
        base = 2 * stride * k
        one = answers[base : base + stride]
        two = answers[base + stride : base + 2 * stride]
        if any(a.status is not Status.VALUE for a in one + two):
            continue
        if one[0].uint() == 0:
            continue  # a supply of nothing agrees with everything
        if all(a.uint() == b.uint() for a, b in zip(one, two, strict=True)):
            found.append((left, right))
    return found


def mintable_vaults(nodes: NodeMap, client: QuoterClient,
                    chain_id: int | None = None) -> list[str]:
    """Every token in the graph that mints itself from another token in it.

    Minting is not the same claim as merging, and only the second one needs a
    human.  A merge asserts the exit is open and unbounded, which is why R5 keeps
    it on an allowlist -- pufETH is perfectly linear and redeems through a queue.
    A *deposit* arc asserts only what the vault will do on request: take the
    asset, hand back shares, at a rate the quoter reads and the on-chain
    verification adjudicates.  So this one can be discovered.

    Which matters, because the hand-written list is short and the universes are
    not: on mainnet, eleven ignored vaults are mintable from an asset already in
    the graph, and fraxtal's sdUSD was the whole of that chain's vault coverage.
    A token nothing mints can only be reached by buying it in a pool, which cost
    crvUSD -> sDOLA at $5M 16%.

    A vault already merged with its asset falls out downstream: the two share a
    node, and the caller skips an arc whose ends are the same node.  `asset()`
    cannot change, so the answer is cached per chain.
    """
    from .cache import TokenFactsCache

    facts = TokenFactsCache()
    known = facts.load(chain_id) if chain_id is not None else {}
    tokens = [t.lower() for t in nodes.node_of]
    ask = [t for t in tokens if "asset" not in known.get(t, {})]

    learned: dict[str, dict] = {}
    if ask:
        answers = client.raw([Call(t, encode_call("asset()")) for t in ask])
        for token, answer in zip(ask, answers, strict=True):
            asset = ""
            if answer.status is Status.VALUE and len(answer.data) >= 32:
                word = answer.data[-20:].hex()
                if int(word, 16):
                    asset = "0x" + word
            learned[token] = {"asset": asset}
        if chain_id is not None:
            facts.save(chain_id, learned)

    out = []
    for token in tokens:
        asset = (learned.get(token) or known.get(token) or {}).get("asset") or ""
        if asset and nodes.has(asset):
            out.append(token)
    return out


def build_transmuter_arcs(
    nodes: NodeMap, chain: Chain, client: QuoterClient
) -> list[PoolArc]:
    """1:1 adapters, as capped linear arcs in both directions.

    A transmuter holds a reserve of one token and mints the other, so it is a
    wrapper with a real floor under it -- gnosis converts USDC.e to USDC at
    exactly 1:1 for as long as its 10.04M USDC lasts.  Routing that hop through
    pools instead cost 55 bp on a $100,000 trade.

    Not a merge, for the same reason a vault is not: a merge asserts the exit is
    open and unbounded, and this one is bounded by a balance anyone can read.
    So: `a = 1`, `B = 0`, and a cap from the adapter's own holdings.

    **Quoted as a wrap, which is exactly right and not yet executable.**  The
    deployed quoter answers `WRAP_NATIVE` and `UNWRAP_NATIVE` with `dx` unchanged
    and no call, which is what a 1:1 conversion *is*, so the verified number is
    correct today.  An executor would need a kind of its own -- the adapter takes
    `deposit(uint256)`, not WETH's payable `deposit()` -- so the adapter address
    rides on the leg's target and note until there is one.
    """
    from ..core.codec import encode_call
    from ..core.transport import Call

    entries = [
        (a.lower(), b.lower(), adapter.lower())
        for a, b, adapter in getattr(chain, "transmuters", ())
        if nodes.has(a.lower()) and nodes.has(b.lower())
    ]
    if not entries:
        return []

    # What the adapter can actually pay out, per side: either from a reserve
    # it holds, or -- where it is a minter of the output -- from its mint
    # allowance.  Both are read; which one applies is decided per direction.
    calls = []
    for token_a, token_b, adapter in entries:
        for token in (token_a, token_b):
            calls += [Call(token, encode_call("balanceOf(address)", adapter)),
                      Call(token, encode_call("isMinter(address)", adapter)),
                      Call(token, encode_call("minterAllowance(address)", adapter))]
    answers = client.raw(calls)

    def _uint(answer) -> int:
        return answer.uint() if answer.status is Status.VALUE else 0

    arcs: list[PoolArc] = []
    for k, (token_a, token_b, adapter) in enumerate(entries):
        side = {}
        for n, token in enumerate((token_a, token_b)):
            base = 6 * k + 3 * n
            side[token] = (
                _uint(answers[base]),                       # held
                bool(_uint(answers[base + 1])),             # is a minter
                _uint(answers[base + 2]),                   # mint allowance
            )
        if nodes.node(token_a) == nodes.node(token_b):
            continue  # already one node by some other route
        for token_in, token_out, kind in (
            (token_a, token_b, ArcKind.WRAP_NATIVE),
            (token_b, token_a, ArcKind.UNWRAP_NATIVE),
        ):
            held_out, mints_out, allowance = side[token_out]
            held_in = side[token_in][0]
            # Which of the three the cap comes from is a real difference, so it
            # is asked rather than inferred from a zero balance.  Gnosis's
            # USDCTransmuter *mints* USDC.e against USDC deposited and holds none
            # of it.  Reading the empty side as "no capacity" understated that
            # direction sevenfold; reading it as unbounded would invent a route
            # the moment Circle revoked the allowance.
            if mints_out and allowance:
                reserve, decimals = allowance, nodes.decimals(token_out)
            elif held_out:
                reserve, decimals = held_out, nodes.decimals(token_out)
            else:
                # Neither a reserve nor a mint right: the opposite side's
                # holdings are the only remaining measure of the machine's
                # scale, and too small a cap costs a route where too large
                # invents one.
                reserve, decimals = held_in, nodes.decimals(token_in)
            if reserve == 0:
                continue
            arcs.append(PoolArc(
                id=f"transmute:{adapter}:{token_in[:10]}>{token_out[:10]}",
                pool=adapter, kind=kind, i=0, j=0, n_coins=0,
                token_in=token_in, token_out=token_out,
                tau=nodes.node(token_in), sigma=nodes.node(token_out),
                a=1.0, B=0.0,
                cap=reserve / 10 ** decimals,
                clamped=True, convex_flag=False,
                decimals_in=nodes.decimals(token_in),
                decimals_out=nodes.decimals(token_out),
                reserve_in=reserve,
                tvl_usd=0.0,  # as with mints: the price comes from markets
                note=f"transmute {nodes.symbol(token_out)}",
            ))
    return arcs


def build_stake_arcs(
    nodes: NodeMap, chain: Chain, client: QuoterClient
) -> list[PoolArc]:
    """One-way instant conversions, as capped linear arcs.

    A merge is bidirectional by definition -- one node, zero resistance both ways
    -- so minting cannot be one.  Lido pays 1 stETH per ETH instantly but
    withdrawal is a queue; sUSDe mints on demand but redemption has a seven-day
    cooldown; pufETH the same with a queue.  Merging any of them would let the
    router unstake for free and emit routes that cannot execute.

    They are exactly the §2.3 clamped-arc shape instead: `a` = the mint rate,
    `B = 0` (genuinely linear, not a chord approximation), and a finite cap.  The
    cap is not decoration -- an uncapped linear arc with `eps < 0` gives unbounded
    flow (§2.3 rule 2), and `eps < 0` is precisely what happens when the token
    trades above NAV, which is when minting is attractive.

    Minting is a hard floor at exactly 1:1, and it binds at the sizes where the
    quadratic model is least trustworthy: measured against the ETH/stETH pool, the
    pool wins below ~1,000 ETH and loses by 48.5 bp at 20,000.

    `convex_flag` stays False: these arcs are exactly linear, so §5.5's
    certificate is still valid over them.  `clamped` is True because the cap
    invariant must apply.
    """
    arcs: list[PoolArc] = []
    calls: list[Call] = []
    native: list[tuple] = []
    for token_in, token_out, kind, target, cap_sig in chain.stake_arcs:
        if not (nodes.has(token_in.lower()) and nodes.has(token_out.lower())):
            continue
        native.append((token_in.lower(), token_out.lower(), kind, target.lower(), cap_sig))
        calls.append(Call(target, encode_call(cap_sig)))

    vaults = sorted(
        {v.lower() for v in chain.oneway_vaults if nodes.has(v.lower())}
        | set(mintable_vaults(nodes, client, chain.chain_id))
    )
    for vault in vaults:
        unit = 10 ** nodes.decimals(vault)
        calls.extend([
            Call(vault, encode_call("asset()")),
            Call(vault, encode_call("convertToAssets(uint256)", unit)),
            Call(vault, encode_call("totalAssets()")),
            Call(vault, encode_call("maxDeposit(address)", DEPOSITOR)),
        ])

    if not calls:
        return arcs
    answers = client.raw(calls)

    for k, (token_in, token_out, kind, target, _sig) in enumerate(native):
        limit = answers[k]
        if limit.status is not Status.VALUE or limit.uint() == 0:
            continue
        tau, sigma = nodes.node(token_in), nodes.node(token_out)
        if tau == sigma:
            continue
        arcs.append(PoolArc(
            id=f"stake:{target}:{token_in[:10]}>{token_out[:10]}",
            pool=target, kind=ArcKind[kind], i=0, j=0, n_coins=0,
            token_in=token_in, token_out=token_out, tau=tau, sigma=sigma,
            a=1.0, B=0.0, cap=limit.uint() / 10 ** nodes.decimals(token_in),
            clamped=True, convex_flag=False,
            decimals_in=nodes.decimals(token_in),
            decimals_out=nodes.decimals(token_out),
            tvl_usd=0.0,  # deliberately no weight in the §4 price fit: the
                          # reference price should come from markets, not the
                          # mint rate, which is an upper bound on the token
            note=f"mint {nodes.symbol(token_out)}",
        ))

    base = len(native)
    for k, vault in enumerate(vaults):
        asset_ans, rate_ans, total_ans, room_ans = answers[base + 4 * k : base + 4 * k + 4]
        if asset_ans.status is not Status.VALUE or rate_ans.status is not Status.VALUE:
            continue
        asset = "0x" + asset_ans.data[-20:].hex()
        if not nodes.has(asset):
            continue
        # `convertToAssets` was handed one whole share, so its answer is one
        # share's worth of *asset*, in the asset's decimals -- not the vault's.
        # Dividing by the vault's unit is only right when the two agree, which
        # every hand-listed vault happened to do and no discovered one need:
        # ynUSDx is 18-decimal shares over 6-decimal USDC, and read that way it
        # priced at 917,882,555,091 shares per USDC -- free money, to a solver.
        rate = rate_ans.uint() / 10 ** nodes.decimals(asset)  # assets per share
        if rate <= 0:
            continue
        tau, sigma = nodes.node(asset), nodes.node(vault)
        if tau == sigma:
            continue
        # `maxDeposit` is routinely 2**256-1 on these, which is not a capacity
        # the model may use.  `totalAssets` is a real, finite, on-chain measure
        # that scales with the protocol, and it is conservative.
        total = total_ans.uint() if total_ans.status is Status.VALUE else 0
        if total == 0:
            continue
        # A vault that will not take a deposit right now is not an arc.
        # Discovery finds those -- USD3 answers `maxDeposit` with zero -- where
        # a hand-written list would simply not have named them.
        room = room_ans.uint() if room_ans.status is Status.VALUE else 0
        if room == 0:
            continue
        total = min(total, room)
        arcs.append(PoolArc(
            id=f"mint:{vault}:{asset[:10]}>{vault[:10]}",
            pool=vault, kind=ArcKind.ERC4626_DEPOSIT, i=0, j=0, n_coins=0,
            token_in=asset, token_out=vault, tau=tau, sigma=sigma,
            a=1.0 / rate, B=0.0,
            cap=total / 10 ** nodes.decimals(asset),
            clamped=True, convex_flag=False,
            decimals_in=nodes.decimals(asset),
            decimals_out=nodes.decimals(vault),
            tvl_usd=0.0,
            note=f"mint {nodes.symbol(vault)}",
        ))
    return arcs


def build_lending_arcs(
    nodes: NodeMap, chain: Chain, client: QuoterClient, facts=None
) -> list[PoolArc]:
    """Leaving a lending wrapper, where the protocol still allows it.

    Curve's lending pools trade wrapped tokens -- cDAI against cUSDC -- with the
    underlying only reachable through `exchange_underlying`, which on both
    surviving deployments reverts: Compound V2 answers "mint is paused" and Aave
    V2's reserves are frozen.  Doing the conversion *outside* the pool is the same
    trade in three steps, and the step that fails is the deposit, not the
    withdrawal.

    So a redemption is its own arc.  That makes `USDT -> cDAI -> DAI` routable
    through a pool whose own `exchange_underlying` cannot run, and it is why these
    are arcs rather than node merges: a merge is symmetric and would claim the
    mint direction too.

    Linear, like the mint arcs above -- `underlying = cTokens * rate` with the
    rate carrying the decimal difference -- so `B = 0` and the §5.5 certificate
    survives them.  The cap is the market's own cash: redemption pays out of it,
    and an uncapped linear arc with `eps < 0` gives unbounded flow (§2.3 rule 2).

    `facts` is the committed capability table.  A direction absent from it is not
    built, which is how a paused mint stays out of the graph without a blacklist
    and how it would return on its own if the protocol reopened.
    """
    wrappers = getattr(facts, "wrappers", {}) or {}
    if not wrappers:
        return []

    known = [(a.lower(), entry) for a, entry in wrappers.items()
             if nodes.has(a.lower()) and (entry.get("redeem") or entry.get("mint"))]
    if not known:
        return []

    calls: list[Call] = []
    for address, _ in known:
        calls.extend([
            Call(address, encode_call("underlying()")),
            Call(address, encode_call("exchangeRateStored()")),
            Call(address, encode_call("getCash()")),
        ])
    answers = client.raw(calls)

    arcs: list[PoolArc] = []
    for k, (address, entry) in enumerate(known):
        under_ans, rate_ans, cash_ans = answers[3 * k : 3 * k + 3]
        if under_ans.status is not Status.VALUE or rate_ans.status is not Status.VALUE:
            continue
        underlying = "0x" + under_ans.data[-20:].hex()
        if not nodes.has(underlying):
            continue
        rate = rate_ans.uint()
        cash = cash_ans.uint() if cash_ans.status is Status.VALUE else 0
        if rate == 0 or cash == 0:
            continue
        wrapped_dec = nodes.decimals(address)
        under_dec = nodes.decimals(underlying)
        tau, sigma = nodes.node(address), nodes.node(underlying)
        if tau == sigma:
            continue

        if entry.get("redeem"):
            # `a` is in value coordinates: how much underlying one wrapped
            # token buys, both sides measured in their own units.
            per_token = rate / 10 ** 18 * 10 ** wrapped_dec / 10 ** under_dec
            arcs.append(PoolArc(
                id=f"redeem:{address}:{address[:10]}>{underlying[:10]}",
                pool=address, kind=ArcKind.LEND_REDEEM, i=0, j=0, n_coins=0,
                token_in=address, token_out=underlying, tau=tau, sigma=sigma,
                a=per_token, B=0.0,
                # Only what the market can actually pay out today.
                cap=cash / 10 ** under_dec / max(per_token, 1e-30),
                clamped=True, convex_flag=False,
                decimals_in=wrapped_dec, decimals_out=under_dec,
                tvl_usd=0.0,
                note=f"redeem {nodes.symbol(address)}",
            ))
        if entry.get("mint"):
            arcs.append(PoolArc(
                id=f"lend:{address}:{underlying[:10]}>{address[:10]}",
                pool=address, kind=ArcKind.LEND_MINT, i=0, j=0, n_coins=0,
                token_in=underlying, token_out=address, tau=sigma, sigma=tau,
                a=10 ** 18 / rate * 10 ** under_dec / 10 ** wrapped_dec, B=0.0,
                cap=float("inf") if False else cash / 10 ** under_dec,
                clamped=True, convex_flag=False,
                decimals_in=under_dec, decimals_out=wrapped_dec,
                tvl_usd=0.0,
                note=f"mint {nodes.symbol(address)}",
            ))
    return arcs
