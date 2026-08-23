"""The ROUTE() driver (spec §5.1).

    nu      <- reference_prices(pools, dst)
    a, B    <- calibrate(pools, nu, X)
    G, eps  <- M3, M4
    S       <- seed_subgraph(src, dst, eps, G)
    repeat: solve on S -> price out all m -> extend S
    realize -> legs

Takes a loaded universe and a `QuoterClient`, so it stays in `core`.
"""

from __future__ import annotations

import copy
import math
import time
from dataclasses import dataclass, field

import numpy as np

from .calibrate import Calibration, CalibrationError, calibrate
from .candidates import Candidate, CandidateSet, generate
from .gas import GasTable, min_useful_flow, shape_cost, value_per_gas
from .graph import MAX_CONDITION, ArcArrays, build, scale
from .nodes import NodeMap, rescale
from .pools import PoolSpec
from .prices import (
    MUTED_WEIGHT,
    check_pair_drops,
    price_fit_weights,
    reference_prices,
)
from .probe import (
    COARSE_GRID,
    RETRY_GRID,
    TRADE_GRID,
    ArcRef,
    Ladder,
    collect,
    merge,
    plan_grid,
    plan_refine,
    plan_sized,
)
from .quoter import MAX_LEGS, QuoterClient
from .realize import (
    RealizedRoute,
    _forward_simulate,
    cancel_cycles,
    check_one_arc_per_pool,
    conversion_route,
    prune_dust,
    realize,
    route_conductance,
)
from .refit import RefitReport, refit
from .risk import REVERT_COST_BP, RiskTable
from .seed import k_shortest_paths, seed_subgraph
from .solve import SolveReport, active_set_solve, solve
from .split import ScoutResult as ScoutSplits
from .split import optimise as optimise_splits
from .split import scout as scout_splits
from .split import should_optimise, split_groups
from .types import ArcKind, PoolArc, Probe
from .verify import (
    IMPACT_FRACTION,
    LEG_COST_BP,
    price_impact,
    realize_candidates,
    verify,
)

# What the router proposes by default, against what the quoter can price
# (MAX_LEGS, 128).  A 67-leg route is not executable by any deployed router;
# `--max-legs` opens it up.
DEFAULT_MAX_LEGS = 32

# §12.1's size check.  `theta_p = delta_p / y_p` on the realised flow: how much
# of the pool's own input reserve this arc takes.  The refine pass probes before
# the solve, when nobody knows which arcs carry what, so an arc loaded far past
# anything it was measured at is recalibrated by secant at the realised size and
# re-pivoted.
THETA_RECALIBRATE = 0.03
# Past this the arc is being asked for a fifth of the pool and no secant fit
# is going to describe it; §11.3's remedy is a different model, not a better
# number, so this only warns.
THETA_ESCALATE = 0.10
# Where to sample when recalibrating: a secant needs the realised size and
# something below it, and the origin is free.
THETA_LADDER: tuple[float, ...] = (0.25, 0.5, 1.0)

# §12.4's flow-conservation gate, in two terms -- see `_kcl_tolerance`.
KCL_RELATIVE = 1e-8
KCL_ABSOLUTE = 1e-9
# Double precision.  Named because it appears in a bound, not as a fudge.
EPS = 2.220446049250313e-16
# Headroom over `k * eps` before a residual counts as a real violation rather
# than as the arithmetic the graph's own conditioning ceiling permits.
KCL_CONDITION_SAFETY = 100.0


@dataclass(slots=True)
class RouteResult:
    route: RealizedRoute | None = None
    report: SolveReport | None = None
    arcs: list[PoolArc] = field(default_factory=list)
    graph: ArcArrays | None = None
    nu: np.ndarray | None = None
    nodes: NodeMap | None = None
    src_token: str = ""
    dst_token: str = ""
    amount_in: int = 0
    price_out_per_in: float = 0.0
    fee_bp: float = 0.0
    impact_bp: float = 0.0
    #: Measured price impact: how much worse the price is at full size than
    #: down the same route at `impact_fraction` of it.  `impact_bp` above is
    #: the *modelled* figure from the resistor term; this one is quoted.
    price_impact_bp: float | None = None
    impact_fraction: float = 0.0
    impact_reference_in: int = 0
    impact_reference_out: int = 0
    #: Curves the scout paid for, handed to the split pass so it does not sample
    #: the same arcs twice.  On the result, not the route: a `RealizedRoute`
    #: describes a trade and carries no probe samples.
    scout_curves: list = field(default_factory=list)
    candidates: CandidateSet | None = None
    refit_report: RefitReport | None = None
    winner: Candidate | None = None
    verified_out: int | None = None
    timings: dict[str, float] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    pool_names: dict[str, str] = field(default_factory=dict)

    #: Set when the answer is a node's own conversion rather than a solve.
    sole_route: bool = False

    @property
    def ok(self) -> bool:
        return self.route is not None

    @property
    def certificate(self) -> bool:
        # A conversion between two tokens of one node is not the optimum of a
        # relaxation -- there is nothing to price out, so "no certificate"
        # would report a doubt that does not exist.
        return self.sole_route or bool(self.report and self.report.certificate)

    @property
    def certificate_reason(self) -> str | None:
        if self.certificate:
            return None
        return (self.report.reason if self.report else None) or "NO_SOLUTION"


class RoutingError(RuntimeError):
    pass


def arc_tokens(pool: PoolSpec, kind: ArcKind, i: int, j: int) -> tuple[str, str]:
    """What an arc of this kind on this pool trades, in and out.

    Which index is meaningful differs -- `i` for a deposit, `j` for a
    withdrawal -- because that is what the calldata uses.
    """
    if kind.is_deposit:
        return pool.coins[i].address, pool.lp_token
    if kind.is_withdraw:
        return pool.lp_token, pool.coins[j].address
    return pool.coins[i].address, pool.coins[j].address


def build_arcs(
    pools: list[PoolSpec], nodes: NodeMap
) -> tuple[list[ArcRef], list[tuple[PoolSpec, int, int]]]:
    """Every quotable interaction, with its probe target and metadata.

    Swaps, plus single-sided deposits and withdrawals where the pool's LP token
    is a node -- without them 51 mainnet tokens have no path at all.

    Proportional `remove_liquidity` is deliberately absent: it returns all coins
    at once, a hyperedge rather than an arc, which §3.3 cannot tie to fixed
    ratios.  Multi-coin `add_liquidity` is the same shape reversed.
    """
    refs: list[ArcRef] = []
    meta: list[tuple[PoolSpec, int, int]] = []

    def offer(kind: ArcKind, i: int, j: int, reserve: int, dec_in: int, dec_out: int,
              reserve_out: int = 0):
        token_in, token_out = arc_tokens(pool, kind, i, j)
        if not (token_in and token_out):
            return
        if (int(kind), i, j) in pool.blocked_arcs:
            return  # quotes, and reverts when executed; see PoolSpec.blocked_arcs
        if not (nodes.has(token_in) and nodes.has(token_out)):
            return
        if nodes.node(token_in) == nodes.node(token_out):
            return  # self-loop after merging; see the note in route()
        refs.append(
            ArcRef(pool=pool.address, kind=kind, i=i, j=j, n_coins=pool.n_coins,
                   reserve_in=reserve, decimals_in=dec_in, decimals_out=dec_out,
                   reserve_out=reserve_out)
        )
        meta.append((pool, i, j))

    for pool in pools:
        if not pool.balances:
            continue
        kind = pool.swap_kind
        if kind is not None:
            for i, j in pool.swap_pairs():
                if i >= len(pool.balances) or pool.balances[i] <= 0:
                    continue
                offer(kind, i, j, pool.balances[i],
                      pool.coins[i].decimals, pool.coins[j].decimals,
                      reserve_out=pool.balances[j] if j < len(pool.balances) else 0)

        # An LP token with no supply cannot be withdrawn from and cannot be
        # priced into: `calc_withdraw_one_coin` divides by it.
        if not pool.lp_token or pool.lp_supply <= 0:
            continue
        deposit, withdraw = pool.deposit_kind, pool.withdraw_kind
        for k in range(pool.n_coins):
            if k >= len(pool.balances) or pool.balances[k] <= 0:
                continue
            # `calc_token_amount` answers for anyone; `add_liquidity` does not
            # when the pool's allowlist is on, so offering the arc would quote a
            # deposit that reverts on execution.  Withdrawals stay.
            if not pool.deposit_gated:
                offer(deposit, k, 0, pool.balances[k],
                      pool.coins[k].decimals, pool.lp_decimals,
                      reserve_out=pool.lp_supply)
            if withdraw is not None:
                offer(withdraw, 0, k, pool.lp_supply,
                      pool.lp_decimals, pool.coins[k].decimals,
                      reserve_out=pool.balances[k])
    return refs, meta


def _realised_delta(arc: PoolArc, psi_value: float, nu, nodes: NodeMap) -> float:
    """This arc's realised input, in its own token's raw units."""
    price = float(nu[arc.tau])
    rate = nodes.rate(arc.token_in)
    if price <= 0 or rate <= 0 or psi_value <= 0:
        return 0.0
    return psi_value / price / rate * 10**arc.decimals_in


def _realised_theta(arcs: list[PoolArc], psi, nu, nodes: NodeMap,
                    active) -> dict[int, float]:
    """§12.1's `theta_p` for every arc carrying flow."""
    out: dict[int, float] = {}
    for k in active:
        arc = arcs[int(k)]
        if arc.reserve_in <= 0:
            continue
        delta = _realised_delta(arc, float(psi[int(k)]), nu, nodes)
        if delta > 0:
            out[int(k)] = delta / arc.reserve_in
    return out


def _to_arc(
    pool: PoolSpec, i: int, j: int, ref: ArcRef, fit: Calibration, nodes: NodeMap
) -> PoolArc:
    token_in, token_out = arc_tokens(pool, ref.kind, i, j)
    a, B = rescale(fit.a, fit.B, nodes.rate(token_in), nodes.rate(token_out))
    cap = fit.cap
    if math.isfinite(cap):
        cap = cap * nodes.rate(token_in)
    return PoolArc(
        id=ref.id,
        pool=pool.address,
        # The *arc's* kind, not the pool's: one pool now yields swaps,
        # deposits and withdrawals, and they execute differently.
        kind=ArcKind(ref.kind),
        i=i,
        j=j,
        n_coins=pool.n_coins,
        token_in=token_in,
        token_out=token_out,
        tau=nodes.node(token_in),
        sigma=nodes.node(token_out),
        a=a,
        B=B,
        cap=cap,
        calib_delta=fit.calib_delta,
        convex_flag=fit.convex_flag,
        clamped=fit.clamped,
        flag_reason=fit.flag_reason,
        drift=fit.drift,
        eta=fit.eta,
        reserve_in=ref.reserve_in,
        decimals_in=ref.decimals_in,
        decimals_out=ref.decimals_out,
        tvl_usd=pool.tvl_usd,
        note=pool.name,
    )


def _quantum(decimals_out: int) -> float:
    """One unit of the output token, in the human units calibration fits in.

    Curve quotes integers, so this is the resolution of every ladder measurement.
    """
    return 10.0 ** -int(decimals_out)


