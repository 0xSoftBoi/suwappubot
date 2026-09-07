"""Turn a solved value flow into an ordered list of executable legs (§5.6).

Two things make this more than bookkeeping.

**Do not undo the netting.**  The solution is an *edge* flow, so a pool that two
decomposed paths both traverse already carries the net amount.  Re-expanding
into paths and quoting each separately double-counts that pool's impact, which
is a common source of failed quotes.  So legs are emitted per arc, in
topological order, and paths are reconstructed afterwards for display only.

**Merged nodes need conversion legs.**  Routing treats ETH and WETH as one
node, but a pool holds one or the other.  Each node uses its canonical token as
a hub: arriving non-canonical tokens convert in, departing ones convert out.
On a node whose arcs all use the canonical token -- the common case -- no
conversion is emitted at all.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

import numpy as np

from . import accel as _accel
from .multiport import MultiPortError, element_of
from .nodes import NodeMap
from .types import ArcKind, Leg, PoolArc

BPS = 10_000


#: Opt-in on the same switch as the rest of the port.
_ACCEL_ON = os.environ.get("EROUTER_ACCEL", "") == "1"


class RealizationError(RuntimeError):
    pass


@dataclass(slots=True)
class RealizedLeg:
    leg: Leg
    kind: ArcKind
    target: str
    token_in: str
    token_out: str
    amount_in: int  # raw wei, modelled
    amount_out: int  # raw wei, modelled
    share_of_node: float = 1.0
    arc_id: str | None = None
    pool_name: str = ""
    eps: float = 0.0
    impact_frac: float = 0.0
    theta: float = 0.0
    psi: float = 0.0
    #: The arc's own input reserve, kept so `_forward_simulate` can refresh
    #: `theta` after it rescales the amounts.  Without it `theta` describes the
    #: flow the arc was realised at rather than the one being quoted.
    reserve_in: int = 0
    #: The pool's TVL, for `route_conductance`.  Deliberately the pool's own
    #: size rather than anything fitted: it is what lets a topology be weighed
    #: without going through the split the model happened to give it.
    tvl_usd: float = 0.0
    #: The size `verified_out` was measured at -- the leg's real input, which
    #: is a fraction of whatever its feeders actually paid rather than of what
    #: they were modelled to pay.  A rate divides one by the other, so they
    #: have to come from the same quote.  Zero where nothing priced it.
    verified_in: int = 0
    #: What this leg's own pool says it pays at this size, at the pinned block.
    #: `amount_out` is the quadratic's answer and is a *choice*, accurate enough
    #: to pick pools and split flow and no better -- measured against the exact
    #: models on a live 13-leg route, its legs were out by up to 37.9 bp, in
    #: both directions.  Anything that has to be true of one leg rather than of
    #: the route reads this instead.  Zero where nothing priced it.
    verified_out: int = 0
    #: The least this leg's pool can charge, which is what its minimum rate is
    #: set from: a sandwich trades small and balanced and is charged near that,
    #: while the leg it wraps pays the dynamic fee at its own size.  NaN where
    #: no model could say.
    fee_floor: float = math.nan
    #: What this leg's own size pays in fees, read back out of the pool's exact
    #: model.  Preferred over `gamma_live` for a minimum rate because a dynamic
    #: fee climbs with the trade: measured, a stableswap-ng pool taken to 90% of
    #: its reserve charges 11.09 bp against a nominal 10.00.  NaN where no model
    #: could price the leg.
    fee_frac: float = math.nan
    #: The pool's measured retention, `sqrt(a_forward * a_reverse)`, so a
    #: minimum rate can be set from the fee the pool is charging right now
    #: rather than from a fee parameter nobody read.  NaN where the opposite
    #: direction was not calibrated, and on legs that are not pool swaps.
    gamma_live: float = math.nan
    #: False when the arc behind this leg carries no calibration -- the
    #: model-free `direct`/`two-step` candidates, built at `psi = 1` with
    #: `B = 0`.  Their `eps` and `impact_frac` are placeholders, not
    #: measurements, and printing them as `0.00 bp` claims a fee-free,
    #: impact-free pool.
    modelled: bool = True

    @property
    def is_conversion(self) -> bool:
        """A leg the node merge emitted, not a pool the solver chose.

        Exactly the six kinds `Conversion.forward_kind`/`reverse_kind` produce.
        With the wstETH pair missing, its legs were rescaled as swaps from an
        `amount_out` no calibration set -- zero -- and a route through wstETH
        lost that branch: 42.18 realised, 33.98 modelled.
        """
        return self.kind in (
            ArcKind.WRAP_NATIVE,
            ArcKind.UNWRAP_NATIVE,
            ArcKind.WSTETH_WRAP,
            ArcKind.WSTETH_UNWRAP,
            ArcKind.ERC4626_DEPOSIT,
            ArcKind.ERC4626_REDEEM,
        )


@dataclass(slots=True)
class RealizedRoute:
    legs: list[RealizedLeg] = field(default_factory=list)
    slots: dict[str, int] = field(default_factory=dict)
    dst_slot: int = 0
    src_token: str = ""
    dst_token: str = ""
    amount_in: int = 0
    modelled_out: int = 0
    node_of_slot: dict[int, int] = field(default_factory=dict)
    potentials: dict[int, float] = field(default_factory=dict)
    paths: list[list[str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def wire_legs(self) -> list[Leg]:
        return [rl.leg for rl in self.legs]

    @property
    def pools_used(self) -> list[str]:
        return sorted({rl.target.lower() for rl in self.legs if not rl.is_conversion})


def topological_nodes(tau: np.ndarray, sig: np.ndarray, n_nodes: int) -> list[int]:
    """Kahn's algorithm over the active arcs.  Raises on a cycle."""
    indegree = np.zeros(n_nodes, dtype=np.int64)
    np.add.at(indegree, sig, 1)
    queue = [int(v) for v in np.flatnonzero(indegree == 0)]
    order: list[int] = []
    remaining = indegree.copy()
    while queue:
        node = queue.pop(0)
        order.append(node)
        for arc in np.flatnonzero(tau == node):
            head = int(sig[arc])
            remaining[head] -= 1
            if remaining[head] == 0:
                queue.append(head)
    if len(order) != n_nodes:
        raise RealizationError(
            "the active arcs contain a cycle; flow cannot be ordered for execution"
        )
    return order


