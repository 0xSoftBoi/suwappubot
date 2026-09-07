"""Terminal rendering of a `Diagram`.

Drawn as a circuit rather than a Sankey, which means three things are always
visible:

* every element is a **diode in series with a resistor** (`>|` and `-/\\/\\-`),
  because the loss decomposition `eps*psi + psi^2/2G` is the whole model: the
  linear term is the fee, the quadratic term is price impact;
* node **potentials** `u` are printed on each bus.  They come free from the same
  solve, and at the optimum every active branch drops the same total potential,
  so a reader can sanity-check the split by eye;
* a favourably dislocated pool (`eps < 0`) is marked as a **battery**, because
  the router being *paid* to route through a pool is worth seeing.
"""

from __future__ import annotations

import shutil

from .rendermodel import Diagram, ElementView

UNICODE = {
    "bus": "═",
    "tee": "├",
    "last": "└",
    "pipe": "│",
    "arrow": "▶",
    "diode": "▷|",
    "resistor": "/\\/\\/\\",
    "dash": "─",
    "tl": "╔", "tr": "╗", "bl": "╚", "br": "╝", "h": "═", "v": "║",
    "ok": "✔", "bad": "✘", "warn": "•",
}
ASCII = {
    "bus": "=",
    "tee": "+",
    "last": "\\",
    "pipe": "|",
    "arrow": ">",
    "diode": ">|",
    "resistor": "-vvv-",
    "dash": "-",
    "tl": "+", "tr": "+", "bl": "+", "br": "+", "h": "=", "v": "|",
    "ok": "OK", "bad": "XX", "warn": "*",
}

CIRCLED = "⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\x1b[32m", "\x1b[31m", "\x1b[33m", "\x1b[2m", "\x1b[1m", "\x1b[0m",
)


def _index(k: int, unicode: bool) -> str:
    if unicode and 0 < k < len(CIRCLED):
        return CIRCLED[k]
    return f"({k})"


def render(
    diagram: Diagram,
    *,
    unicode: bool = True,
    color: bool = False,
    width: int | None = None,
    legend: bool = True,
) -> str:
    glyph = UNICODE if unicode else ASCII
    width = width or min(max(shutil.get_terminal_size((100, 24)).columns, 72), 110)
    paint = _painter(color)
    out: list[str] = []

    out.extend(_header(diagram, glyph, width, paint, unicode))
    out.append("")

    for slot in diagram.order:
        bus = diagram.bus(slot)
        out.append(_bus_line(bus, glyph, width, paint))
        elements = diagram.elements_from(slot)
        if not elements:
            out.append("")
            continue
        out.append(f"   {glyph['pipe']}")
        for k, element in enumerate(elements):
            last = k == len(elements) - 1
            out.extend(_element_block(element, diagram, glyph, last, paint, unicode))
        out.append("")

    out.extend(_ledger(diagram, paint))
    out.extend(_diagnostics(diagram, paint, glyph))
    out.extend(_candidates(diagram, paint))
    out.extend(_warnings(diagram, paint, glyph))
    if legend:
        out.append("")
        out.append(_legend(glyph, paint))
    return "\n".join(out)


# ------------------------------------------------------------------ pieces


def _painter(color: bool):
    def paint(text: str, code: str) -> str:
        return f"{code}{text}{RESET}" if color else text

    return paint


def _header(diagram: Diagram, glyph, width, paint, unicode) -> list[str]:
    inner = width - 2
    lines = [glyph["tl"] + glyph["h"] * inner + glyph["tr"]]
    for text in (diagram.title, diagram.subtitle):
        if text:
            # Truncate, don't just pad: a title longer than the box used to run
            # past the right border and break the frame, and the title carries
            # a growing amount -- amounts, a rate, and now the price impact.
            line = f" {text}"
            if len(line) > inner:
                line = line[: max(inner - 1, 0)] + "…" if inner else ""
            lines.append(glyph["v"] + line.ljust(inner) + glyph["v"])
    mark = (
        paint(f"{glyph['ok']} certificate", GREEN)
        if diagram.certificate
        else paint(f"{glyph['bad']} certificate: {diagram.certificate_reason or 'not proven'}", RED)
    )
    # +len of the colour codes, which do not occupy columns
    pad = inner - len(f" {mark}") + (len(mark) - len(_strip(mark)))
    lines.append(glyph["v"] + f" {mark}" + " " * max(pad, 0) + glyph["v"])
    lines.append(glyph["bl"] + glyph["h"] * inner + glyph["br"])
    return lines


def _strip(text: str) -> str:
    out, skip = [], False
    for ch in text:
        if ch == "\x1b":
            skip = True
        elif skip and ch == "m":
            skip = False
        elif not skip:
            out.append(ch)
    return "".join(out)


def _bus_line(bus, glyph, width, paint) -> str:
    label = f"[ {bus.symbol} ]"
    if bus.merged_with:
        label = f"[ {bus.symbol} = {'/'.join(bus.merged_with)} ]"
    tail = f" {bus.amount}"
    if bus.is_verified:
        tail += " quoted"
    if bus.potential_bp is not None:
        tail += (
            "   u = ground"
            if abs(bus.potential_bp) < 1e-9
            else f"   u {bus.potential_bp:+.2f} bp"
        )
    fill = max(width - len(label) - len(tail) - 4, 3)
    line = f" {glyph['bus'] * 2}{label}{glyph['bus'] * fill}{tail}"
    return paint(line, BOLD)