def calibrate_arcs(
    refs: list[ArcRef],
    meta: list[tuple[PoolSpec, int, int]],
    ladders: list[Ladder],
    nodes: NodeMap,
) -> tuple[list[PoolArc], list[str]]:
    arcs: list[PoolArc] = []
    dropped: list[str] = []
    lookup = {id(lad.arc): lad for lad in ladders}
    for ref, (pool, i, j) in zip(refs, meta, strict=True):
        ladder = next((lad for lad in ladders if lad.arc is ref), None) or lookup.get(id(ref))
        if ladder is None or not ladder.ok:
            dropped.append(f"{ref.id}: only {0 if ladder is None else len(ladder.deltas)} probes")
            continue
        deltas, quotes = ladder.as_float()
        try:
            fit = calibrate(deltas, quotes, quantum=_quantum(ref.decimals_out))
        except CalibrationError as exc:
            dropped.append(f"{ref.id}: {exc}")
            continue
        arcs.append(_to_arc(pool, i, j, ref, fit, nodes))
    pair_directions(arcs)
    return arcs, dropped


def pair_directions(arcs: list[PoolArc]) -> int:
    """Link each arc to its opposite and record the fee the pair measures.

    `gamma_live = sqrt(a_f * a_r)` reads a pool's *current* retention off two
    tiny probes, with no fee parameter and no ABI knowledge of the fee law
    (spec 2.6).  The node-merge rescaling cancels in the product, so it is the
    same number in canonical coordinates as in the pool's own.

    Only same-kind pairs qualify: a deposit's opposite is a withdrawal, and
    round-tripping those measures two fees plus an imbalance, not one fee.
    """
    by_id = {arc.id: arc for arc in arcs}
    paired = 0
    for arc in arcs:
        other = by_id.get(f"{arc.pool.lower()}:{int(arc.kind)}:{arc.j}>{arc.i}")
        if other is None:
            continue
        arc.reverse_id = other.id
        if arc.a > 0 and other.a > 0:
            arc.gamma_live = math.sqrt(arc.a * other.a)
            paired += 1
    return paired


def _client_block(client) -> int:
    """The block a client is pinned to, or 0 if it will not say.

    Zero means "unknown", which reuses a preparation rather than rebuilding.
    """
    try:
        return int(getattr(getattr(client, "transport", None), "block", 0) or 0)
    except (TypeError, ValueError):
        return 0


def prepare(
    pools: list[PoolSpec],
    nodes: NodeMap,
    client: QuoterClient,
    *,
    src_token: str,
    dst_token: str,
    extra_arcs: list[PoolArc] | None = None,
    timings: dict[str, float] | None = None,
) -> Prepared:
    """The size-independent half: probe, calibrate, restrict, price.

    A function of the block and the pair, not the amount -- so it is paid once.
    """
    scratch = RouteResult(src_token=src_token.lower(), dst_token=dst_token.lower(),
                          nodes=nodes)
    clock = _Clock(timings if timings is not None else scratch.timings)
    src_node, dst_node = nodes.node(src_token), nodes.node(dst_token)

    # --- probe, pass 1: the whole universe, coarsely (§2.6) ---------------
    #
    # The §5.5 certificate needs only `eps`, hence only `a`; `B` matters only
    # where flow goes.  Two points each here, the full ladder later on the arcs
    # that could carry something.
    with clock("arcs"):
        refs, meta = build_arcs(pools, nodes)
        plan = plan_grid(refs, grid=COARSE_GRID)
    with clock("probe"):
        ladders = collect(plan, client.probe(plan.probes))
        retry = plan_refine(
            ladders, {lad.arc.id for lad in ladders if not lad.ok}, grid=RETRY_GRID
        )
        if retry.probes:
            merge(ladders, collect(retry, client.probe(retry.probes)))
            scratch.counters["probes_retried"] = len(retry)
    with clock("calibrate"):
        arcs, dropped = calibrate_arcs(
            plan.arcs, _align(plan.arcs, refs, meta), ladders, nodes
        )
    scratch.warnings.extend(dropped[:20])
    scratch.counters["pools"] = len(pools)
    scratch.counters["arcs_planned"] = len(refs)
    scratch.counters["probes"] = len(plan)
    scratch.counters["arcs_calibrated"] = len(arcs)
    # Mint/stake arcs are exactly linear by construction, so they are supplied
    # already calibrated rather than probed -- there is no curve to measure.
    if extra_arcs:
        arcs = arcs + [copy.copy(a) for a in extra_arcs]
        scratch.counters["stake_arcs"] = len(extra_arcs)
    if not arcs:
        raise RoutingError("no arc survived calibration")

    # Restrict to the part of the graph that can reach the destination.  A
    # disconnected island has no price relative to the numeraire --
    # `reference_prices` returns 1.0 there as a placeholder, not as a valuation
    # -- and those arcs give conductances orders of magnitude off, wrecking the
    # Laplacian's conditioning for everything else.
    with clock("component"):
        arcs = _restrict_to_component(arcs, dst_node, nodes.n_nodes, scratch)
        arcs = _prune_dead_end_nodes(arcs, src_node, dst_node, scratch)
    if not arcs:
        raise RoutingError(f"{nodes.symbol(dst_token)} is not reachable from any pool")
    if not any(a.tau == src_node or a.sigma == src_node for a in arcs):
        raise RoutingError(
            f"no path from {nodes.symbol(src_token)} to {nodes.symbol(dst_token)}"
        )

    # --- reference prices (§4) -------------------------------------------
    with clock("prices"):
        a_vec = np.array([a.a for a in arcs])
        tau_vec = np.array([a.tau for a in arcs], dtype=np.int64)
        sig_vec = np.array([a.sigma for a in arcs], dtype=np.int64)
        keys = [(arc.pool.lower(), arc.i, arc.j) for arc in arcs]
        # An arc whose reverse direction contradicts it is not reporting a
        # price and must not vote in the fit.  Half weight because both
        # directions are separate arcs and a pool must not count twice.
        listed = np.array([max(a.tvl_usd, 1.0) / 2 for a in arcs])
        weights = price_fit_weights(keys, a_vec, listed)
        nu = reference_prices(
            tau_vec, sig_vec, a_vec, weights, nodes.n_nodes, dst_node,
        )
        # Second pass, weighted by what each pool holds at this block rather
        # than by `tvl_usd`, which is the one input `--block` does not pin.
        # Whole-pool value, halved per arc: an arc's own input reserve weights
        # the two directions of an imbalanced pool unequally (58.8 bp, measured).
        held: dict[str, float] = {}
        for pool in pools:
            if not pool.balances or len(pool.balances) != len(pool.coins):
                continue
            total = 0.0
            for balance, coin in zip(pool.balances, pool.coins, strict=True):
                if not nodes.has(coin.address):
                    continue
                node = nodes.node(coin.address)
                total += (balance / 10**coin.decimals * nodes.rate(coin.address)
                          * float(nu[node]))
            if total > 0:
                held[pool.address.lower()] = total
        block_value = np.array([held.get(arc.pool.lower(), 0.0) for arc in arcs])
        priced = np.isfinite(block_value) & (block_value > 0)
        scratch.counters["arcs_weighted_from_block"] = int(np.count_nonzero(priced))
        if priced.any():
            # A pool we could not value keeps the listed weight rather than
            # dropping to zero: the fit needs every weight strictly positive,
            # and a wrapper that reports nothing is not evidence of no depth.
            weights = price_fit_weights(
                keys, a_vec, np.where(priced, block_value / 2, listed)
            )
            nu = reference_prices(
                tau_vec, sig_vec, a_vec, weights, nodes.n_nodes, dst_node,
            )
        muted = int(np.count_nonzero(weights <= MUTED_WEIGHT))
        if muted:
            scratch.counters["arcs_muted_in_price_fit"] = muted

    return Prepared(
        arcs=arcs, ladders=ladders, nu=nu, src_node=src_node, dst_node=dst_node,
        pool_names={a.pool.lower(): a.note for a in arcs},
        counters=dict(scratch.counters), warnings=list(scratch.warnings),
        block=_client_block(client),
    )


def _conversion_only(
    result: RouteResult, clock, nodes: NodeMap, client: QuoterClient, *,
    src_token: str, dst_token: str, amount_in: int, verify_on_chain: bool,
) -> RouteResult:
    """Quote a pair that shares a node -- the merge itself is the route."""
    with clock("realize"):
        route = conversion_route(nodes, src_token=src_token, dst_token=dst_token,
                                 amount_in=amount_in)
    result.route = route
    result.sole_route = True
    result.counters["conversion_only"] = 1
    if not route.legs:
        # An ALIAS pair: two addresses over one balance, so there is nothing to
        # call and nothing to verify.  The output is the input, exactly.
        result.verified_out = amount_in
        return result
    if verify_on_chain:
        with clock("verify"):
            quoted = client.quote_routes([route.wire_legs], [amount_in],
                                         [route.dst_slot])
        got = int(quoted[0]) if quoted else 0
        if got <= 0:
            raise RoutingError(
                f"{nodes.symbol(src_token)} converts to {nodes.symbol(dst_token)}, "
                "but the conversion did not quote -- it may be paused or capped")
        result.verified_out = got
    else:
        result.verified_out = route.modelled_out
    return result


@dataclass(slots=True)
class Prepared:
    """Everything about a (universe, src, dst) that does not depend on size.

    A property of the model, not a convenience: probe sizes are fractions of each
    pool's reserves, and `G_p` and `eps_p` contain no `Psi`, which enters only at
    the dust floor, the caps and the solve's right-hand side.  So a second size
    reuses the probes, the calibration and the price fit, and re-runs only the
    solve.
    """

    arcs: list[PoolArc]
    ladders: list[Ladder]
    nu: np.ndarray
    src_node: int
    dst_node: int
    pool_names: dict[str, str] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    quotes: int = 0
    #: The block every number in here was measured at.  Reusing a preparation
    #: across a block change would mix derivatives fitted at two chain states;
    #: `route` rebuilds instead.  Zero means "not recorded".
    block: int = 0