def cancel_cycles(
    tau: np.ndarray, sig: np.ndarray, psi: np.ndarray, tol: float = 1e-12
) -> tuple[np.ndarray, int]:
    """Remove circulation from a flow, leaving the same net delivery.

    A cycle appears when the model believes some loop has negative total `eps` --
    free arbitrage.  §5.3 treats that as real and worth absorbing, but a router
    cannot *execute* a circulation as part of a one-way trade: it would need
    capital it does not have, and the quoter walks a DAG.  Cancelling leaves the
    delivered amount unchanged and can only lower the modelled output, which is
    the conservative direction.

    Returns the acyclic flow and the number of cycles removed.
    """
    flow = np.array(psi, dtype=float)
    # The compiled pass, when it is installed.  Same peel, same
    # tie-breaks -- which cycle is found decides which arcs are
    # cancelled, so `tests/test_cycles_differential.py` differs the two.
    if _ACCEL_ON and _accel.available():
        got = _accel.cancel_cycles(tau, sig, flow, tol)
        if got is not None:
            return got
    removed = 0
    for _ in range(len(flow) + 1):
        live = np.flatnonzero(flow > tol)
        if live.size == 0:
            break
        cycle = _find_cycle(tau[live], sig[live])
        if cycle is None:
            break
        arcs = live[cycle]
        flow[arcs] -= flow[arcs].min()
        # Only the cycle's own arcs.  `flow[flow <= tol] = 0` looks like the same
        # statement and is not: `<= tol` catches every *negative* entry in the
        # whole vector, and a negative flow is real flow in the reverse
        # direction, not dust.  An active-set solve that stopped early leaves
        # those behind, and zeroing one strands exactly its magnitude at both of
        # its endpoints -- which §12.4 then refuses, correctly, for damage done
        # after the solve was finished.
        settled = arcs[flow[arcs] <= tol]
        flow[settled] = 0.0
        removed += 1
    return flow, removed


# A branch carrying less than this share of what leaves its node cannot change
# the answer, but it can still destroy it: measured on rETH->WETH, a branch
# holding 7e-6 of one node fed six more legs, each carrying an amount that
# rounded to zero, and one of them quoting zero aborted the whole route.
#
# `MIN_FLOW_FRACTION` in candidates.py does not catch this: it screens an arc's
# flow against the *whole trade*, while a branch can be a meaningful share of Psi
# and still be a rounding error at the node it leaves from.
DUST_SHARE = 1e-4


def prune_dust(
    tau: np.ndarray,
    sig: np.ndarray,
    psi: np.ndarray,
    src: int,
    dst: int,
    *,
    share: float = DUST_SHARE,
    tol: float = 1e-12,
) -> tuple[np.ndarray, int]:
    """Drop branches too small to matter, and whatever they were feeding.

    Two rules, applied together until the flow stops changing:

    * a branch carrying less than `share` of its node's outflow is dust;
    * an arc no longer on any src->dst path goes with it, which is what removes
      the orphaned tail rather than leaving legs quoting on nothing.

    The dropped value is not lost.  The quoter splits a node by share of the
    balance actually sitting in its slot and the last leg of a group sweeps the
    remainder, so removing a branch hands its flow to its siblings -- and at the
    optimum those siblings are priced within a hair of it (§6.1).

    This *does* leave KCL violated by up to `share` at the pruned node, which is
    deliberate and belongs strictly after §12.4's check: the invariant is about
    what the solver produced, and this is about what the quoter can survive.
    Returns the pruned flow and the number of arcs cut.
    """
    flow = np.array(psi, dtype=float)
    if flow.size == 0:
        return flow, 0
    n = int(max(int(tau.max()), int(sig.max()), src, dst)) + 1
    removed = 0
    for _ in range(len(flow) + 1):
        live = flow > tol
        if not live.any():
            break
        out_total = np.zeros(n)
        np.add.at(out_total, tau[live], flow[live])
        doomed = live & (flow < share * out_total[tau])
        doomed |= live & ~_on_a_path(tau, sig, live, n, src, dst)
        if not doomed.any():
            break
        flow[doomed] = 0.0
        removed += int(np.count_nonzero(doomed))
    # Pruning may not decide there is no route.  If the trade no longer reaches
    # the destination, the criterion was wrong for this flow and the original
    # stands -- a reverting candidate is adjudicated by the quoter, an empty one
    # never gets that far.
    if not (flow[sig == dst] > tol).any():
        return np.array(psi, dtype=float), 0
    return flow, removed