def _element_block(
    element: ElementView, diagram: Diagram, glyph, last: bool, paint, unicode
) -> list[str]:
    branch = glyph["last"] if last else glyph["tee"]
    cont = " " if last else glyph["pipe"]
    number = _index(element.index, unicode)

    symbol = glyph["diode"] if not element.is_conversion else "=="
    resistor = glyph["resistor"] if not element.is_conversion else glyph["dash"] * 6
    if element.is_battery:
        symbol = paint("↯|" if unicode else "!|", GREEN)

    share = f"{element.share_pct:5.1f}%" if element.share_pct < 99.95 else " 100%"
    head = (
        f"   {branch}{glyph['dash']}{number} {share} {glyph['dash']} "
        f"{symbol}{glyph['dash']}{resistor}{glyph['dash']}{glyph['arrow']} "
    )
    name = paint(element.label, BOLD)
    flags = ""
    if element.flags:
        flags = "  " + paint(" ".join(element.flags), YELLOW)
    lines = [head + name + flags]

    dest = diagram.bus(element.dst_slot)
    src = diagram.bus(element.src_slot)
    indent = f"   {cont}         "
    lines.append(
        indent + f"{element.amount_in} {src.symbol} {glyph['arrow']} "
        f"{element.amount_out} {dest.symbol}"
    )
    if element.is_conversion:
        lines.append(indent + paint("zero-resistance node merge, 0 bp", DIM))
    else:
        stats = (
            f"eps {element.eps_bp:+.2f} bp   R {element.impact_bp:.2f} bp   "
            f"theta {element.theta_pct:.2f}%"
            if element.modelled else
            # The model-free candidates carry no fit, so there is no eps and no
            # resistance to report.  `theta` is real either way -- it is the
            # amount over the pool's own reserve -- and it is the number that
            # says how far outside anything measured this leg sits.
            f"no model: rate from the price fit   theta {element.theta_pct:.2f}%"
        )
        lines.append(indent + paint(stats, DIM))
        lines.append(indent + paint(f"{element.target}", DIM))
    if not last:
        lines.append(f"   {glyph['pipe']}")
    return lines


def _ledger(diagram: Diagram, paint) -> list[str]:
    if not diagram.ledger:
        return []
    rows = [
        ("diode    sum eps*psi", diagram.ledger.get("fee_bp")),
        ("resistor sum psi^2/2G", diagram.ledger.get("impact_bp")),
        ("modelled total", diagram.ledger.get("total_bp")),
        ("verified on-chain", diagram.ledger.get("verified_bp")),
    ]
    out = [paint("  loss ledger", BOLD)]
    for label, value in rows:
        if value is None:
            continue
        out.append(f"    {label:<24} {value:8.2f} bp")
    impact = diagram.ledger.get("price_impact_bp")
    if impact is not None:
        share = diagram.ledger.get("impact_fraction", 0.0)
        out.append(f"    {'price impact':<24} {impact:8.2f} bp"
                   f"   vs the same route at {share * 100:.0f}% of size")
    delta = diagram.ledger.get("model_delta_bp")
    if delta is not None:
        note = "model is conservative" if delta >= 0 else paint("MODEL BEAT REALITY", RED)
        out.append(f"    {'verified - modelled':<24} {delta:+8.2f} bp   {note}")
    return [*out, ""]


def _diagnostics(diagram: Diagram, paint, glyph) -> list[str]:
    if not diagram.diagnostics:
        return []
    out = [paint("  diagnostics", BOLD)]
    items = list(diagram.diagnostics.items())
    for k in range(0, len(items), 2):
        pair = items[k : k + 2]
        cells = [f"{name:<18} {value}" for name, value in pair]
        out.append("    " + "   ".join(f"{c:<34}" for c in cells).rstrip())
    return [*out, ""]


def _candidates(diagram: Diagram, paint) -> list[str]:
    if not diagram.candidates:
        return []
    out = [paint("  candidates", BOLD)]
    for entry in diagram.candidates:
        mark = "  " if entry.get("rank") != 1 else paint("> ", GREEN)
        status = entry.get("status", "")
        value = entry.get("out", "")
        delta = entry.get("delta_bp")
        suffix = "" if delta is None else f"   {delta:+.2f} bp"
        # What the route is charged for the chance one of its pools moves past
        # its own minimum-out before inclusion.  Only shown when it is not
        # essentially certain, so a safe route stays uncluttered.
        survival = entry.get("survival")
        if survival is not None and survival < 0.9995:
            suffix += f"   lands {survival * 100:.1f}%"
        out.append(f"    {mark}{entry.get('label', ''):<28} {value:>20}  {status}{suffix}")
    return [*out, ""]


def _warnings(diagram: Diagram, paint, glyph) -> list[str]:
    if not diagram.warnings:
        return []
    out = [paint("  warnings", BOLD)]
    out.extend(f"    {glyph['warn']} {w}" for w in diagram.warnings)
    return [*out, ""]


def _legend(glyph, paint) -> str:
    return paint(
        f"  legend  {glyph['diode']} diode (fee eps)   "
        f"{glyph['resistor']} resistor (impact psi/G)   "
        f"== node merge\n"
        f"          per-leg amounts are modelled; totals marked 'quoted' come "
        f"from the chain",
        DIM,
    )
