"""A structured diagram model, independent of how it is drawn.

`render_text` turns this into terminal art; the Flet frontend will turn the
same model into controls.  Keeping the layout decisions here -- which bus
belongs to which layer, what each element's annotations are -- means neither
renderer has to re-derive them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, localcontext

from .nodes import NodeMap
from .realize import RealizedRoute
from .types import ArcKind


def format_units(amount: int, decimals: int, places: int = 6) -> str:
    """Exact decimal formatting -- never a float, which would lose wei.

    The context precision is raised to fit the number rather than left at the
    default 28 digits.  `quantize` *raises* rather than rounding when the result
    would not fit, so a diagram is one absurd intermediate away from taking the
    whole quote down with `InvalidOperation`, naming neither leg nor pool.
    """
    with localcontext() as ctx:
        ctx.prec = max(28, len(str(abs(amount))) + places + 2)
        value = Decimal(amount).scaleb(-decimals)
        quantized = value.quantize(Decimal(1).scaleb(-places))
    return f"{quantized:,}"


@dataclass(slots=True)
class BusView:
    """A token rail: one graph node, holding one concrete token."""

    slot: int
    node: int
    token: str
    symbol: str
    amount: str
    amount_wei: int
    potential_bp: float | None = None
    is_source: bool = False
    is_dest: bool = False
    is_verified: bool = False  # this figure came from the chain, not the model
    merged_with: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ElementView:
    """One leg, drawn as a diode in series with a resistor."""

    index: int
    label: str
    kind: ArcKind
    target: str
    src_slot: int
    dst_slot: int
    token_in: str
    token_out: str
    amount_in: str
    amount_out: str
    share_pct: float
    eps_bp: float = 0.0
    impact_bp: float = 0.0
    theta_pct: float = 0.0
    #: False when `eps_bp`/`impact_bp` are placeholders rather than a fit.
    modelled: bool = True
    conductance_usd: float = 0.0
    flags: list[str] = field(default_factory=list)
    detail: str = ""

    @property
    def is_conversion(self) -> bool:
        return self.kind in (
            ArcKind.WRAP_NATIVE,
            ArcKind.UNWRAP_NATIVE,
            ArcKind.ERC4626_DEPOSIT,
            ArcKind.ERC4626_REDEEM,
        )

    @property
    def is_battery(self) -> bool:
        return self.eps_bp < 0


@dataclass(slots=True)
class Diagram:
    title: str = ""
    subtitle: str = ""
    buses: list[BusView] = field(default_factory=list)
    elements: list[ElementView] = field(default_factory=list)
    order: list[int] = field(default_factory=list)  # slot order, source first
    ledger: dict[str, float] = field(default_factory=dict)
    diagnostics: dict[str, object] = field(default_factory=dict)
    candidates: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    certificate: bool = False
    certificate_reason: str | None = None

    def bus(self, slot: int) -> BusView:
        return next(b for b in self.buses if b.slot == slot)

    def elements_from(self, slot: int) -> list[ElementView]:
        return [e for e in self.elements if e.src_slot == slot]


def build_diagram(
    route: RealizedRoute,
    nodes: NodeMap,
    *,
    title: str = "",
    subtitle: str = "",
    certificate: bool = False,
    certificate_reason: str | None = None,
    pool_names: dict[str, str] | None = None,
    ledger: dict[str, float] | None = None,
    diagnostics: dict[str, object] | None = None,
    warnings: list[str] | None = None,
    verified_out: int | None = None,
) -> Diagram:
    pool_names = pool_names or {}
    diagram = Diagram(
        title=title,
        subtitle=subtitle,
        certificate=certificate,
        certificate_reason=certificate_reason,
        ledger=dict(ledger or {}),
        diagnostics=dict(diagnostics or {}),
        warnings=list(warnings or []),
    )

    # --- balances, replayed the way the quoter will ----------------------
    balances: dict[int, int] = {0: route.amount_in}
    for realized in route.legs:
        dst = realized.leg.dst_slot
        balances[dst] = balances.get(dst, 0) + realized.amount_out

    for token, slot in sorted(route.slots.items(), key=lambda kv: kv[1]):
        node = route.node_of_slot.get(slot, 0)
        members = [nodes.symbol(t) for t in nodes.tokens_of[node] if t != token]
        potential = route.potentials.get(node)
        # The destination shows what the chain actually quoted, not what the
        # model accumulated -- otherwise the diagram's own total disagrees with
        # the headline figure, which is the number that matters.
        amount_wei = balances.get(slot, 0)
        verified_here = slot == route.dst_slot and verified_out is not None
        if verified_here:
            amount_wei = verified_out
        diagram.buses.append(
            BusView(
                slot=slot,
                node=node,
                token=token,
                symbol=nodes.symbol(token),
                amount=format_units(amount_wei, nodes.decimals(token)),
                amount_wei=amount_wei,
                is_verified=bool(verified_here),
                potential_bp=None if potential is None else potential * 10_000,
                is_source=slot == 0,
                is_dest=slot == route.dst_slot,
                merged_with=members,
            )
        )

    for k, realized in enumerate(route.legs, start=1):
        flags: list[str] = []
        if realized.is_conversion:
            flags.append("MERGE")
        if realized.eps < 0:
            flags.append("BATTERY")
        detail = pool_names.get(realized.target.lower(), realized.pool_name)
        diagram.elements.append(
            ElementView(
                index=k,
                label=detail or realized.target[:10],
                kind=realized.kind,
                target=realized.target,
                src_slot=realized.leg.src_slot,
                dst_slot=realized.leg.dst_slot,
                token_in=realized.token_in,
                token_out=realized.token_out,
                amount_in=format_units(
                    realized.amount_in, nodes.decimals(realized.token_in)
                ),
                amount_out=format_units(
                    realized.amount_out, nodes.decimals(realized.token_out)
                ),
                share_pct=realized.share_of_node * 100.0,
                eps_bp=realized.eps * 10_000,
                impact_bp=realized.impact_frac * 10_000,
                theta_pct=realized.theta * 100.0,
                modelled=realized.modelled,
                flags=flags,
                detail=realized.target,
            )
        )

    diagram.order = _slot_order(route)
    return diagram


def _slot_order(route: RealizedRoute) -> list[int]:
    """Topological order of slots, so a bus is drawn after everything feeding it.

    First-appearance order looks right on a single path and is wrong the moment
    a branch merges back: the destination bus would print before the branch that
    fills it.
    """
    slots = sorted(route.slots.values())
    indegree = dict.fromkeys(slots, 0)
    edges: dict[int, list[int]] = {s: [] for s in slots}
    for realized in route.legs:
        src, dst = realized.leg.src_slot, realized.leg.dst_slot
        edges[src].append(dst)
        indegree[dst] += 1

    queue = [s for s in slots if indegree[s] == 0]
    order: list[int] = []
    while queue:
        queue.sort()
        slot = queue.pop(0)
        order.append(slot)
        for head in edges[slot]:
            indegree[head] -= 1
            if indegree[head] == 0:
                queue.append(head)
    # A cycle should be impossible (realize() rejects one), but never drop a bus.
    order.extend(s for s in slots if s not in order)
    return order