def _on_a_path(
    tau: np.ndarray, sig: np.ndarray, live: np.ndarray, n: int, src: int, dst: int
) -> np.ndarray:
    """Live arcs reachable from `src` and co-reachable to `dst`."""
    idx = np.flatnonzero(live)

    def sweep(seed: int, frm: np.ndarray, to: np.ndarray) -> np.ndarray:
        seen = np.zeros(n, dtype=bool)
        seen[seed] = True
        for _ in range(n):
            nxt = to[idx[seen[frm[idx]]]]
            if nxt.size == 0 or seen[nxt].all():
                break
            seen[nxt] = True
        return seen

    forward = sweep(src, tau, sig)
    backward = sweep(dst, sig, tau)
    return live & forward[tau] & backward[sig]


def _find_cycle(tau: np.ndarray, sig: np.ndarray) -> list[int] | None:
    """One directed cycle as local arc indices, or None.

    Peel arcs that cannot be on a cycle -- those whose head has no way out, or
    whose tail has no way in -- until the set is stable.  Whatever survives has
    every node with both an in- and an out-arc, so following out-edges from any
    of them must revisit a node, and the revisit closes a cycle.
    """
    alive = np.ones(len(tau), dtype=bool)
    while alive.any():
        heads = np.unique(tau[alive])  # nodes with a way out
        tails = np.unique(sig[alive])  # nodes with a way in
        doomed = alive & (~np.isin(sig, heads) | ~np.isin(tau, tails))
        if not doomed.any():
            break
        alive &= ~doomed
    if not alive.any():
        return None

    outgoing: dict[int, int] = {}
    for k in np.flatnonzero(alive):
        outgoing.setdefault(int(tau[k]), int(k))

    node = int(tau[np.flatnonzero(alive)[0]])
    position: dict[int, int] = {}
    path: list[int] = []
    while node not in position:
        position[node] = len(path)
        arc = outgoing[node]
        path.append(arc)
        node = int(sig[arc])
    return path[position[node] :]