def route(
    pools: list[PoolSpec],
    nodes: NodeMap,
    client: QuoterClient,
    *,
    src_token: str,
    dst_token: str,
    amount_in: int,
    max_rounds: int = 8,
    seed_k: int = 10,
    verify_on_chain: bool = True,
    max_candidates: int = 20,
    gas_price_wei: int = 0,
    refit_rounds: int = 2,
    prepared: Prepared | None = None,
    extra_arcs: list[PoolArc] | None = None,
    optimise_split: bool = True,
    max_legs: int = DEFAULT_MAX_LEGS,
    gas_table: GasTable | None = None,
    risk_table: RiskTable | None = None,
    revert_cost_bp: float = REVERT_COST_BP,
    leg_cost_bp: float = LEG_COST_BP,
    measure_impact: bool = True,
    impact_fraction: float = IMPACT_FRACTION,
) -> RouteResult:
    result = RouteResult(
        src_token=src_token.lower(),
        dst_token=dst_token.lower(),
        amount_in=amount_in,
        nodes=nodes,
    )
    clock = _Clock(result.timings)

    if not nodes.has(src_token) or not nodes.has(dst_token):
        raise RoutingError("source or destination token is not in the universe")
    src_node, dst_node = nodes.node(src_token), nodes.node(dst_token)
    if src_node == dst_node:
        if src_token.lower() == dst_token.lower():
            raise RoutingError(
                f"{nodes.symbol(src_token)} to itself is not a trade")
        # Same node, different tokens: the answer is the conversion, not an
        # error.  There is no arc between them *because* they are merged, but a
        # deposit into scrvUSD is still a trade a user can ask for.
        return _conversion_only(
            result, clock, nodes, client, src_token=src_token,
            dst_token=dst_token, amount_in=amount_in,
            verify_on_chain=verify_on_chain,
        )

    # A preparation is a function of (universe, block); a moved block means
    # every probe, every `a`, every `B` was fitted against a different state.
    now = _client_block(client)
    # A client answering from a pool's own arithmetic built that model from
    # storage read once, so on a moving block it goes on quoting the previous
    # block's pool -- silently, and precisely on the pools it is most confident
    # about.  Ask it to catch up before re-fitting against it.
    refresh = getattr(client, "refresh_at", None)
    if refresh is not None and now:
        rebuilt = refresh(now)
        if rebuilt:
            result.counters["exact_models_rebuilt"] = rebuilt
    stale = (prepared is not None and prepared.block and now
             and prepared.block != now)
    if prepared is None or stale:
        if stale:
            result.counters["preparation_refit_at_new_block"] = now
        with clock("prepare"):
            prepared = prepare(
                pools, nodes, client, src_token=src_token, dst_token=dst_token,
                extra_arcs=extra_arcs, timings=result.timings,
            )
    else:
        result.counters["reused_preparation"] = 1

    # A fresh copy per quote: `_assemble` writes `G`/`eps` back onto the arcs
    # and the §8 refit re-anchors `B` at one size's realised flows, so handing
    # the same objects to the next quote would leak this size into it.
    arcs = [copy.copy(a) for a in prepared.arcs]
    # The ladders need the same treatment.  §8 probes at the sizes *this* quote
    # realised and `merge`s them in, so without a copy a second quote through
    # the same `Prepared` recalibrates from the first quote's sizes.  Shallow is
    # enough for the lists, which `merge` rebinds rather than mutates, but
    # `failures` is updated in place and needs its own dict.
    ladders = []
    for ladder in prepared.ladders:
        clone = copy.copy(ladder)
        clone.failures = dict(ladder.failures)
        ladders.append(clone)
    nu = prepared.nu
    result.arcs = arcs
    result.nu = nu
    result.pool_names = dict(prepared.pool_names)
    result.counters.update(prepared.counters)
    result.warnings.extend(prepared.warnings)

    return _quote(
        result, clock, pools, nodes, client, arcs, ladders, nu,
        src_token=src_token, dst_token=dst_token, amount_in=amount_in,
        src_node=src_node, dst_node=dst_node, max_rounds=max_rounds,
        seed_k=seed_k, verify_on_chain=verify_on_chain,
        max_candidates=max_candidates, gas_price_wei=gas_price_wei,
        refit_rounds=refit_rounds, prepared=prepared, max_legs=max_legs,
        measure_impact=measure_impact, impact_fraction=impact_fraction,
        gas_table=gas_table, risk_table=risk_table,
                        revert_cost_bp=revert_cost_bp, leg_cost_bp=leg_cost_bp,
        optimise_split=optimise_split,
    )


