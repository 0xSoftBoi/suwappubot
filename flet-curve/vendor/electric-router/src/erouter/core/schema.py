"""JSON serialisation of a route (spec §15).

Token amounts are always **strings of integers in native units**; the `*_human`
fields are decorative.  `certificate` is non-optional and carries a non-null
`certificate_reason` whenever it is false -- §15's contract is that it "must be
surfaced, not swallowed", and pairing the two enforces that at the schema level
rather than by convention.
"""

from __future__ import annotations

from typing import Any

from .pipeline import RouteResult
from .rendermodel import format_units
from .routecall import SIGNATURE


def _loss_bp(result, ledger: dict[str, float] | None, total_bp: float) -> dict:
    """What the trade cost, chain first and model beside it.

    `fee` and `impact` sum to `modelled_total`, never to `total`: the chain
    reports one number.  `model_delta` is `modelled - verified`, so negative is
    §12.1's optimistic model past a tenth of reserve and positive is §3.6's.
    """
    out = {
        "total": round(total_bp, 4),
        "modelled_total": round(total_bp, 4),
        "fee": round(result.fee_bp, 4),
        "impact": round(result.impact_bp, 4),
        "verified_total": None,
        "model_delta": None,
    }
    if not ledger:
        return out
    if ledger.get("total_bp") is not None:
        out["modelled_total"] = round(float(ledger["total_bp"]), 4)
        out["total"] = out["modelled_total"]
    verified = ledger.get("verified_bp")
    if verified is not None:
        out["verified_total"] = round(float(verified), 4)
        out["total"] = out["verified_total"]
        delta = ledger.get("model_delta_bp")
        out["model_delta"] = round(float(
            out["modelled_total"] - out["verified_total"] if delta is None else delta
        ), 4)
    return out


#: `ElectricRouter`, deployed through the canonical CREATE2 proxy, so the
#: address is a function of the initcode and is the same on every chain.
#: Verified byte-identical to the compiled runtime on all fifteen.  Editing
#: the contract at all moves this, because Vyper puts a hash of the source in
#: the initcode -- see `tests/test_router_address.py`.
ROUTER_ADDRESS = "0xf5438dafc165b466f4a61ce57bd3aa59bcd5979e"