def realize(
    arcs: list[PoolArc],
    psi: np.ndarray,
    nu: np.ndarray,
    nodes: NodeMap,
    *,
    src_token: str,
    dst_token: str,
    amount_in: int,
    potentials: np.ndarray | None = None,
) -> RealizedRoute:
    """Build the executable leg list from a solved flow.

    `arcs` and `psi` are parallel and already restricted to the arcs carrying
    flow.  `psi` is value; `delta = psi / nu[tau]` converts back to canonical
    token units, and the node map converts those to the pool's actual token.
    """
    route = RealizedRoute(
        src_token=src_token.lower(),
        dst_token=dst_token.lower(),
        amount_in=amount_in,
    )
    if not arcs:
        raise RealizationError("no arcs carry flow")

    tau = np.array([arc.tau for arc in arcs], dtype=np.int64)
    sig = np.array([arc.sigma for arc in arcs], dtype=np.int64)
    touched = sorted({*tau.tolist(), *sig.tolist()})
    index = {node: k for k, node in enumerate(touched)}
    order = topological_nodes(
        np.array([index[int(t)] for t in tau]),
        np.array([index[int(s)] for s in sig]),
        len(touched),
    )
    node_order = [touched[k] for k in order]

    # --- slots ----------------------------------------------------------
    def slot(token: str) -> int:
        """The accumulator this token's balance lands in.

        Aliases share one.  Two addresses over a single balance -- gnosis's two
        EURe contracts report the same `totalSupply` to the wei and the same
        `balanceOf` for every holder -- have no conversion leg between them,
        because there is nothing to execute.  Giving them a slot each meant the
        legs delivered into one and the route read the other.  Only aliases
        collapse; a vault or a native wrapper still needs its own slot, because a
        leg converts between them.
        """
        key = token.lower()
        conversion = nodes.conversion.get(key)
        if conversion is not None and conversion.is_alias:
            key = conversion.canonical.lower()
        if key not in route.slots:
            route.slots[key] = len(route.slots)
            route.node_of_slot[route.slots[key]] = nodes.node(key)
        return route.slots[key]

    slot(src_token)  # slot 0 is always the input
    if potentials is not None:
        route.potentials = {int(n): float(potentials[n]) for n in touched}

    # --- amounts --------------------------------------------------------
    deltas: list[int] = []
    outs: list[int] = []
    for arc, flow in zip(arcs, psi, strict=True):
        delta_canonical = float(flow) / float(nu[arc.tau])
        delta_token = delta_canonical / nodes.rate(arc.token_in)
        deltas.append(int(delta_token * 10 ** nodes.decimals(arc.token_in)))
        # (M1) is only valid on [0, a/B], where f_hat' hits zero; beyond that
        # the model turns *decreasing*, so it is a hard box constraint rather
        # than something to watch.  Clipping keeps a solver excursion from
        # showing up as a negative -- and therefore zero -- output.
        domain = arc.a / arc.B if arc.B > 0 else math.inf
        d = min(delta_canonical, domain)
        model = arc.a * d - 0.5 * arc.B * d * d
        out_token = max(model, 0.0) / nodes.rate(arc.token_out)
        outs.append(int(out_token * 10 ** nodes.decimals(arc.token_out)))

    by_source: dict[int, list[int]] = {}
    for k, arc in enumerate(arcs):
        by_source.setdefault(arc.tau, []).append(k)

    # --- emit -----------------------------------------------------------
    destination = nodes.node(dst_token)
    dst_lower = dst_token.lower()
    for node in node_order:
        canonical = nodes.canonical_of[node]
        outgoing = by_source.get(node, [])

        incoming_tokens = {
            arcs[k].token_out.lower() for k in range(len(arcs)) if arcs[k].sigma == node
        }
        if node == nodes.node(src_token):
            incoming_tokens.add(src_token.lower())

        # (0) which member of this node should actually hold the balance?
        #
        # The canonical token is an arbitrary label -- what matters is which
        # member the legs want.  Defaulting to it round-trips a node whose flow
        # both arrives *and* leaves as the same non-canonical token, two legs and
        # two lots of integer rounding to end where it started.
        #
        # Only when the whole node agrees, and only when everything arriving can
        # reach the new hub in one hop -- every conversion is defined against the
        # canonical, so a second non-canonical arrival would need two.  Left
        # alone for the destination, whose tail is keyed to the canonical, and
        # for mixed nodes, where funnelling through one slot is what makes the
        # `bps` split well defined.
        hub = canonical
        if outgoing and node != destination:
            wanted = {arcs[k].token_in.lower() for k in outgoing}
            if len(wanted) == 1:
                only = next(iter(wanted))
                if (
                    only != canonical
                    and only in nodes.conversion
                    and incoming_tokens <= {only, canonical}
                ):
                    hub = only

        # (1) fold everything held at this node into the hub
        for token in sorted(incoming_tokens):
            if token == hub:
                continue
            # The destination has no outgoing arcs, so skipping it here left a
            # route that ends in native ETH depositing into the ETH slot while
            # the caller asked for WETH -- the quoter then reads the WETH slot,
            # finds nothing, and the whole candidate reads as "reverted".
            if not outgoing and node != destination:
                continue
            # Flow that already arrives *as the token the caller asked for* is
            # finished.  Folding it into the hub only for the destination tail
            # below to convert it straight back is two legs and two lots of
            # integer rounding to end where it started.
            if node == destination and not outgoing and token == dst_lower:
                continue
            # Every conversion is defined against the canonical, so folding
            # *into* a non-canonical hub runs the same one backwards.
            if token == canonical:
                conversion, forward = nodes.conversion.get(hub), False
            else:
                conversion, forward = nodes.conversion.get(token), True
            if conversion is None or conversion.is_alias:
                continue  # an alias is already the same balance; see nodes.py
            route.legs.append(
                _conversion_leg(
                    nodes, conversion, forward=forward,
                    src=slot(token), dst=slot(hub), bps=0,
                )
            )

        if not outgoing:
            continue

        # (2) everything leaving the hub, as one contiguous group
        total = sum(deltas[k] for k in outgoing)
        if total <= 0:
            continue
        spokes: list[tuple[int, int]] = []  # (arc index, spoke slot)
        hub_arcs: list[int] = []
        by_token: dict[str, list[int]] = {}  # spoke token -> arcs drawing it
        for k in outgoing:
            token_in = arcs[k].token_in.lower()
            # Compare *slots*, not addresses.  An alias is a second address over
            # one balance, so `slot` deliberately collapses it onto the
            # canonical, and an arc drawing on the alias is already drawing on
            # the hub.  Testing the address instead sent it down the spoke path,
            # where the conversion leg it then built moved slot 0 to slot 0 and
            # `Leg` refused it outright.  The fold above skips aliases for the
            # same reason.
            if slot(token_in) == slot(hub):
                hub_arcs.append(k)
            else:
                spokes.append((k, slot(token_in)))
                by_token.setdefault(token_in, []).append(k)

        # One fill per spoke, not one per arc drawing on it.  Every arc wanting
        # scrvUSD used to get its own crvUSD -> scrvUSD wrap: measured on
        # crvUSD -> sDOLA at $100,000, four deposits at one ratio into one slot
        # where a single deposit of the total pays the same 80,140.808884 --
        # three redundant vault calls, and three of the caller's 32 legs, for
        # nothing.  The draw side has always grouped this way; see (3).
        #
        # Keyed on the *token* rather than the slot it lands in, because the
        # conversion is a property of the token: two of them sharing a slot are
        # two different calls and still need a leg each.
        group: list[tuple[str, object]] = (
            [("arc", k) for k in hub_arcs] + [("spoke", t) for t in by_token]
        )

        def behind(item, by_token=by_token) -> list[int]:
            """The arcs an item carries -- one for an arc, all of them for a fill.

            `by_token` is bound rather than closed over: this runs once per
            node and the dict is rebuilt each time round.
            """
            return [item[1]] if item[0] == "arc" else by_token[item[1]]

        # The last leg of a group sweeps -- `bps == 0` takes whatever is left, so
        # no dust strands in the slot -- and that makes the order load-bearing
        # twice over.
        #
        # **A capped arc must never be last.**  Its `cap` is honoured in the
        # solve and there is no room for it in the calldata, so being the
        # sweeper hands it the remainder whatever the solve decided.  Measured
        # on USDT -> ZCHF at $10,000: the USD3 vault arc holds `cap = 5.0e-05`
        # and `clamped`, the solve gave it nothing, and coming last out of the
        # USDC slot handed it 99.7% of the trade -- 9,960 USDC into a vault
        # whose `maxDeposit` is 1,142.  `previewDeposit` quotes it happily and
        # `deposit` reverts, so the route was published and could not be run.
        #
        # **A pool entered twice needs the legs we cannot advance past last**,
        # which is what lets the gnosis split swap through the 3pool and then
        # deposit into it.  Where the two fight, the cap wins: emitting a
        # reentry in the wrong order costs a candidate, because
        # `check_one_arc_per_pool` refuses it, and a capped sweeper costs a
        # reverted route.
        reused = _reused_pools(arcs)

        def absorbs_remainder(item) -> bool:
            # A fill hands its remainder on to whatever draws on it, so it may
            # sweep only when every one of those can take it.
            return all(not math.isfinite(arcs[k].cap) for k in behind(item))

        group.sort(key=lambda item: (
            absorbs_remainder(item),
            bool(reused) and any(arcs[k].pool.lower() in reused
                                 and arcs[k].kind not in ADVANCEABLE
                                 for k in behind(item)),
        ))
        # Nothing here can take the remainder, so nobody sweeps and the rounding
        # dust stays in the slot.  A few wei stranded is a cost; a leg that
        # sweeps past its cap is a route that does not run.
        sweeper = len(group) - 1 if any(map(absorbs_remainder, group)) else -1

        for position, item in enumerate(group):
            share = sum(deltas[k] for k in behind(item))
            bps = (0 if position == sweeper
                   else max(1, min(BPS - 1, round(BPS * share / total))))
            if item[0] == "spoke":
                token_in = item[1]
                route.legs.append(
                    _conversion_leg(
                        nodes, nodes.conversion[token_in], forward=False,
                        src=slot(hub), dst=slot(token_in), bps=bps,
                    )
                )
            else:
                k = item[1]
                route.legs.append(
                    _arc_leg(arcs[k], nodes, slot(hub), slot(arcs[k].token_out),
                             bps, deltas[k], outs[k], float(psi[k]), deltas[k] / total)
                )

        # (3) arcs that had to draw from a spoke.  One group per spoke *slot*,
        # not one per arc.
        #
        # The quoter groups by contiguous `src_slot`, so two arcs drawing from
        # the same spoke are one `bps` group however they were emitted.  Giving
        # each of them `bps = 0` put two sweepers in that group: the first took
        # the whole slot and the second was left with nothing to trade, which is
        # a leg that can never do anything.  Measured on crvUSD -> sDOLA at $2M,
        # a candidate carried `SaveDola` and `LlamaThena` both sweeping slot 1.
        by_spoke: dict[int, list[int]] = {}
        for k, spoke in spokes:
            by_spoke.setdefault(spoke, []).append(k)
        for spoke, ks in by_spoke.items():
            # The sweeper goes last and must be able to absorb the remainder,
            # the same rule the hub group above follows and for the same reason
            # -- which is `not isfinite`, the uncapped arc, and this sorted the
            # other way round: `isfinite` ascending puts the *capped* one last
            # and hands it the whole slot, the very thing the USD3 measurement
            # above is about.
            ks.sort(key=lambda k: not math.isfinite(arcs[k].cap))
            drawn = sum(deltas[k] for k in ks)
            for position, k in enumerate(ks):
                bps = (0 if position == len(ks) - 1 or drawn <= 0
                       else max(1, min(BPS - 1, round(BPS * deltas[k] / drawn))))
                route.legs.append(
                    _arc_leg(arcs[k], nodes, spoke, slot(arcs[k].token_out),
                             bps, deltas[k], outs[k], float(psi[k]),
                             deltas[k] / total)
                )

    # --- destination ----------------------------------------------------
    dst_node = nodes.node(dst_token)
    dst_canonical = nodes.canonical_of[dst_node]
    # Only convert out of the hub if anything actually landed in it.  Arrivals
    # already in `dst_token` bypass the fold above, so when *every* leg pays the
    # requested token the hub is empty and this leg would move zero -- harmless
    # in the quoter, but it still spends one of the caller's legs.
    arriving = {
        arcs[k].token_out.lower() for k in range(len(arcs)) if arcs[k].sigma == dst_node
    }
    hub_has_balance = any(
        token == dst_canonical or (token != dst_lower and token in nodes.conversion)
        for token in arriving
    )
    if dst_lower != dst_canonical and hub_has_balance:
        conversion = nodes.conversion.get(dst_lower)
        # An alias needs no leg and cannot have one: `slot` already put both
        # addresses in one accumulator, so this would move a slot to itself.
        # Asking for gnosis's second EURe raised out of `Leg` instead.
        if conversion is not None and not conversion.is_alias:
            route.legs.append(
                _conversion_leg(
                    nodes, conversion, forward=False,
                    src=slot(dst_canonical), dst=slot(dst_token), bps=0,
                )
            )
    route.dst_slot = slot(dst_token)
    route.modelled_out = _forward_simulate(route, nodes)
    route.paths = _decompose(route)
    return route