def _quote(
    result: RouteResult,
    clock,
    pools: list[PoolSpec],
    nodes: NodeMap,
    client: QuoterClient,
    arcs: list[PoolArc],
    ladders: list[Ladder],
    nu: np.ndarray,
    *,
    src_token: str,
    dst_token: str,
    amount_in: int,
    src_node: int,
    dst_node: int,
    max_rounds: int,
    seed_k: int,
    verify_on_chain: bool,
    max_candidates: int,
    gas_price_wei: int,
    refit_rounds: int,
    prepared: Prepared | None,
    optimise_split: bool = True,
    max_legs: int = DEFAULT_MAX_LEGS,
    gas_table: GasTable | None = None,
    risk_table: RiskTable | None = None,
    revert_cost_bp: float = REVERT_COST_BP,
    leg_cost_bp: float = LEG_COST_BP,
    measure_impact: bool = True,
    impact_fraction: float = IMPACT_FRACTION,
) -> RouteResult:
    """The size-dependent half: graph, solve, candidates, verify, refit."""
    amount_human = amount_in / 10 ** nodes.decimals(src_token) * nodes.rate(src_token)
    Psi = float(nu[src_node] * amount_human)
    if Psi <= 0:
        raise RoutingError("input amount prices to zero value")

    # --- graph (§3.1, §9.5-9.7) -----------------------------------------
    with clock("graph"):
        arcs, g = _assemble(arcs, nu, Psi, nodes, src_node, dst_node, result)
    with clock("seed"):
        g, Psi_scaled = scale(g, Psi)
        seed = seed_subgraph(g, src_node, dst_node, k=seed_k)

    # --- probe, pass 2: the full ladder, only where it can matter ---------
    with clock("refine"):
        wanted = {arcs[k].id for k in np.flatnonzero(seed)}
        wanted |= {a.id for a in arcs if a.tau in (src_node, dst_node) or a.sigma in (src_node, dst_node)}
        # And every arc the client can *compute* rather than probe.  The
        # shortlist exists because a probe costs a round trip, and a derivative
        # fitted near zero describes a different curve than the one a $2M trade
        # rides -- so which arcs made the shortlist decided the answer.  Where
        # the pool's own invariant can be evaluated there is no round trip, so
        # re-fit all of those every quote; the rest keep the shortlist.
        computes = getattr(client, "computes", None)
        if computes is not None:
            free = {a.id for a in arcs if computes(a.pool)}
            result.counters["arcs_refined_free"] = len(free - wanted)
            wanted |= free
        # Sample where the flow will land, not near zero.  `Psi / nu[tau]` is
        # the amount of this arc's input token worth the whole trade, so the
        # fractions read as "5%, 10%, 20% of the swap".  The coarse pass cannot
        # do this: it is what produces `nu`.
        sizes: dict[str, list[int]] = {}
        for arc in arcs:
            if arc.id not in wanted:
                continue
            price = float(nu[arc.tau])
            rate = nodes.rate(arc.token_in)
            if price <= 0 or rate <= 0:
                continue
            whole = Psi / price / rate * 10**arc.decimals_in
            if not math.isfinite(whole) or whole <= 0:
                continue
            sizes[arc.id] = [int(whole * f) for f in TRADE_GRID]
        extra = plan_sized(ladders, sizes)
        result.counters["probes_refined"] = len(extra)
        if extra.probes:
            merge(ladders, collect(extra, client.probe(extra.probes)))
            refined = _recalibrate(arcs, ladders, nodes)
            result.counters["arcs_refined"] = refined
            if refined:
                arcs, g = _assemble(arcs, nu, Psi, nodes, src_node, dst_node, result)
                g, Psi_scaled = scale(g, Psi)
                seed = seed_subgraph(g, src_node, dst_node, k=seed_k)
    result.arcs = arcs
    result.graph = g

    # --- solve (§5.4, §5.5) ----------------------------------------------
    with clock("seed"):
        seed = seed_subgraph(g, src_node, dst_node, k=seed_k)
        # §5.4's warm start, and it is a function of *this* quote and nothing
        # else.  A previous size's support must not be carried forward: column
        # generation is capped at `max_rounds` and the candidate re-solves run
        # truncated, so the starting basis decides which candidates exist --
        # measured at 26.5 bp between the same quote run alone and run after a
        # smaller one.  A session may reuse anything that is a function of
        # (universe, block), never of a previous query.
        best_path = k_shortest_paths(g, src_node, dst_node, k=1)
        warm_start = np.array(best_path[0]) if best_path else None
    with clock("solve"):
        report = solve(
            g, src_node, dst_node, Psi_scaled, seed=seed,
            max_rounds=max_rounds, A0=warm_start,
        )
    result.report = report
    if not report.solution.feasible:
        raise RoutingError(report.reason or "no feasible route")

    psi = report.solution.psi * g.g_scale
    psi, cycles = cancel_cycles(g.tau, g.sig, psi)
    if cycles:
        result.counters["cycles_cancelled"] = cycles
        result.warnings.append(
            f"{cycles} circulation(s) removed from the optimal flow: the model "
            "found a negative-eps loop it cannot execute as a one-way trade (§2.6)"
        )
    # Decompose the loss here, against the graph that produced this flow.
    # Candidate generation and the refit both mutate `g` -- the refit re-anchors
    # B at realised sizes -- so pairing this psi with a later G reports nonsense.
    fee, impact = report.solution.loss_split(g)
    result.fee_bp = fee * g.g_scale / Psi * 10_000
    result.impact_bp = impact * g.g_scale / Psi * 10_000

    active = np.flatnonzero(psi > 0)
    if active.size == 0:
        raise RoutingError("the optimal flow is empty")

    # --- §12.1 size check -------------------------------------------------
    thetas = _realised_theta(arcs, psi, nu, nodes, active)
    result.counters["max_theta"] = max(thetas.values(), default=0.0)
    # Everything the model is loading past what it measured, with no ceiling.
    # There used to be one at THETA_ESCALATE, but re-probing an arc past the
    # pool's own reserve does not measure it -- the quotes come back saturated
    # and `_recalibrate` reads that as a wall.  The `reserve_in` clamp below now
    # forbids that outright, so the ceiling only excluded the arcs whose `B` is
    # least trustworthy.
    over = {k: v for k, v in thetas.items() if v > THETA_RECALIBRATE}
    if over and refit_rounds > 0:
        with clock("size_check"):
            sizes = {}
            for k in over:
                delta = _realised_delta(arcs[k], float(psi[k]), nu, nodes)
                # Never ask a pool for more than it holds: past that the answer
                # is a wall rather than a curve.
                delta = min(delta, float(arcs[k].reserve_in))
                if delta > 0:
                    sizes[arcs[k].id] = [int(delta * f) for f in THETA_LADDER]
            extra = plan_sized(ladders, sizes)
            result.counters["probes_size_check"] = len(extra)
            if extra.probes:
                merge(ladders, collect(extra, client.probe(extra.probes)))
                refitted = _recalibrate(arcs, ladders, nodes)
                result.counters["arcs_size_checked"] = refitted
                if refitted:
                    arcs, g = _assemble(arcs, nu, Psi, nodes, src_node, dst_node, result)
                    g, Psi_scaled = scale(g, Psi)
                    seed = seed_subgraph(g, src_node, dst_node, k=seed_k)
                    report = solve(g, src_node, dst_node, Psi_scaled, seed=seed,
                                   max_rounds=max_rounds)
                    if report.solution.feasible:
                        result.report = report
                        psi = report.solution.psi * g.g_scale
                        psi, _ = cancel_cycles(g.tau, g.sig, psi)
                        # Against the graph that produced *this* flow (see above).
                        fee, impact = report.solution.loss_split(g)
                        result.fee_bp = fee * g.g_scale / Psi * 10_000
                        result.impact_bp = impact * g.g_scale / Psi * 10_000
                        result.arcs, result.graph = arcs, g
                        active = np.flatnonzero(psi > 0)
                        if active.size == 0:
                            raise RoutingError("the optimal flow is empty")
                        thetas = _realised_theta(arcs, psi, nu, nodes, active)
                        result.counters["max_theta"] = max(thetas.values(), default=0.0)
    if result.counters.get("max_theta", 0.0) > THETA_ESCALATE:
        worst = max(thetas.items(), key=lambda kv: kv[1])
        result.warnings.append(
            f"{arcs[worst[0]].note[:24]} is taking {worst[1]:.1%} of its own "
            f"reserve: past ~{THETA_ESCALATE:.0%} a secant fit describes the "
            f"pool poorly and the modelled loss understates the real one (§12.1)"
        )

    # Nothing about this quote is written back onto the preparation -- see the
    # warm-start note above.  The count is the one exception, and it is a
    # counter rather than an input to anything.
    if prepared is not None:
        prepared.quotes += 1

    # §12.4: KCL must hold on the flow we are about to execute.  This is the
    # invariant that catches conjured or stranded flow before it reaches a leg.
    residual = _kcl_residual(g, psi, src_node, dst_node, Psi)
    result.counters["kcl_residual"] = residual
    tolerance = _kcl_tolerance(Psi, g.g_scale)
    if residual > tolerance:
        # Before failing, ask what accuracy the solve could have had.  A
        # Laplacian of condition number `k` yields relative error about
        # `k * eps`, and the graph tolerates `k` up to MAX_CONDITION = 1e12 --
        # four orders coarser than the flat 1e-8 above, which is why a route
        # landing either side of the flat bound moved with BLAS thread count.
        # `cond` is computed only here, on the path about to fail.
        conditioned = _achievable_kcl(g, report.solution.A, dst_node)
        if residual > max(tolerance, conditioned):
            _r, node, n_in, n_out = _kcl_detail(g, psi, src_node, dst_node, Psi)
            where = nodes.node_symbol(node) if node >= 0 else "?"
            # Say which failure this is.  Flow leaving a node with none
            # arriving is conjured, not imprecise, and no amount of better
            # conditioning would fix it.
            shape = (" -- flow leaves this node with none arriving"
                     if n_in == 0 and n_out > 0 else
                     (" -- flow arrives at this node with none leaving"
                      if n_out == 0 and n_in > 0 else ""))
            raise RoutingError(
                f"flow conservation is violated by {residual:.3e} of the routed "
                f"value at {where} ({n_in} arc(s) in, {n_out} out){shape} "
                f"(achievable at this conditioning: {conditioned:.3e})"
            )
        result.counters["kcl_conditioning_allowed"] = 1
    # §12.2b: `gap` bounds the objective still on the table, so a DEGENERATE
    # route can say "optimal to within 0.024 bp" rather than only "not proven".
    if report.gap > 0 and Psi_scaled > 0:
        result.counters["optimality_gap_bp"] = report.gap / Psi_scaled * 1e4
    result.counters["active_arcs"] = int(active.size)
    result.counters["pivots"] = report.solution.pivots
    result.counters["cg_rounds"] = report.cg_rounds
    result.counters["arcs_priced_out"] = g.m

    # --- realize (§5.6) ---------------------------------------------------
    with clock("realize"):
        # Strictly after the KCL check above: that invariant is about the flow
        # the solver produced, this is about the flow the quoter can survive.
        psi, dust = prune_dust(g.tau, g.sig, psi, src_node, dst_node)
        if dust:
            result.counters["dust_arcs_pruned"] = dust
            active = np.flatnonzero(psi > 0)
            if active.size == 0:
                raise RoutingError("the optimal flow is empty")
        live = [arcs[k] for k in active]
        result.route = realize(
            live, psi[active], nu, nodes,
            src_token=src_token, dst_token=dst_token, amount_in=amount_in,
            potentials=report.solution.u,
        )
    conflicts = check_one_arc_per_pool(result.route)
    if conflicts:
        result.warnings.append(
            f"{len(conflicts)} pool(s) used more than once; a view-only quote "
            "cannot see its own earlier leg (§7 rule 1)"
        )

    # --- candidates and on-chain verification (§6, §7) --------------------
    if verify_on_chain:
        scaled = report.solution.psi.copy()
        # The §11.1 bound, in the solver's scaled value units; zero when gas is
        # disabled.  Gas screens *candidate* generation only -- the base solve
        # stays gas-blind so it is always present as a candidate and the
        # gas-aware ones can only win when they are net better.
        dst_wei_per_eth = _dst_per_eth(nodes, nu, dst_token)
        gas_floor = _gas_cost(nodes, nu, dst_token, gas_price_wei, g.g_scale)
        result.counters["gas_floor_bp"] = int(
            gas_floor * g.g_scale / Psi * 10_000 if Psi > 0 else 0
        )
        # A pool paying two ports out of one coin can be priced as a single
        # element, which advances the pool between legs; `candidates` is pure
        # and holds `a` and `B` rather than a pool model, so the pricing is
        # handed in.  `None` from any of it means the sweep handles that pool
        # as before.
        splitter = getattr(client, "element_split", None)

        def element_split(one, two, psi_one: float, psi_two: float):
            total = (psi_one + psi_two) * g.g_scale
            if total <= 0 or one.pool.lower() != two.pool.lower():
                return None
            delta = int(_realised_delta(one, total, nu, nodes))
            if delta <= 0:
                return None
            got = splitter(one.pool, one.i, one.j, two.j, delta)
            if not got:
                return None
            first = total * got[0] / 10_000 / g.g_scale
            return first, (total / g.g_scale) - first

        with clock("candidates"):
            pool_set = generate(
                g, arcs, src_node, dst_node, Psi_scaled, report.solution,
                base_certificate=report.certificate, seed=seed,
                max_candidates=max_candidates, gas_floor=gas_floor,
                max_legs=max_legs,
                element_split=element_split if splitter is not None else None,
            )
            for candidate in pool_set.candidates:
                candidate.psi = candidate.psi * g.g_scale
            del scaled
            realize_candidates(
                pool_set, arcs, nu, nodes,
                src_token=src_token, dst_token=dst_token, amount_in=amount_in,
                potentials=report.solution.u, max_legs=max_legs,
            )
        with clock("verify"):
            verify(
                pool_set, client, amount_in=amount_in,
                gas_price_wei=gas_price_wei, dst_wei_per_eth=dst_wei_per_eth,
                    gas_table=gas_table, risk_table=risk_table,
                        revert_cost_bp=revert_cost_bp, leg_cost_bp=leg_cost_bp,
            )
        result.candidates = pool_set
        result.counters["candidates"] = len(pool_set)
        result.counters["candidate_solves"] = pool_set.solves
        result.counters["candidate_pivots"] = pool_set.pivots
        result.counters["candidates_quoted"] = sum(
            1 for c in pool_set.candidates if c.verified_out is not None
        )
        result.counters["candidates_reverted"] = sum(
            1 for c in pool_set.candidates if c.status == "reverted"
        )

        # The safety floor: quote every obvious one-hop swap too, so the
        # winner can never be worse than something found by inspection.
        with clock("direct"):
            direct, direct_arcs = direct_candidates(
                pools, nodes, nu, src_token, dst_token, amount_in
            )
            for candidate, arc in zip(direct, direct_arcs, strict=True):
                trial = CandidateSet([candidate])
                realize_candidates(
                    trial, [arc], nu, nodes,
                    src_token=src_token, dst_token=dst_token, amount_in=amount_in,
                    max_legs=max_legs,
                )
                if candidate.status == "ready":
                    pool_set.candidates.append(candidate)
            chains, chain_arcs = two_step_candidates(
                pools, nodes, nu, client, src_token, dst_token, amount_in
            )
            for candidate, pair in zip(chains, chain_arcs, strict=True):
                trial = CandidateSet([candidate])
                realize_candidates(
                    trial, pair, nu, nodes,
                    src_token=src_token, dst_token=dst_token, amount_in=amount_in,
                    max_legs=max_legs,
                )
                if candidate.status == "ready":
                    pool_set.candidates.append(candidate)
            result.counters["direct_candidates"] = len(direct)
            result.counters["two_step_candidates"] = len(chains)
            if direct or chains:
                verify(
                    pool_set, client, amount_in=amount_in,
                    gas_price_wei=gas_price_wei, dst_wei_per_eth=dst_wei_per_eth,
                    gas_table=gas_table, risk_table=risk_table,
                        revert_cost_bp=revert_cost_bp, leg_cost_bp=leg_cost_bp,
                )

        winner = pool_set.best
        if winner is None:
            # The modelled route was never capped -- it is the relaxation's own
            # answer, not a candidate -- so falling back to it would break the
            # limit the caller set.
            if result.route and len(result.route.legs) > max_legs:
                raise RoutingError(
                    f"no route within {max_legs} legs: every candidate was "
                    f"longer, and the modelled route needs "
                    f"{len(result.route.legs)}"
                )
            result.warnings.append(
                "no candidate could be quoted on-chain; falling back to the "
                "modelled route (treat the output as unverified)"
            )
        else:
            result.route = winner.route
            result.verified_out = winner.verified_out
            result.winner = winner
            if not winner.certificate:
                report.certificate = False
                report.reason = report.reason or winner.reason or "RESTRICTED"

            # --- §8 refit: re-anchor the winner at its realised sizes --------
            if refit_rounds > 0:
                with clock("refit"):
                    _refit_winner(
                        result, pool_set, winner, g, arcs, nu, nodes, client,
                        src_node=src_node, dst_node=dst_node, Psi=Psi_scaled,
                        src_token=src_token, dst_token=dst_token,
                        amount_in=amount_in, rounds=refit_rounds,
                        gas_price_wei=gas_price_wei, max_legs=max_legs,
                        gas_table=gas_table, risk_table=risk_table,
                        revert_cost_bp=revert_cost_bp, leg_cost_bp=leg_cost_bp,
                    )

            # --- is a wider candidate being hidden by its own split? ---------
            # Ranking compares candidates on the split the model gave them and
            # only the winner is re-split, so a wide topology whose model split
            # is bad loses before it can be fixed.  See `split.scout`.
            if optimise_split and result.route is not None:
                with clock("scout"):
                    _scout_wider(result, pool_set, nodes, client,
                                 amount_in=amount_in,
                                 gas_price_wei=gas_price_wei,
                                 dst_wei_per_eth=dst_wei_per_eth,
                                 gas_table=gas_table, leg_cost_bp=leg_cost_bp)

            # --- §7: let the chain choose the split, not the model -----------
            # Last, so it runs on whatever the refit and scout left as winner,
            # and safe there because it only accepts a strict improvement.
            if optimise_split and result.route is not None:
                with clock("split"):
                    _optimise_split(result, nodes, client, amount_in=amount_in)

            # --- what the size itself cost ----------------------------------
            # On the route as finally split, so the figure describes what will
            # be executed.
            if measure_impact and result.route is not None and result.verified_out:
                with clock("impact"):
                    measured = price_impact(
                        client, result.route, amount_in=amount_in,
                        verified_out=result.verified_out,
                        fraction=impact_fraction,
                    )
                if measured is not None:
                    (result.price_impact_bp, result.impact_reference_in,
                     result.impact_reference_out) = measured
                    result.impact_fraction = impact_fraction

    # --- what each leg is really worth at the size it ended up with -------
    # Last, on the route as finally split, because both answers depend on the
    # size each leg carries.
    if result.route is not None:
        with clock("legs"):
            result.counters["legs_priced"] = price_legs(result.route, client)

    result.price_out_per_in = float(nu[src_node] / nu[dst_node]) if nu[dst_node] else 0.0
    return result