def to_json(
    result: RouteResult,
    *,
    chain: str = "",
    chain_id: int = 0,
    block: int = 0,
    candidates: list[dict] | None = None,
    verified_out: int | None = None,
    ledger: dict[str, float] | None = None,
    call: Any = None,
) -> dict[str, Any]:
    """`amount_out` is the chain's figure where there is one, `modelled_out` the
    model's.  They agree to a fraction of a bp until they do not: `ETH -> ETHx`
    at 241% of reserve modelled 91.15 against 82.50 paid.  `ledger` is the
    terminal's own, passed in so the two cannot drift.  `call` is the packed
    `RouteCall`, present only when calldata was asked for.
    """
    route = result.route
    nodes = result.nodes
    if route is None or nodes is None:
        raise ValueError("cannot serialise a route that was not produced")

    src_dec = nodes.decimals(result.src_token)
    dst_dec = nodes.decimals(result.dst_token)
    total_bp = result.fee_bp + result.impact_bp
    delivered = route.modelled_out if verified_out is None else verified_out

    payload: dict[str, Any] = {
        "version": 1,
        "chain": {"name": chain, "chain_id": chain_id, "block": block},
        "request": {
            "src": result.src_token,
            "dst": result.dst_token,
            "src_symbol": nodes.symbol(result.src_token),
            "dst_symbol": nodes.symbol(result.dst_token),
            "amount_in": str(result.amount_in),
            "amount_in_human": format_units(result.amount_in, src_dec),
        },
        "result": {
            "amount_out": str(delivered),
            "amount_out_human": format_units(delivered, dst_dec),
            "modelled_out": str(route.modelled_out),
            "modelled_out_human": format_units(route.modelled_out, dst_dec),
            "verified_out": None if verified_out is None else str(verified_out),
            "verified": verified_out is not None,
            "certificate": result.certificate,
            "certificate_reason": result.certificate_reason,
            "loss_bp": _loss_bp(result, ledger, total_bp),
            # Quoted, not modelled: the same route re-priced at a fraction of
            # the size, so `bp` is what this trade's size cost it.
            "price_impact": None if result.price_impact_bp is None else {
                "bp": round(result.price_impact_bp, 4),
                "fraction": result.impact_fraction,
                "reference_in": str(result.impact_reference_in),
                "reference_out": str(result.impact_reference_out),
            },
        },
        "legs": [],
        "nodes": [],
        "paths": route.paths,
        "candidates": candidates or [],
        "diagnostics": {
            **dict(result.counters),
            "timings_ms": {k: round(v, 2) for k, v in result.timings.items()},
        },
        "warnings": result.warnings,
    }
    if call is not None:
        payload["call"] = {
            "signature": SIGNATURE,
            "to": ROUTER_ADDRESS,
            "calldata": "0x" + call.calldata(sender=call.receiver).hex(),
            "amount_in": str(call.amount_in),
            "token_in": call.token_in,
            "token_out": call.token_out,
            "pools": list(call.pools),
            # Decimal, not hex: each is a packed word and a reader has to be
            # able to shift it, not just paste it back.
            "params": [str(word) for word in call.params],
            "tokens": list(call.tokens),
            "set_approvals": call.set_approvals,
            "receiver": call.receiver,
            "min_out": str(call.min_out),
            # What the per-leg minimum rates alone promise, which is the number
            # a caller is actually signing for.
            "quoted_out": str(call.quoted_out),
            "guaranteed_out": str(call.guaranteed_out),
            "guaranteed_out_human": format_units(call.guaranteed_out, dst_dec),
            "tolerance_bp": round(call.tolerance_bp, 4),
            "unbounded_legs": list(call.unbounded),
        }

    by_id = {arc.id: arc for arc in result.arcs}
    for index, realized in enumerate(route.legs):
        arc = by_id.get(realized.arc_id or "")
        entry: dict[str, Any] = {
            "index": index,
            "kind": realized.kind.name,
            "target": realized.target,
            "token_in": realized.token_in,
            "token_out": realized.token_out,
            "symbol_in": nodes.symbol(realized.token_in),
            "symbol_out": nodes.symbol(realized.token_out),
            "amount_in": str(realized.amount_in),
            "amount_out": str(realized.amount_out),
            "amount_in_human": format_units(
                realized.amount_in, nodes.decimals(realized.token_in)
            ),
            "amount_out_human": format_units(
                realized.amount_out, nodes.decimals(realized.token_out)
            ),
            "src_slot": realized.leg.src_slot,
            "dst_slot": realized.leg.dst_slot,
            "bps": realized.leg.bps,
            "share_of_node": round(realized.share_of_node, 6),
            "is_conversion": realized.is_conversion,
            "theta": realized.theta,
            "modelled": realized.modelled,
        }
        if arc is not None:
            entry["pool_name"] = arc.note
            entry["arc_id"] = arc.id
            entry["i"], entry["j"] = arc.i, arc.j
            entry["arc"] = {
                "a": arc.a,
                "B": arc.B,
                "G": arc.G,
                "R": arc.resistance,
                "eps": arc.eps,
                "cap": None if arc.cap == float("inf") else arc.cap,
                "theta": realized.theta,
                "drift": arc.drift,
                "eta": None if arc.eta != arc.eta else arc.eta,  # NaN -> null
                "convex_flag": arc.convex_flag,
                "clamped": arc.clamped,
                "flag_reason": arc.flag_reason.value,
                "calib_delta": arc.calib_delta,
                "tvl_usd": arc.tvl_usd,
            }
        payload["legs"].append(entry)

    for token, slot in sorted(route.slots.items(), key=lambda kv: kv[1]):
        node = route.node_of_slot.get(slot, 0)
        payload["nodes"].append(
            {
                "slot": slot,
                "node": node,
                "token": token,
                "symbol": nodes.symbol(token),
                "u": route.potentials.get(node),
                "merged": nodes.tokens_of[node],
            }
        )
    return payload