def _arc_leg(
    arc: PoolArc,
    nodes: NodeMap,
    src: int,
    dst: int,
    bps: int,
    amount_in: int,
    amount_out: int,
    psi: float,
    share: float,
) -> RealizedLeg:
    impact = psi / (2 * arc.G) if arc.G > 0 else 0.0
    theta = 0.0
    if arc.reserve_in > 0:
        theta = amount_in / arc.reserve_in
    return RealizedLeg(
        leg=Leg(
            target=arc.pool,
            kind=arc.kind,
            i=arc.i,
            j=arc.j,
            n=arc.n_coins,
            src_slot=src,
            dst_slot=dst,
            bps=bps,
        ),
        kind=arc.kind,
        target=arc.pool,
        token_in=arc.token_in,
        token_out=arc.token_out,
        amount_in=amount_in,
        amount_out=amount_out,
        share_of_node=share,
        arc_id=arc.id,
        pool_name=arc.note,
        eps=arc.eps,
        impact_frac=impact,
        theta=theta,
        psi=psi,
        reserve_in=arc.reserve_in,
        tvl_usd=arc.tvl_usd,
        gamma_live=arc.gamma_live,
        modelled=arc.G > 0,
    )


def _conversion_leg(
    nodes: NodeMap, conversion, *, forward: bool, src: int, dst: int, bps: int
) -> RealizedLeg:
    """`forward` means token -> canonical."""
    kind = conversion.forward_kind if forward else conversion.reverse_kind
    token_in = conversion.token if forward else conversion.canonical
    token_out = conversion.canonical if forward else conversion.token
    return RealizedLeg(
        leg=Leg(
            target=conversion.target or token_out,
            kind=kind,
            i=0,
            j=1,
            n=2,
            src_slot=src,
            dst_slot=dst,
            bps=bps,
        ),
        kind=kind,
        target=conversion.target or token_out,
        token_in=token_in,
        token_out=token_out,
        amount_in=0,
        amount_out=0,
        pool_name=f"{nodes.symbol(token_in)} -> {nodes.symbol(token_out)}",
    )