def _pricing_layers(legs) -> list[list[int]]:
    """Leg indices grouped so no leg in a group feeds another in it.

    Legs arrive topologically ordered, so a group closes as soon as one draws
    on a slot the group has just filled.  Depth is what costs round trips here,
    not leg count: a five-leg route with two branches is two batches.
    """
    layers: list[list[int]] = []
    current: list[int] = []
    filled: set[int] = set()
    for k, realized in enumerate(legs):
        if realized.leg.src_slot in filled:
            layers.append(current)
            current, filled = [], set()
        current.append(k)
        filled.add(realized.leg.dst_slot)
    if current:
        layers.append(current)
    return layers


def price_legs(route, client) -> int:
    """Ask each leg's own pool what it pays, at the size it will be handed.

    Everything else about a route is verified end to end: the total comes back
    from a chained walk and the per-leg figures are the quadratic's, which is
    the right division of labour for *choosing* a route.  It is the wrong one
    for bounding a leg -- a minimum rate set from a modelled rate is a promise
    about a number nothing checked, and measured on a live 13-leg route those
    numbers were out by up to 37.9 bp in both directions.

    **The size has to chain.**  Quoting every leg at its modelled input in one
    batch looks safe because the split is final, but the split fixes the
    *fractions*, not the amounts: a fraction is of the balance standing when the
    leg runs, and that balance is whatever the pools upstream really paid.  On a
    fraxtal route whose first leg was modelled 153 bp high, the last leg was
    priced 10.6% below the size it was handed -- and a leg trading bigger than
    it was measured pays more impact, so its bound tripped and the route
    reverted after quoting cleanly.

    So walk it the way the contract will: fractions of real balances, layer by
    layer.  One round trip per layer rather than one for the route, which for a
    branchy five-leg route is two.  Free either way on a pool with an exact
    model.
    """
    from .routecall import fractions

    if not route.legs:
        return 0
    priced = 0
    for _ in range(PRICING_ROUNDS):
        try:
            fracs = fractions(route)
        except Exception:
            # A route `fractions` refuses is one `encode_route` will refuse
            # too.  Pricing it at modelled sizes is no worse than not pricing.
            fracs = None
        priced = _price_once(route, client, fracs)
        try:
            if fracs is None or fractions(route) == fracs:
                break          # the split did not move, so neither will the sizes
        except Exception:
            break
    return priced


#: How many times to re-walk before accepting the sizes.  Two is enough on
#: every route measured; a third is cheap insurance and the cap stops a route
#: whose fractions oscillate from spinning.
#:
#: A second walk costs nothing on most routes because most never ask for one.
#: Only a split at an *intermediate* node moves the fractions: the source slot
#: holds `route.amount_in`, which pricing cannot change, so a route fanning out
#: of its input settles in one pass however many legs it has.  Measured on the
#: ethereum Router pairs, one of six walks twice -- a 14-leg CVX->WETH that
#: branches again after its first hop -- while an 8-leg USDT->USDC splitting
#: five ways off the input does not.
PRICING_ROUNDS = 3


def _advance(state, model, kind, i: int, j: int, dx: int):
    """`(dy, the pool this leg leaves)`, or None if it cannot be advanced.

    One state per pool, whichever kind of leg touches it: a swap advances the
    balances and a deposit advances the balances *and* the supply, so an
    element made of one of each has to hand the same pool between them.  The LP
    model carries both, so it is the state whenever the pool has one.
    """
    from dataclasses import replace as _replace

    lp = getattr(model, "lp", None)
    holds_supply = hasattr(state, "add_liquidity")
    if lp is not None and getattr(kind, "is_deposit", False):
        current = state if holds_supply else (
            _replace(lp, pool=state) if state is not None else lp)
        amounts = [0] * current.n
        if not 0 <= i < len(amounts):
            return None
        amounts[i] = dx
        return current.add_liquidity(amounts)

    swap = state.pool if holds_supply else state
    if swap is None:
        swap = lp.pool if lp is not None else model
    if not hasattr(swap, "exchange"):
        return None
    dy, after = swap.exchange(i, j, dx)
    return dy, (_replace(state, pool=after) if holds_supply else after)


def _merge_carried(wanted, ask, quotes, carried):
    """Put the carried answers back in leg order beside the probed ones."""
    from .quoter import Quote
    from .transport import Status

    answers = dict(zip((k for k, _, _ in ask), quotes, strict=True))
    for k, dy in carried.items():
        answers[k] = Quote(Status.VALUE, dy)
    return wanted, [answers[k] for k, _, _ in wanted]


def _price_once(route, client, fracs) -> int:
    """One walk at these fractions.  Returns how many legs the pools priced."""
    from .routecall import ONE

    legs = route.legs
    if fracs is None:
        fracs = [ONE] * len(legs)

    fee_at = getattr(client, "fee_at", None)
    fee_floor = getattr(client, "fee_floor", None)
    model_for = getattr(client, "model_for", None)
    # A pool a route touches twice -- an element fanning out of one coin -- is
    # moved by its own earlier leg, and a probe cannot see that.  Measured:
    # 0.236 bp on ethereum CRV->USDC, where both legs swap, and 115 bp on
    # gnosis USDC->EURe, where the second leg deposits into the pool the first
    # one just swapped through.
    repeated = {leg.target.lower() for leg in route.legs}
    repeated = {a for a in repeated
                if sum(1 for leg in route.legs if leg.target.lower() == a) > 1}
    evolved: dict[str, object] = {}
    balances: dict[int, int] = {route.legs[0].leg.src_slot: route.amount_in}
    priced = 0

    for layer in _pricing_layers(legs):
        sized: list[tuple] = []
        for k in layer:
            realized = legs[k]
            src = realized.leg.src_slot
            have = balances.get(src, 0)
            dx = have if fracs[k] >= ONE else have * fracs[k] // ONE
            # A route with no input, or a leg whose feeders all failed to
            # price, has nothing to chain from.  Fall back to the modelled
            # size, which is what this did everywhere before it chained.
            dx = dx or realized.amount_in
            balances[src] = max(0, have - dx)
            sized.append((k, realized, dx))

        wanted = [(k, rl, dx) for k, rl, dx in sized if dx > 0]
        # Legs on a pool this route reuses are priced from the carried model;
        # the rest go to the client as before.
        carried: dict[int, int] = {}
        if model_for is not None and repeated:
            for k, rl, dx in wanted:
                key = rl.target.lower()
                if key not in repeated:
                    continue
                model = model_for(rl.target, rl.kind, rl.leg.i, rl.leg.j)
                if model is None:
                    continue
                try:
                    got = _advance(evolved.get(key), model, rl.kind,
                                   rl.leg.i, rl.leg.j, dx)
                except Exception:
                    continue
                if got is None or got[0] <= 0:
                    continue
                carried[k], evolved[key] = got
        ask = [(k, rl, dx) for k, rl, dx in wanted if k not in carried]
        quotes = client.probe([
            Probe(rl.target, rl.kind, rl.leg.i, rl.leg.j, rl.leg.n, dx)
            for _, rl, dx in ask
        ]) if ask else []
        wanted, quotes = _merge_carried(wanted, ask, quotes, carried)

        for (_k, realized, dx), quote in zip(wanted, quotes, strict=True):
            if quote.ok and quote.value > 0:
                realized.verified_in = dx
                realized.verified_out = int(quote.value)
                priced += 1
            else:
                # Keep the chain going on the model's own ratio rather than
                # dropping the rest of the route to zero: a leg nothing could
                # price is one whose bound falls back to the model anyway.
                realized.verified_in = 0
                realized.verified_out = 0
            paid = realized.verified_out or (
                dx * realized.amount_out // realized.amount_in
                if realized.amount_in else 0)
            balances[realized.leg.dst_slot] = (
                balances.get(realized.leg.dst_slot, 0) + paid)

            if realized.is_conversion:
                continue
            where = (realized.target.lower(), realized.kind, realized.leg.i,
                     realized.leg.j)
            if fee_at is not None:
                fee = fee_at(*where, dx)
                if fee is not None:
                    realized.fee_frac = float(fee)
            if fee_floor is not None:
                least = fee_floor(*where)
                if least is not None:
                    realized.fee_floor = float(least)
    return priced


def scout_priority(route) -> float:
    """How promising this candidate is as a scout entrant, or 0 to skip it.

    Two things decide it.

    First, there has to be something to re-split: `split.scout` drops any plan
    whose legs form no split group, because there are no weights to move.
    Choosing entrants on anything else spends slots in the shared batch on plans
    it will throw away -- measured on crvUSD -> sDOLA at $2M, six entrants
    picked by leg count yielded **one** usable plan.

    Second, among those, how much the topology could carry if it *were* split
    properly.  That is `route_conductance`: the route read as a resistor network
    with `1/TVL` per pool, so series hops add resistance and parallel branches
    add conductance.  It rewards branching and depth together, which leg count
    only gestured at -- ten hops through dust scores below two through the
    deepest pools on the chain, and that is the right way round.
    """
    if route is None or not route.legs:
        return 0.0
    if not split_groups([rl.leg for rl in route.legs]):
        return 0.0
    return route_conductance(route)


#: How many of the widest candidates go into the shared batch.  They ride one
#: probe batch between them, so this is cheap to raise; three covered every
#: case measured.
SCOUT_CANDIDATES = 3
#: How far a scouted candidate must beat the incumbent before it is adopted.
#
# The comparison is made before either route has been split, and the incumbent
# gains from that too -- about 0.14 bp on the narrow topologies that usually hold
# the lead -- so adopting on a hair loses.  Half a basis point clears that with
# room and keeps the wins that matter.
SCOUT_MARGIN_BP = 0.5


def _scout_wider(
    result: RouteResult, pool_set: CandidateSet, nodes: NodeMap,
    client: QuoterClient, *, amount_in: int,
    gas_price_wei: int = 0, dst_wei_per_eth: float = 0.0,
    gas_table: GasTable | None = None, leg_cost_bp: float = LEG_COST_BP,
) -> None:
    """Re-split the widest candidates against one shared probe batch, and adopt
    one only if the chain agrees it is better.

    `scout` returns a *predicted* output; the predictions only order the
    candidates, and the best is then quoted for real alongside the incumbent.
    """
    winner, route = result.winner, result.route
    if winner is None or route is None or pool_set is None:
        return
    # Only topologies with more capacity than the one we hold.  That is the
    # same statement the leg-count gate was reaching for -- a candidate whose
    # own split is hiding it -- but made in conductance, where a deep two-way
    # branch outranks a long thin chain instead of losing to it.
    held = route_conductance(route)
    wider = sorted(
        (c for c in pool_set.candidates
         if c.ok and c.route and c is not winner
         and scout_priority(c.route) > held),
        key=lambda c: -scout_priority(c.route),
    )[:SCOUT_CANDIDATES]
    if not wider:
        return

    # The incumbent goes into the batch too, at index 0.  Comparing a tuned
    # challenger against an untuned incumbent is the same mistake the ranking
    # makes one level up; its arcs are in the shared sample already, so tuning
    # it costs nothing.
    entrants = [winner, *wider]
    plans = [
        ([rl.leg for rl in c.route.legs], c.route.dst_slot,
         [rl.amount_in for rl in c.route.legs],
         [rl.amount_out for rl in c.route.legs])
        for c in entrants
    ]
    found = scout_splits(plans, client, amount_in=amount_in)
    result.counters["scout_candidates"] = len(plans)
    if not found:
        return

    incumbent = float(result.verified_out or 0)
    tuned_incumbent = next((f for f in found if f.index == 0), None)
    challenger = next((f for f in found if f.index != 0), None)
    if challenger is None:
        return
    # A topology change has to clear a margin; re-splitting what we already
    # hold does not, since it cannot change what executes beyond its weights.
    floor = incumbent * (1.0 + SCOUT_MARGIN_BP / 1e4)
    proposals: list[tuple[ScoutSplits, float]] = []
    if tuned_incumbent is not None and tuned_incumbent.predicted > incumbent:
        proposals.append((tuned_incumbent, incumbent))
    if challenger.predicted > floor:
        proposals.append((challenger, floor))
    if not proposals:
        return

    quoted = client.quote_routes(
        [found.legs for found, _ in proposals],
        [amount_in] * len(proposals),
        [entrants[found.index].route.dst_slot for found, _ in proposals],
    )
    result.counters["scout_predicted_bp"] = round(
        (challenger.predicted / max(incumbent, 1.0) - 1) * 1e4, 2)

    # Net of what the route costs to execute, exactly as `verify.score` ranks.
    # Comparing gross here undid the gas-aware selection made moments earlier:
    # at 200 gwei it adopted a 25-leg route over a 1-leg one for 2 bp of gross
    # gain, $2 bought for $855.  Same failure the refit had (`_refit_winner`).
    def net(value: float, index: int, legs) -> float:
        # `scout_splits` only reweights an entrant's legs, so the two lists are
        # the same legs in the same order and `strict=True` is a real check.
        realized = entrants[index].route.legs
        return value - shape_cost(
            legs, [rl.is_conversion for rl in realized],
            value=value, leg_cost_bp=leg_cost_bp,
            per_gas=value_per_gas(gas_price_wei, dst_wei_per_eth),
            table=gas_table)

    incumbent_legs = [rl.leg for rl in result.route.legs]
    best_value = net(incumbent, 0, incumbent_legs) if entrants else incumbent
    best_found, best_gross = None, incumbent
    for (found, bar), value in zip(proposals, quoted, strict=True):
        value = float(value)
        if value <= bar:
            continue  # still has to clear the topology margin, on gross
        scored = net(value, found.index, found.legs)
        if scored > best_value:
            best_value, best_found, best_gross = scored, found, value
    if best_found is None:
        return

    candidate = entrants[best_found.index]
    best_value = best_gross
    for realized, leg in zip(candidate.route.legs, best_found.legs, strict=True):
        realized.leg = leg
    candidate.route.modelled_out = _forward_simulate(candidate.route, nodes)
    candidate.verified_out = int(best_value)
    # The split pass runs on this route next and would sample the very arcs
    # the scout just sampled.  Hand them over: same block, same ladders, and
    # they are re-checked against the chain there anyway.
    result.counters["scout_curves"] = len(best_found.curves)
    result.scout_curves = best_found.curves
    result.counters["scout_gain_bp"] = round(
        (best_value / max(incumbent, 1.0) - 1) * 1e4, 2)
    result.route = candidate.route
    result.verified_out = int(best_value)
    result.winner = candidate


def _optimise_split(
    result: RouteResult, nodes: NodeMap, client: QuoterClient, *, amount_in: int
) -> None:
    """Re-split the finished route against the quoter, in place."""
    route = result.route
    if route is None:
        return
    legs = [rl.leg for rl in route.legs]
    thetas = [rl.theta for rl in route.legs if not rl.is_conversion]
    reason = should_optimise(
        legs, thetas,
        modelled_out=route.modelled_out, verified_out=result.verified_out or 0,
    )
    if not reason:
        return
    tuned, report = optimise_splits(
        legs, client, amount_in=amount_in, dst_slot=route.dst_slot,
        baseline=result.verified_out or 0,
        nominal_in=[rl.amount_in for rl in route.legs],
        nominal_out=[rl.amount_out for rl in route.legs],
        curves=result.scout_curves or None,
    )
    result.counters["split_reused_curves"] = int(report.reused)
    result.counters["split_calls"] = report.calls
    result.counters["split_evaluations"] = report.evaluations
    result.counters["split_probes"] = report.probes
    result.counters["split_local"] = report.local
    result.counters["split_mode"] = report.mode
    result.counters["split_refined"] = report.refined
    if report.polish_calls:
        result.counters["split_polish_calls"] = report.polish_calls
        result.counters["split_polish_bp"] = round(report.polish_bp, 3)
    if report.mode == "curves":
        result.counters["split_check_bp"] = round(report.check_bp, 3)
    if report.predicted:
        result.counters["split_curve_error_bp"] = round(report.curve_error_bp, 3)
    if not report.improved:
        return
    for realized, leg in zip(route.legs, tuned, strict=True):
        realized.leg = leg
    # The modelled per-leg amounts described the old split; re-walk so the
    # diagram and the JSON report the flow that is actually being quoted.
    route.modelled_out = _forward_simulate(route, nodes)
    result.verified_out = report.after
    if result.winner is not None:
        result.winner.route = route
        result.winner.verified_out = report.after
    result.counters["split_gain_bp"] = round(report.gain_bp, 2)


#: **The model-free candidates carry `psi = 1.0` per arc, and that is fine.**
#:
#: `direct_candidates` and `two_step_candidates` are built from probes rather
#: than a solve, so they have no flow of their own.  The placeholder makes the
#: numbers look alarming -- a 10,000 USDT request measures 1.25 USDT of outgoing
#: flow at the source, 7,973x out -- and it costs nothing, because each of these
#: candidates is a *single path*, one pool per hop.  A one-arc group's only
#: member is its last, so every leg is `bps = 0` and sweeps whatever the slot
#: holds; the amounts chain from the real input and `psi` is never read for
#: anything but shares that do not exist here.
#:
#: Supplying the real flow was tried and reverted: it makes USDT -> ZCHF fail
#: with "src not connected to dst through the active set" at a block where it
#: otherwise routes.  Why a model-free candidate's `psi` reaches the solver's
#: reachability check at all is the open question, and worth understanding
#: before touching this -- but the placeholder is not the bug it looks like.


def direct_candidates(
    pools: list[PoolSpec],
    nodes: NodeMap,
    nu: np.ndarray,
    src_token: str,
    dst_token: str,
    amount_in: int,
) -> tuple[list[Candidate], list[PoolArc]]:
    """One-leg candidates through every pool holding both tokens.

    The safety floor: they depend on no part of the model -- not the probe grid,
    the calibration, the price fit or the solver -- so a dropped arc cannot lose
    sight of an obvious direct swap.  A router must never be beaten by a swap
    anyone could find by inspection.
    """
    src_node, dst_node = nodes.node(src_token), nodes.node(dst_token)
    out: list[Candidate] = []
    made: list[PoolArc] = []
    for pool in pools:
        kind = pool.swap_kind
        if kind is None:
            continue
        index = {c.address.lower(): k for k, c in enumerate(pool.coins)}
        for token_in, i in index.items():
            if nodes.node(token_in) != src_node:
                continue
            for token_out, j in index.items():
                if i == j or nodes.node(token_out) != dst_node:
                    continue
                arc = PoolArc(
                    id=f"direct:{pool.address.lower()}:{i}>{j}",
                    pool=pool.address, kind=kind, i=i, j=j, n_coins=pool.n_coins,
                    token_in=token_in, token_out=token_out,
                    tau=src_node, sigma=dst_node,
                    a=float(nu[src_node] / nu[dst_node]) if nu[dst_node] else 1.0,
                    B=0.0, reserve_in=pool.balances[i] if i < len(pool.balances) else 0,
                    decimals_in=pool.coins[i].decimals,
                    decimals_out=pool.coins[j].decimals,
                    tvl_usd=pool.tvl_usd, note=pool.name,
                )
                made.append(arc)
                out.append(
                    Candidate(
                        label=f"direct {pool.name[:22]}",
                        psi=np.array([1.0]), certificate=False,
                        kind="direct", reason="DIRECT", n_arcs=1,
                    )
                )
    return out, made