def conversion_route(
    nodes: NodeMap, *, src_token: str, dst_token: str, amount_in: int
) -> RealizedRoute:
    """The route between two tokens of the *same* node: the conversion itself.

    Merging is what lets the solve treat crvUSD and scrvUSD, or ETH and WETH, as
    one place -- and it also means there is no arc between them and nothing for
    the graph to find.  Asking for one used to be an error, which is right about
    the model and wrong about the question: crvUSD -> scrvUSD is a real trade,
    it just happens to be a deposit rather than a swap.

    Every conversion is defined against the node's canonical token, so the answer
    is at most two legs -- in to the canonical, out to the target -- and often
    one.  An ALIAS pair emits none: holding one is holding the other.
    """
    src, dst = src_token.lower(), dst_token.lower()
    canonical = nodes.canonical(src)
    legs: list[RealizedLeg] = []
    slot = 0
    token = src

    for target, forward in ((canonical, True), (dst, False)):
        if token == target:
            continue
        conversion = nodes.conversion.get(token if forward else target)
        if conversion is None or conversion.is_alias:
            token = target
            continue
        legs.append(
            _conversion_leg(nodes, conversion, forward=forward,
                            src=slot, dst=slot + 1, bps=0)
        )
        slot += 1
        token = target

    # Both tokens are the same node by construction; the renderer labels each
    # bus from this, and without it every slot reads as node 0 -- which drew
    # "crvUSD = DAI/sDAI" over a crvUSD -> scrvUSD deposit.
    node = nodes.node(src)
    route = RealizedRoute(
        legs=legs, dst_slot=slot, src_token=src, dst_token=dst,
        amount_in=amount_in,
        slots={src: 0} if not legs else {src: 0, dst: slot},
        node_of_slot=dict.fromkeys(range(slot + 1), node),
    )
    route.modelled_out = _forward_simulate(route, nodes) if legs else amount_in
    return route