def two_step_candidates(
    pools: list[PoolSpec],
    nodes: NodeMap,
    nu: np.ndarray,
    client: QuoterClient,
    src_token: str,
    dst_token: str,
    amount_in: int,
    *,
    limit: int = 6,
) -> tuple[list[Candidate], list[list[PoolArc]]]:
    """Model-free `src -> M -> dst` chains, one pool per hop.

    The two-hop half of the safety floor, model-free for the same reason: the
    quadratic element law degrades badly once a trade is large relative to the
    pools.  Two batched rounds pick *which* chains to offer; the quoter decides
    the amounts, so the ranking here only has to be roughly right.
    """
    src_node, dst_node = nodes.node(src_token), nodes.node(dst_token)

    # Which pools hold which node, and at which coin indices, resolved once.
    # Round B otherwise walks the whole universe for each intermediate token it
    # considers -- 11,610 pool scans for a question that does not depend on the
    # token being asked about.
    tradeable = [pool for pool in pools if pool.swap_kind is not None]
    slots_of: list[dict[int, list[int]]] = []
    holders: dict[int, list[int]] = {}
    for index, pool in enumerate(tradeable):
        per_node: dict[int, list[int]] = {}
        for k, coin in enumerate(pool.coins):
            if nodes.has(coin.address):
                per_node.setdefault(nodes.node(coin.address), []).append(k)
        slots_of.append(per_node)
        for node_id in per_node:
            holders.setdefault(node_id, []).append(index)

    # Which middles can even reach `dst`?  Pure indexing, no probes -- and it
    # has to happen *before* the ranking below, not after.
    #
    # Round A used to quote every token one hop from the source and keep the
    # best `3 * limit` of them by output.  Two things went wrong together.  The
    # output is `to_canonical_wei`, a count of tokens rather than a value, so a
    # token that trades at a fraction of a cent sorts above every stable simply
    # by being numerous -- measured on USDC -> sUSDe at $1,000, the top of the
    # list was CXD at 2,513,355 units, then HLX, FIDU and STG.  And the cut was
    # taken without asking where any of them could go next.  Of 52 middles
    # quoted, exactly three could reach sUSDe -- DAI, reUSD and crvUSD -- and
    # all three were cut, so the two-hop floor came back empty for a pair with
    # an obvious two-hop route.
    #
    # Intersecting first fixes the ranking by making it almost irrelevant: what
    # survives is measured in hundreds, not tens of thousands, so the cut rarely
    # binds and every chain that reaches `dst` gets its round-B quote.  It is
    # also strictly cheaper -- 66 probes became a handful on that pair.
    reaching = {
        node_id for node_id in holders
        if node_id not in (src_node, dst_node)
        and any(dst_node in slots_of[index] for index in holders[node_id])
    }
    if not reaching:
        return [], []

    # --- round A: src -> M ------------------------------------------------
    probes: list[Probe] = []
    first: list[tuple[PoolSpec, int, int, int]] = []
    for index in holders.get(src_node, ()):
        pool = tradeable[index]
        for i in slots_of[index][src_node]:
            for j, coin in enumerate(pool.coins):
                if j == i or not nodes.has(coin.address):
                    continue
                middle = nodes.node(coin.address)
                if middle not in reaching:
                    continue
                probes.append(
                    Probe(pool.address, pool.swap_kind, i, j, pool.n_coins, amount_in)
                )
                first.append((pool, i, j, middle))
    if not probes:
        return [], []

    best_first: dict[int, tuple[int, PoolSpec, int, int]] = {}
    for quote, (pool, i, j, middle) in zip(client.probe(probes), first, strict=True):
        if not quote.ok or quote.value <= 0:
            continue
        canonical = nodes.to_canonical_wei(pool.coins[j].address, quote.value)
        if canonical > best_first.get(middle, (0,))[0]:
            best_first[middle] = (canonical, pool, i, j)
    if not best_first:
        return [], []

    def worth(item) -> float:
        """What a hop into this middle is worth, rather than how many tokens it made.

        Comparing `to_canonical_wei` across middles compares token counts, and a
        token trading at a fraction of a cent wins every such comparison by
        arithmetic alone -- CXD at 2,513,355 units above crvUSD at 1,000, on
        pools of $30k and $400M respectively.  `nu` is the reference price fit
        and exists precisely to make quantities in different tokens comparable;
        anything that ranks across tokens has to go through it.

        The reachability filter above already means this rarely decides
        anything, since what reaches `dst` is usually fewer than the cut keeps.
        It is here because ranking by units is wrong whether or not it binds.
        """
        middle, (canonical, *_rest) = item
        units = canonical / 10 ** nodes.decimals(nodes.canonical_of[middle])
        return units * float(nu[middle]) if middle < len(nu) else units

    ranked = sorted(best_first.items(), key=lambda kv: -worth(kv))[: 3 * limit]

    # --- round B: M -> dst ------------------------------------------------
    probes = []
    second: list[tuple[int, PoolSpec, int, int]] = []
    for middle, (canonical, _p1, _i1, _j1) in ranked:
        for index in holders.get(middle, ()):
            pool = tradeable[index]
            for i in slots_of[index][middle]:
                start = nodes.from_canonical_wei(pool.coins[i].address, canonical)
                if start <= 0:
                    continue
                for j in slots_of[index].get(dst_node, ()):
                    if i == j:
                        continue
                    probes.append(
                        Probe(pool.address, pool.swap_kind, i, j, pool.n_coins, start)
                    )
                    second.append((middle, pool, i, j))
    if not probes:
        return [], []

    best_chain: dict[int, tuple[int, PoolSpec, int, int]] = {}
    for quote, (middle, pool, i, j) in zip(client.probe(probes), second, strict=True):
        if not quote.ok or quote.value <= 0:
            continue
        value = nodes.to_canonical_wei(pool.coins[j].address, quote.value)
        if value > best_chain.get(middle, (0,))[0]:
            best_chain[middle] = (value, pool, i, j)

    out: list[Candidate] = []
    made: list[list[PoolArc]] = []
    for middle, (_value, pool2, i2, j2) in sorted(
        best_chain.items(), key=lambda kv: -kv[1][0]
    )[:limit]:
        _canonical, pool1, i1, j1 = best_first[middle]
        arcs = [
            _synthetic_arc(pool1, i1, j1, nodes, nu, src_node, middle),
            _synthetic_arc(pool2, i2, j2, nodes, nu, middle, dst_node),
        ]
        out.append(
            Candidate(
                label=f"2-hop via {nodes.symbol(pool1.coins[j1].address)}",
                psi=np.array([1.0, 1.0]), certificate=False,
                kind="direct", reason="TWO_STEP", n_arcs=2,
            )
        )
        made.append(arcs)
    return out, made


def _synthetic_arc(
    pool: PoolSpec, i: int, j: int, nodes: NodeMap, nu: np.ndarray, tau: int, sigma: int
) -> PoolArc:
    """An arc built for realisation only -- never calibrated, never solved."""
    return PoolArc(
        id=f"naive:{pool.address.lower()}:{i}>{j}",
        pool=pool.address, kind=pool.swap_kind, i=i, j=j, n_coins=pool.n_coins,
        token_in=pool.coins[i].address, token_out=pool.coins[j].address,
        tau=tau, sigma=sigma,
        a=float(nu[tau] / nu[sigma]) if nu[sigma] else 1.0, B=0.0,
        reserve_in=pool.balances[i] if i < len(pool.balances) else 0,
        decimals_in=pool.coins[i].decimals, decimals_out=pool.coins[j].decimals,
        tvl_usd=pool.tvl_usd, note=pool.name,
    )


def _refit_winner(
    result: RouteResult,
    pool_set: CandidateSet,
    winner: Candidate,
    g: ArcArrays,
    arcs: list[PoolArc],
    nu: np.ndarray,
    nodes: NodeMap,
    client: QuoterClient,
    *,
    src_node: int,
    dst_node: int,
    Psi: float,
    src_token: str,
    dst_token: str,
    amount_in: int,
    rounds: int,
    gas_price_wei: int,
    max_legs: int = MAX_LEGS,
    gas_table: GasTable | None = None,
    risk_table: RiskTable | None = None,
    revert_cost_bp: float = REVERT_COST_BP,
    leg_cost_bp: float = LEG_COST_BP,
) -> None:
    """§8 -- refit the winner, re-solve, and let the chain adjudicate again.

    The refitted route is *offered*, never imposed: it goes back through the
    quoter as an extra candidate, so it only wins if it quotes higher.
    """
    from .verify import realize_candidates
    from .verify import verify as verify_candidates

    forbidden = np.ones(g.m, bool)
    forbidden[np.flatnonzero(winner.psi > 0)] = False

    def solve_fn(graph_arrays, A0):
        return active_set_solve(
            graph_arrays, src_node, dst_node, Psi, A0=A0, forbidden=forbidden
        )

    report = refit(
        g, arcs, winner.psi / g.g_scale, nu, client, solve_fn, Psi,
        rate_in=lambda arc: nodes.rate(arc.token_in),
        rate_out=lambda arc: nodes.rate(arc.token_out),
        rounds=rounds,
    )
    result.refit_report = report
    result.counters["refit_rounds"] = len(report.rounds)
    if report.rounds:
        result.counters["refit_quoted"] = report.rounds[-1].quoted
        if report.rounds[-1].reflagged:
            result.warnings.append(
                f"{report.rounds[-1].reflagged} arc(s) showed increasing returns at "
                "their realised size and were clamped (§11.2)"
            )
    if report.psi is None or not report.changed:
        return
    if not report.converged:
        result.warnings.append(
            f"refit did not converge in {len(report.rounds)} rounds "
            f"(max |d psi| / Psi = {report.rounds[-1].max_delta_psi:.2e})"
        )

    refitted = Candidate(
        label="refit at realised size",
        psi=report.psi * g.g_scale,
        certificate=False,
        kind="refit",
        reason="REFIT",
        n_arcs=int(np.count_nonzero(report.psi > 0)),
    )
    trial = CandidateSet([refitted])
    realize_candidates(
        trial, arcs, nu, nodes,
        src_token=src_token, dst_token=dst_token, amount_in=amount_in,
        max_legs=max_legs,
    )
    verify_candidates(trial, client, amount_in=amount_in)
    if not refitted.ok:
        return
    refitted.rank = None  # ranked for real against the whole set below

    pool_set.candidates.append(refitted)
    # `dst_wei_per_eth` is what turns gas into output-token units; without it
    # the gas term is silently skipped and this re-ranking undoes the gas-aware
    # selection made moments earlier.
    verify_candidates(
        pool_set, client, amount_in=amount_in, gas_price_wei=gas_price_wei,
        dst_wei_per_eth=_dst_per_eth(nodes, nu, dst_token),
        gas_table=gas_table, risk_table=risk_table,
                        revert_cost_bp=revert_cost_bp, leg_cost_bp=leg_cost_bp,
    )
    best = pool_set.best
    if best is not None:
        result.route = best.route
        result.verified_out = best.verified_out
        result.winner = best


def _gas_cost(
    nodes: NodeMap, nu: np.ndarray, dst_token: str, gas_price_wei: int, g_scale: float
) -> float:
    """One leg's gas, in the solver's scaled value units.  0 disables it."""
    if gas_price_wei <= 0 or g_scale <= 0:
        return 0.0
    per_eth = _dst_per_eth(nodes, nu, dst_token) / 10 ** nodes.decimals(dst_token)
    return min_useful_flow(gas_price_wei, per_eth) / g_scale


def _dst_per_eth(nodes: NodeMap, nu: np.ndarray, dst_token: str) -> float:
    """Output-token wei per 1 ETH, for costing gas.  0 when ETH is unpriced."""
    for candidate in ("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",):
        if not nodes.has(candidate):
            continue
        weth_value = float(nu[nodes.node(candidate)])
        dst_value = float(nu[nodes.node(dst_token)])
        if weth_value <= 0 or dst_value <= 0:
            return 0.0
        return weth_value / dst_value * 10 ** nodes.decimals(dst_token)
    return 0.0


def _assemble(
    arcs: list[PoolArc],
    nu: np.ndarray,
    Psi: float,
    nodes: NodeMap,
    src_node: int,
    dst_node: int,
    result: RouteResult,
):
    """Build the solver arrays from the current calibration.

    Called twice, coarse then refined, because `build` drops dust and can merge
    duplicates -- the arc list has to be re-aligned to whatever survived.
    """
    bottomless = _clamp_unphysical_depth(arcs, nu, nodes)
    if bottomless:
        result.counters["arcs_clamped_as_bottomless"] = bottomless

    # `cap` is a bound on *value* flow, so convert from canonical token units.
    caps = np.array(
        [a.cap if not math.isfinite(a.cap) else float(nu[a.tau] * a.cap) for a in arcs]
    )
    g = build(
        np.array([a.tau for a in arcs], dtype=np.int64),
        np.array([a.sigma for a in arcs], dtype=np.int64),
        np.array([a.a for a in arcs]),
        np.array([a.B for a in arcs]),
        nu, Psi,
        cap=caps,
        flagged=np.array([a.convex_flag for a in arcs]),
        clamped=np.array([a.clamped for a in arcs]),
        n_nodes=nodes.n_nodes,
        merge_duplicates=False,
        require=(src_node, dst_node),
    )
    arcs = [arcs[group[0]] for group in g.sources]
    result.counters["arcs_dropped_dust"] = sum(
        1 for reason in g.dropped.values() if reason == "DUST"
    )
    for k, arc in enumerate(arcs):
        arc.G, arc.eps = float(g.G[k]), float(g.eps[k])
    if g.ill_conditioned:
        result.counters["condition"] = int(g.ill_conditioned)
        result.warnings.append(
            f"conductance spread is {g.ill_conditioned:.2e}, past §12.4's "
            f"{MAX_CONDITION:.0e} bound: the dust floor was backed off to keep "
            "the pair connected at all. The route is still checked on-chain, "
            "but treat the modelled split as approximate"
        )
    _warn_pair_drops(arcs, result)
    return arcs, g