def _forward_simulate(route: RealizedRoute, nodes: NodeMap) -> int:
    """Replay the legs the way the quoter will, to fill in modelled amounts.

    The *routing* matches the contract exactly -- same group snapshot, same
    `bps`-of-base arithmetic, same order -- so the split the diagram shows is the
    split the quoter will be asked to confirm.

    The *amounts* are the model's, not the chain's, and deliberately so.  Each leg
    keeps the ratio its arc was calibrated at, rescaled linearly to whatever
    arrives, which is a straight line through a curve: worst measured drift
    against a stateful walk of the same legs is 2.78 bp.

    Pricing these legs from the exact models instead would destroy the one number
    that makes the loss ledger worth reading: `verified - modelled` measures the
    model, so a `modelled_out` computed from the exact models would report its own
    accuracy as zero.
    """
    balances: dict[int, int] = {0: route.amount_in}
    current = None
    base = 0
    for realized in route.legs:
        src = realized.leg.src_slot
        if src != current:
            current = src
            base = balances.get(src, 0)
        available = balances.get(src, 0)
        take = available if realized.leg.bps == 0 else min(base * realized.leg.bps // BPS, available)
        if take <= 0:
            continue
        if realized.is_conversion:
            conversion = nodes.conversion.get(realized.token_in.lower()) or nodes.conversion.get(
                realized.token_out.lower()
            )
            # Direction from the conversion, not from a list of kinds: it names
            # the two itself, so a kind added later cannot be missed.
            if conversion is None:
                produced = take
            elif realized.kind is conversion.forward_kind:
                produced = conversion.to_canonical(take)
            else:
                produced = conversion.from_canonical(take)
            realized.amount_in = take
            realized.amount_out = produced
        else:
            # keep the modelled ratio, rescaled to whatever actually arrives
            if realized.amount_in > 0:
                produced = realized.amount_out * take // realized.amount_in
            else:
                produced = 0
            realized.amount_in = take
            realized.amount_out = produced
            if realized.reserve_in > 0:
                # The amounts just moved; `theta` describes them or it describes
                # nothing.  A model-free candidate is realised at `psi = 1` --
                # under a token of flow -- so a stale `theta` reads 0.00% on a leg
                # taking several times the pool.
                realized.theta = take / realized.reserve_in
        balances[src] = available - take
        balances[realized.leg.dst_slot] = balances.get(realized.leg.dst_slot, 0) + produced
    return balances.get(route.dst_slot, 0)


# Paths are display-only, and there can be exponentially many of them: the walk
# below is a DAG enumeration, so a route 16 legs deep branching three ways at
# each node has tens of millions.  §11.6 warns that path enumeration is
# exponential, and it is just as true in the presentation layer as in the solver.
MAX_DISPLAY_PATHS = 64


def _decompose(route: RealizedRoute) -> list[list[str]]:
    """Flow decomposition, for display only.

    Deliberately derived *after* the legs: the legs are the truth, and paths
    are a reading of them.  Doing it the other way round is what double-counts
    shared pools.

    Bounded at `MAX_DISPLAY_PATHS`: nobody reads the 65th path, and the legs --
    which are the executable artefact -- are unaffected by the cut.
    """
    outgoing: dict[int, list[RealizedLeg]] = {}
    for realized in route.legs:
        outgoing.setdefault(realized.leg.src_slot, []).append(realized)

    paths: list[list[str]] = []

    def walk(slot: int, trail: list[str], depth: int = 0) -> None:
        if depth > 16 or len(paths) >= MAX_DISPLAY_PATHS:
            return
        legs = outgoing.get(slot)
        if not legs or slot == route.dst_slot:
            if trail:
                paths.append(trail)
            return
        for realized in legs:
            if len(paths) >= MAX_DISPLAY_PATHS:
                return
            label = realized.arc_id or f"{realized.kind.name}:{realized.target[:10]}"
            walk(realized.leg.dst_slot, [*trail, label], depth + 1)

    walk(0, [])
    if len(paths) >= MAX_DISPLAY_PATHS:
        route.warnings.append(
            f"path list truncated at {MAX_DISPLAY_PATHS}; the legs are complete "
            "and are what executes"
        )
    return paths


def _reused_pools(arcs: list[PoolArc]) -> set[str]:
    """Pools carrying more than one of these arcs."""
    seen: dict[str, int] = {}
    for arc in arcs:
        key = arc.pool.lower()
        seen[key] = seen.get(key, 0) + 1
    return {pool for pool, count in seen.items() if count > 1}


#: The leg kinds whose effect on a pool the models can reproduce.  A swap moves
#: two balances by amounts `StableSwap.exchange` computes exactly, and a deposit
#: is `StableSwapLP.add_liquidity` -- which charges the imbalance fee
#: `calc_token_amount` explicitly does not, and keeps all but the DAO's share.
#: A *withdrawal* is still not here: `remove_liquidity_one_coin`'s effect on the
#: supply has not been read off the deployed source, and guessing it is what this
#: list exists to prevent.
ADVANCEABLE = (ArcKind.SWAP_STABLE, ArcKind.DEPOSIT_FIXED,
               ArcKind.DEPOSIT_DYN, ArcKind.DEPOSIT_FIXED_NOFLAG)


def check_one_arc_per_pool(route: RealizedRoute) -> list[str]:
    """Decision 3: a pool appears once, or its legs form one multi-port element.

    A view-only chained quoter cannot see its own earlier leg, so two arcs of
    one pool priced independently are priced against a state neither will see.
    The old exemption let them through when every leg but the last was
    `ADVANCEABLE`, which bought a walk that advances the pool but still models
    the arcs as two independent resistors -- separate `psi^2/2G` terms, no
    cross-term.

    An **element** is the same trade with the pool appearing once, so the
    coupling *is* the advancing state.  Admissibility is then structural rather
    than a rule to remember (`core/multiport.py`):

    * a coin may hold at most one port -- on both sides is a wash, twice on one
      side is one port -- which gives `#coin-ports in + #coin-ports out <= N`
      for free.  A 2-coin pool therefore admits exactly one in and one out and
      **cannot be re-entered at all**;
    * the LP token is not one of the `N`, so `add_liquidity` of both coins of a
      2-coin pool stays a real operation;
    * many-in many-out needs a pairing rule and is refused rather than guessed;
    * an LP *input* paying several coins is refused: `evaluate` cannot advance a
      withdrawal, so it would price every burn against one supply.

    Returns the pool addresses whose legs are not an admissible element.
    """
    order: dict[str, list[RealizedLeg]] = {}
    for realized in route.legs:
        if realized.is_conversion:
            continue
        order.setdefault(realized.target.lower(), []).append(realized)
    bad: list[str] = []
    for pool, legs in order.items():
        if len(legs) < 2:
            continue
        try:
            element_of(legs)
        except (MultiPortError, ValueError):
            bad.append(pool)
    return sorted(bad)


def route_conductance(route: RealizedRoute) -> float:
    """The route as a resistor network: `1/TVL` per pool, src to dst.

    The same reading the rest of the router uses, applied to a whole candidate
    rather than one arc.  Series hops add resistance and parallel branches add
    conductance, so a topology that splits across deep pools scores above one
    that funnels everything through a thin series chain -- which is what "this
    candidate could carry the trade if it were split properly" means, said in
    the units the model is already written in.

    **TVL, not the fitted `G`.**  The scout exists because the model's split is
    not to be trusted on wide topologies; ranking those candidates by a number
    the same model produced would inherit the error being corrected.  The pool's
    own size is independent of it.

    Node merges are shorts (`eps = 0`, `G = infinity`, §3.1), so their slots are
    joined rather than given an edge.  Returns 0 when src cannot reach dst
    through pools with a size to speak of.
    """
    if not route.legs:
        return 0.0
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    slots = {0, route.dst_slot}
    for realized in route.legs:
        slots.add(realized.leg.src_slot)
        slots.add(realized.leg.dst_slot)
    for realized in route.legs:
        if realized.is_conversion:
            a, b = find(realized.leg.src_slot), find(realized.leg.dst_slot)
            if a != b:
                parent[a] = b
    src, dst = find(0), find(route.dst_slot)
    if src == dst:
        return math.inf  # nothing but merges between the two ends

    nodes = sorted({find(s) for s in slots})
    index = {node: k for k, node in enumerate(nodes)}
    laplacian = np.zeros((len(nodes), len(nodes)))
    for realized in route.legs:
        if realized.is_conversion or realized.tvl_usd <= 0:
            continue
        a = index[find(realized.leg.src_slot)]
        b = index[find(realized.leg.dst_slot)]
        if a == b:
            continue
        laplacian[a, a] += realized.tvl_usd
        laplacian[b, b] += realized.tvl_usd
        laplacian[a, b] -= realized.tvl_usd
        laplacian[b, a] -= realized.tvl_usd

    # Ground the destination and inject a unit current at the source: the
    # potential left at the source *is* the effective resistance.
    keep = [k for k in range(len(nodes)) if k != index[dst]]
    if not keep:
        return 0.0
    rhs = np.zeros(len(keep))
    rhs[keep.index(index[src])] = 1.0
    try:
        potential = np.linalg.solve(laplacian[np.ix_(keep, keep)], rhs)
    except np.linalg.LinAlgError:
        return 0.0  # src and dst are in different components
    resistance = float(potential[keep.index(index[src])])
    return 1.0 / resistance if resistance > 0 else 0.0


def max_theta(route: RealizedRoute) -> float:
    return max((rl.theta for rl in route.legs if not rl.is_conversion), default=0.0)


def total_loss_bp(route: RealizedRoute, price_out_per_in: float) -> float:
    """Realised loss against a frictionless trade at the reference price."""
    if route.amount_in <= 0 or price_out_per_in <= 0:
        return math.nan
    ideal = route.amount_in * price_out_per_in
    if ideal <= 0:
        return math.nan
    return (1.0 - route.modelled_out / ideal) * 10_000