def _recalibrate(arcs: list[PoolArc], ladders, nodes: NodeMap) -> int:
    """Re-fit the arcs whose ladders just gained points."""
    by_id = {lad.arc.id: lad for lad in ladders}
    changed = 0
    for arc in arcs:
        ladder = by_id.get(arc.id)
        if ladder is None or len(ladder.deltas) < 3:
            continue
        deltas, quotes = ladder.as_float()
        try:
            fit = calibrate(deltas, quotes,
                            quantum=_quantum(ladder.arc.decimals_out))
        except CalibrationError:
            continue
        a, B = rescale(fit.a, fit.B, nodes.rate(arc.token_in), nodes.rate(arc.token_out))
        arc.a, arc.B = a, B
        # **A cap only ever tightens.**  A fit can discover a wall the ladder
        # walked into; it cannot know about a capacity the curve does not show.
        # `maxDeposit` is exactly that: USD3 answers `previewDeposit` linearly
        # at every probe size and refuses the deposit past 1,085 USDC, so the
        # ladder sees no wall, `fit.cap` comes back infinite, and assigning it
        # here erased the limit `wrappers.py` had read off the chain.  The route
        # then sent 9,985 USDC into it and reverted.  Same rule as the depth
        # clamp below, which has always used `min`.
        fitted = (fit.cap * nodes.rate(arc.token_in)
                  if math.isfinite(fit.cap) else math.inf)
        arc.cap = min(arc.cap, fitted)
        arc.clamped, arc.convex_flag = fit.clamped, fit.convex_flag
        arc.flag_reason, arc.drift, arc.eta = fit.flag_reason, fit.drift, fit.eta
        arc.calib_delta = fit.calib_delta
        changed += 1
    return changed


def _kcl_tolerance(Psi: float, g_scale: float) -> float:
    """How much KCL slop is floating-point noise rather than a bug.

    The solve runs in units scaled by `g_scale`, so a tolerance expressed purely
    as a fraction of `Psi` tightens without limit as the trade shrinks and
    rejects small trades outright.  Allowing both terms stays far tighter than
    the failure this catches, since conjured flow is `O(Psi)`.
    """
    return KCL_RELATIVE + KCL_ABSOLUTE * g_scale / max(Psi, 1e-30)


def _achievable_kcl(g: ArcArrays, active: np.ndarray, dst: int) -> float:
    """The KCL residual a backward-stable solve could deliver on this graph.

    `k * eps` floors any residual computed from a solve of condition number `k`.
    Returns 0 when there is nothing to condition, leaving the caller's flat
    tolerance in charge.  The safety factor covers the gap to the error actually
    realised, 0.04x to 33x, and even at `k = 1e12` stays two orders below
    conjured flow.
    """
    from .graph import component_of, laplacian

    # The *active set*, not the arcs that ended up carrying flow: the solve
    # factorises the Laplacian of everything in `A`, and that is the system
    # whose conditioning limited `u`.
    live = np.flatnonzero(active)
    if live.size == 0:
        return 0.0
    comp = component_of(dst, g.tau[live], g.sig[live], g.n_nodes)
    keep = np.flatnonzero(comp)
    keep = keep[keep != dst]
    if keep.size == 0:
        return 0.0
    L = laplacian(g.tau[live], g.sig[live], g.G[live], g.n_nodes, keep)
    try:
        kappa = float(np.linalg.cond(L))
    except np.linalg.LinAlgError:
        return 0.0
    if not math.isfinite(kappa):
        return 0.0
    return KCL_CONDITION_SAFETY * kappa * EPS


def _kcl_residual(
    g: ArcArrays, psi: np.ndarray, src: int, dst: int, Psi: float
) -> float:
    """`||B^T psi - s_hat||_inf / Psi` -- Kirchhoff's current law (§12.4)."""
    return _kcl_detail(g, psi, src, dst, Psi)[0]


def _kcl_detail(
    g: ArcArrays, psi: np.ndarray, src: int, dst: int, Psi: float
) -> tuple[float, int, int, int]:
    """The residual, and *where* it is -- worst node, and its live arc counts.

    The node is what makes a refusal diagnosable: flow leaving a node with none
    arriving is conjured flow, a different bug from a conditioning failure.
    """
    net = np.zeros(g.n_nodes)
    np.add.at(net, g.tau, psi)
    np.subtract.at(net, g.sig, psi)
    want = np.zeros(g.n_nodes)
    want[src] += Psi
    want[dst] -= Psi
    if Psi <= 0:
        return 0.0, -1, 0, 0
    err = np.abs(net - want) / Psi
    worst = int(np.argmax(err))
    live = psi > 0
    # `tau` is an arc's origin and `sig` its head -- the orientation
    # `_find_cycle` walks, and the one that makes `want[src] = +Psi` come out
    # right.  Counting `tau == worst` therefore counts what *leaves* the node.
    n_out = int(np.count_nonzero((g.tau == worst) & live))
    n_in = int(np.count_nonzero((g.sig == worst) & live))
    return float(err[worst]), worst, n_in, n_out


def _prune_dead_end_nodes(
    arcs: list[PoolArc], src_node: int, dst_node: int, result: RouteResult
) -> list[PoolArc]:
    """Drop arcs into nodes no route can pass *through*.

    A node that is neither endpoint has to be entered through one pool and left
    through another.  Decision 3 gives a route at most one arc per pool, and for
    a two-coin pool the only other coin is the one the flow just arrived from,
    so a second arc of that pool is where it came from rather than onward.  A
    node touched by exactly one pool can therefore only ever be an endpoint --
    not "is unlikely to help", cannot appear.

    The same holds where a single pool has three coins and could technically
    serve both hops: `A -> v -> B` inside one pool is dominated by `A -> B`
    inside it, since the pool prices the pair directly.

    This is what keeps the long tail of single-pool tokens out of the search on
    structure rather than by a list of names.  Measured on mainnet, HLX, CXD,
    FIDU and STG each sit in exactly one pool, and the two-hop floor was ranking
    them above crvUSD because their tokens are numerous -- the ranking was fixed
    separately, but they should never have been on the ballot to rank.

    Iterated, because removing a node can leave its neighbour with one pool.
    Endpoints are never pruned: quoting `HLX -> USDC` is a fair question and its
    single pool is the answer.
    """
    live = list(arcs)
    ends = {src_node, dst_node}
    for _ in range(len(live) + 1):
        touching: dict[int, set[str]] = {}
        for arc in live:
            pool = arc.pool.lower()
            touching.setdefault(arc.tau, set()).add(pool)
            touching.setdefault(arc.sigma, set()).add(pool)
        dead = {node for node, pools in touching.items()
                if node not in ends and len(pools) < 2}
        if not dead:
            break
        live = [a for a in live if a.tau not in dead and a.sigma not in dead]
    result.counters["arcs_dead_end"] = len(arcs) - len(live)
    return live


def _restrict_to_component(
    arcs: list[PoolArc], dst_node: int, n_nodes: int, result: RouteResult
) -> list[PoolArc]:
    from .graph import component_of

    tau = np.array([a.tau for a in arcs], dtype=np.int64)
    sig = np.array([a.sigma for a in arcs], dtype=np.int64)
    reachable = component_of(dst_node, tau, sig, n_nodes)
    keep = [a for a in arcs if reachable[a.tau] and reachable[a.sigma]]
    result.counters["arcs_unreachable"] = len(arcs) - len(keep)
    result.counters["nodes_reachable"] = int(reachable.sum())
    return keep


# A pool cannot be meaningfully deeper than this multiple of its own input
# reserve.  For constant product `G = nu*y0/2` exactly; a stableswap at the peg
# is far deeper, but not by twelve orders of magnitude.
DEPTH_LIMIT = 1e4


def _clamp_unphysical_depth(arcs: list[PoolArc], nu: np.ndarray, nodes: NodeMap) -> int:
    """Treat immeasurably small curvature as the zero-curvature limit.

    A `B` implying a conductance far beyond the pool's own reserves is not a very
    deep pool but a curvature below the quotes' integer noise floor.  Clamping to
    `B = 0` with a cap is the admissible limit (§2.3) and keeps the arc
    bottomless only up to the size actually probed.
    """
    clamped = 0
    for arc in arcs:
        if arc.B <= 0 or arc.reserve_in <= 0:
            continue
        reserve_canonical = (
            arc.reserve_in / 10**arc.decimals_in * nodes.rate(arc.token_in)
        )
        limit = float(nu[arc.tau]) * reserve_canonical * DEPTH_LIMIT
        conductance = float(nu[arc.tau]) * arc.a / arc.B
        if limit > 0 and conductance > limit:
            arc.B = 0.0
            arc.clamped = True
            arc.convex_flag = True
            probed = arc.calib_delta if arc.calib_delta > 0 else reserve_canonical
            arc.cap = min(arc.cap, probed)
            clamped += 1
    return clamped


def _align(planned, refs, meta):
    """`plan_grid` may skip arcs, so re-align the metadata to what it kept."""
    by_id = {ref.id: m for ref, m in zip(refs, meta, strict=True)}
    return [by_id[ref.id] for ref in planned]


def _warn_pair_drops(arcs: list[PoolArc], result: RouteResult) -> None:
    """§2.6: `eps_f + eps_r <= 0` means `nu` is inconsistent with that pool.

    It manufactures a two-arc negative cycle that does not exist.
    """
    forward: dict[tuple[str, int, int], PoolArc] = {}
    for arc in arcs:
        forward[(arc.pool.lower(), arc.i, arc.j)] = arc
    pairs = []
    for (pool, i, j), arc in forward.items():
        reverse = forward.get((pool, j, i))
        if reverse is not None and i < j:
            pairs.append((arc, reverse))
    if not pairs:
        return
    violations = check_pair_drops(
        np.array([f.eps for f, _ in pairs]), np.array([r.eps for _, r in pairs])
    )
    result.counters["eps_pair_violations"] = int(violations.size)
    if violations.size:
        result.warnings.append(
            f"{violations.size} pool(s) have eps_f + eps_r <= 0: the reference price "
            "is inconsistent with them (spurious negative 2-cycle, §2.6)"
        )


class _Clock:
    def __init__(self, sink: dict[str, float]) -> None:
        self.sink = sink

    def __call__(self, name: str):
        return _Span(self.sink, name)


class _Span:
    def __init__(self, sink: dict[str, float], name: str) -> None:
        self.sink, self.name = sink, name

    def __enter__(self):
        self.started = time.monotonic()
        return self

    def __exit__(self, *exc):
        # Accumulate.  A stage that runs twice -- `seed` for the scout and the
        # solve, `refit` once per round -- otherwise reports only its last visit.
        self.sink[self.name] = (
            self.sink.get(self.name, 0.0) + (time.monotonic() - self.started) * 1000
        )
        return False
