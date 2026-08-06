#!/usr/bin/env python3
"""Generate Suwappu Research Report 01 from the released USDT0 evidence bundle.

The report is intentionally data-backed: headline figures and charts are read from
the same public JSON/CSV artifacts shipped with the working paper. Narrative claims
that are not derivable from those files are limited to findings documented in the
canonical paper at public/research/replication/papers/usdt0-collateral-reconciliation.md.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


SHOWCASE = Path(__file__).resolve().parents[1]
DATA = SHOWCASE / "public" / "research" / "replication" / "data"
OUTPUT = (
    SHOWCASE
    / "public"
    / "research"
    / "reports"
    / "accounting-for-an-omnichain-dollar.pdf"
)
ART = (
    SHOWCASE
    / "public"
    / "research"
    / "reports"
    / "omnichain-dollar-bank-cover-art.jpg"
)

W, H = A4
M = 46

INK = HexColor("#17324A")
INK_2 = HexColor("#294A61")
MUTED = HexColor("#667B87")
PALE = HexColor("#EEF3F1")
PAPER = HexColor("#FBFAF5")
WHITE = HexColor("#FFFFFF")
ORANGE = HexColor("#E58D2B")
ORANGE_DARK = HexColor("#B75E12")
TEAL = HexColor("#2F8C84")
TEAL_PALE = HexColor("#DCEEEA")
RED = HexColor("#A54D42")
HAIR = HexColor("#D6DEDF")
HAIR_DARK = HexColor("#B7C3C7")

SERIF = "Times-Roman"
SERIF_BOLD = "Times-Bold"
SANS = "Helvetica"
SANS_BOLD = "Helvetica-Bold"
MONO = "Courier"
MONO_BOLD = "Courier-Bold"

REPORT_URL = "https://suwappu.bot/research/omnichain-dollar-collateral"
REPLICATION_URL = "https://suwappu.bot/research/replication"


def load_json(name: str) -> dict:
    with (DATA / name).open(encoding="utf-8") as handle:
        return json.load(handle)


def load_timeseries() -> list[dict[str, str]]:
    with (DATA / "usdt0_timeseries.csv").open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


HEAD = load_json("head_snapshot_20260801.json")
PREDICATE = load_json("polygon_predicate_prebreak.json")
BUFFER = load_json("buffer_dynamics.json")
SERIES = load_timeseries()


def corrected_series() -> list[dict[str, float | str]]:
    predicate = PREDICATE["balances_usd"]
    rows: list[dict[str, float | str]] = []
    for row in SERIES:
        collateral = float(row["collateral"])
        liabilities = float(row["liabilities"])
        extra = float(predicate.get(row["date"], 0.0))
        corrected_collateral = collateral + extra
        rows.append(
            {
                "date": row["date"],
                "published_ratio": float(row["ratio"]),
                "corrected_ratio": corrected_collateral / liabilities,
                "corrected_gap": corrected_collateral - liabilities,
            }
        )
    return rows


CORRECTED = corrected_series()


def money(value: float, decimals: int = 1) -> str:
    value = float(value)
    magnitude = abs(value)
    if magnitude >= 1_000_000_000:
        return f"${value / 1_000_000_000:.{decimals}f}B"
    if magnitude >= 1_000_000:
        return f"${value / 1_000_000:.{decimals}f}M"
    if magnitude >= 1_000:
        return f"${value / 1_000:.{decimals}f}K"
    return f"${value:.0f}"


def set_fill(c: canvas.Canvas, color: Color) -> None:
    c.setFillColor(color)


def page_bg(c: canvas.Canvas) -> None:
    set_fill(c, PAPER)
    c.rect(0, 0, W, H, stroke=0, fill=1)


def line(c: canvas.Canvas, y: float, x0: float = M, x1: float = W - M, color: Color = HAIR) -> None:
    c.setStrokeColor(color)
    c.setLineWidth(0.6)
    c.line(x0, y, x1, y)


def label(c: canvas.Canvas, text: str, x: float, y: float, color: Color = MUTED) -> None:
    set_fill(c, color)
    c.setFont(MONO_BOLD, 7.3)
    c.drawString(x, y, text.upper())


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def paragraph(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    font: str = SANS,
    size: float = 9.4,
    leading: float = 13.4,
    color: Color = INK_2,
) -> float:
    set_fill(c, color)
    c.setFont(font, size)
    for row in wrap(text, font, size, width):
        c.drawString(x, y, row)
        y -= leading
    return y


def heading(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    size: float = 27,
    leading: float = 28,
) -> float:
    set_fill(c, INK)
    c.setFont(SERIF, size)
    for row in wrap(text, SERIF, size, width):
        c.drawString(x, y, row)
        y -= leading
    return y


def report_header(c: canvas.Canvas, page: int, section: str) -> None:
    label(c, "Suwappu Research", M, H - 31, INK)
    c.setFont(MONO, 7)
    set_fill(c, MUTED)
    c.drawRightString(W - M, H - 31, f"REPORT 01 / {section.upper()} / {page:02d}")
    line(c, H - 42)


def report_footer(c: canvas.Canvas, page: int) -> None:
    line(c, 31)
    c.setFont(MONO, 6.5)
    set_fill(c, MUTED)
    c.drawString(M, 18, "INSTITUTIONAL RESEARCH / NOT A RESERVE ATTESTATION")
    c.drawRightString(W - M, 18, f"SUWAPPU.BOT/RESEARCH  /  {page:02d}")


def finish_page(c: canvas.Canvas, page: int) -> None:
    report_footer(c, page)
    c.showPage()


def stat(c: canvas.Canvas, value: str, description: str, x: float, y: float, width: float) -> None:
    set_fill(c, INK)
    c.setFont(SANS_BOLD, 27)
    c.drawString(x, y, value)
    paragraph(c, description, x, y - 21, width, font=MONO, size=6.6, leading=9, color=MUTED)


def draw_series_chart(
    c: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    cover: bool = False,
) -> None:
    ymin, ymax = 0.48, 1.20
    rows = CORRECTED
    n = len(rows)

    def px(i: int) -> float:
        return x + i / (n - 1) * width

    def py(value: float) -> float:
        return y + (value - ymin) / (ymax - ymin) * height

    for level in (0.5, 0.75, 1.0):
        c.setStrokeColor(WHITE if cover else HAIR)
        c.setLineWidth(0.45)
        c.line(x, py(level), x + width, py(level))
        c.setFont(MONO, 6.2)
        set_fill(c, WHITE if cover else MUTED)
        c.drawRightString(x - 7, py(level) - 2, f"{level:.2f}x")

    c.setStrokeColor(Color(1, 1, 1, alpha=0.42) if cover else RED)
    c.setLineWidth(1.0)
    c.setDash(3, 2)
    path = c.beginPath()
    for i, row in enumerate(rows):
        xp = px(i)
        yp = py(float(row["published_ratio"]))
        if i == 0:
            path.moveTo(xp, yp)
        else:
            path.lineTo(xp, yp)
    c.drawPath(path)

    c.setDash()
    c.setStrokeColor(ORANGE if cover else TEAL)
    c.setLineWidth(2.0 if cover else 1.7)
    path = c.beginPath()
    for i, row in enumerate(rows):
        xp = px(i)
        yp = py(float(row["corrected_ratio"]))
        if i == 0:
            path.moveTo(xp, yp)
        else:
            path.lineTo(xp, yp)
    c.drawPath(path)

    set_fill(c, WHITE if cover else MUTED)
    c.setFont(MONO, 6.1)
    c.drawString(x, y - 13, "JUL 2025")
    c.drawRightString(x + width, y - 13, "JUL 2026")


def draw_buffer_chart(c: canvas.Canvas, x: float, y: float, width: float, height: float) -> None:
    rows = CORRECTED
    values = [float(r["corrected_gap"]) / 1_000_000 for r in rows]
    max_value = max(values)

    def px(i: int) -> float:
        return x + i / (len(rows) - 1) * width

    def py(value: float) -> float:
        return y + value / max_value * height

    for level in (0, 250, 500, 750):
        c.setStrokeColor(HAIR)
        c.setLineWidth(0.45)
        c.line(x, py(level), x + width, py(level))
        set_fill(c, MUTED)
        c.setFont(MONO, 6)
        c.drawRightString(x - 7, py(level) - 2, f"${level}M")

    path = c.beginPath()
    path.moveTo(px(0), y)
    for i, value in enumerate(values):
        path.lineTo(px(i), py(value))
    path.lineTo(px(len(values) - 1), y)
    path.close()
    set_fill(c, TEAL_PALE)
    c.setStrokeColor(TEAL_PALE)
    c.drawPath(path, fill=1, stroke=0)

    c.setStrokeColor(TEAL)
    c.setLineWidth(1.7)
    path = c.beginPath()
    for i, value in enumerate(values):
        if i == 0:
            path.moveTo(px(i), py(value))
        else:
            path.lineTo(px(i), py(value))
    c.drawPath(path)

    peak_i = values.index(max_value)
    c.setFillColor(ORANGE)
    c.circle(px(peak_i), py(max_value), 2.8, stroke=0, fill=1)
    c.circle(px(len(values) - 1), py(values[-1]), 2.8, stroke=0, fill=1)
    c.setFont(MONO_BOLD, 6.2)
    set_fill(c, INK)
    c.drawString(px(peak_i) + 6, py(max_value) - 2, "$760.3M MAX")
    c.drawRightString(x + width, y + 11, "$5.1M PANEL END")
    set_fill(c, MUTED)
    c.setFont(MONO, 6.1)
    c.drawString(x, y - 13, "JUL 2025")
    c.drawRightString(x + width, y - 13, "JUL 2026")


def draw_chain_bars(c: canvas.Canvas, x: float, y: float, width: float) -> float:
    supplies = sorted(HEAD["supplies"].items(), key=lambda item: item[1], reverse=True)
    top = supplies[:8]
    other = sum(value for _, value in supplies[8:])
    rows = top + [("Other 12 legs", other)]
    maximum = max(value for _, value in rows)
    bar_x = x + 108
    bar_w = width - 166
    for name, value in rows:
        set_fill(c, INK)
        c.setFont(SANS, 7.5)
        c.drawString(x, y, name)
        set_fill(c, PALE)
        c.rect(bar_x, y - 1, bar_w, 8, stroke=0, fill=1)
        set_fill(c, TEAL if name != "Other 12 legs" else ORANGE)
        c.rect(bar_x, y - 1, bar_w * value / maximum, 8, stroke=0, fill=1)
        set_fill(c, MUTED)
        c.setFont(MONO, 6.6)
        c.drawRightString(x + width, y, money(value))
        y -= 24
    return y


def bullet(c: canvas.Canvas, number: str, title: str, body: str, x: float, y: float, width: float) -> float:
    c.setFillColor(ORANGE)
    c.circle(x + 11, y - 2, 11, stroke=0, fill=1)
    set_fill(c, WHITE)
    c.setFont(MONO_BOLD, 6.8)
    c.drawCentredString(x + 11, y - 4, number)
    set_fill(c, INK)
    c.setFont(SANS_BOLD, 10)
    c.drawString(x + 36, y + 2, title)
    y2 = paragraph(c, body, x + 36, y - 14, width - 36, size=8.4, leading=11.4)
    return y2 - 14


def cover_art(c: canvas.Canvas, x: float, y: float, width: float, height: float) -> None:
    """Draw the cover artwork edge-to-edge inside a clipped publication window."""
    image = ImageReader(str(ART))
    image_width, image_height = image.getSize()
    scale = max(width / image_width, height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    c.saveState()
    clip = c.beginPath()
    clip.rect(x, y, width, height)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(
        image,
        x + (width - draw_width) / 2,
        y + (height - draw_height) / 2,
        width=draw_width,
        height=draw_height,
        mask="auto",
    )
    c.restoreState()


def page_1(c: canvas.Canvas) -> None:
    page_bg(c)
    label(c, "Suwappu Research", M, H - 44, INK)
    c.setFont(MONO, 7)
    set_fill(c, MUTED)
    c.drawRightString(W - M, H - 44, "REPORT 01 / AUGUST 2026")
    line(c, H - 56)

    label(c, "Payments / Treasury / Digital Assets", M, H - 98, ORANGE_DARK)
    y = heading(c, "Accounting for an Omnichain Dollar", M, H - 139, W - 2 * M, size=42, leading=43)
    y -= 12
    paragraph(
        c,
        "USDT0 reserve reconciliation: observed backing, accounting perimeter, and monitoring implications for banks.",
        M,
        y,
        430,
        font=SANS,
        size=12.4,
        leading=16,
        color=INK_2,
    )

    label(c, "Public-state conclusion", M, 502, INK)
    paragraph(
        c,
        "Observed collateral and documented direct liabilities reconcile to 1.0003x. The measured difference is about three basis points; this report does not treat it as a reserve cushion.",
        M,
        482,
        W - 2 * M,
        font=SANS_BOLD,
        size=9.1,
        leading=12,
        color=INK,
    )

    cover_art(c, 0, 154, W, 286)

    label(c, "Tsolmondorj Natsagdorj / Suwappu Research", M, 116, INK)
    paragraph(
        c,
        "Working paper revised 1 August 2026. Report published 6 August 2026.",
        M,
        96,
        360,
        font=MONO,
        size=7,
        leading=10,
        color=MUTED,
    )
    c.setFont(MONO_BOLD, 7)
    set_fill(c, ORANGE_DARK)
    c.drawRightString(W - M, 96, "SUWAPPU.BOT/RESEARCH")
    c.linkURL(REPORT_URL, (W - M - 150, 84, W - M, 106), relative=0)
    c.showPage()


def page_2(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 2, "Executive summary")
    label(c, "Banking takeaway", M, H - 84, ORANGE_DARK)
    y = heading(
        c,
        "Observed backing reconciles to par. That is not the same as a reserve attestation.",
        M,
        H - 118,
        W - 2 * M,
        size=31,
        leading=32,
    )
    y -= 18
    paragraph(
        c,
        "At 01:53 UTC on 1 August 2026, the verified Ethereum lockbox held $3.4536B of USDT against $3.4526B of directly measured USDT0 liabilities across the issuer-documented perimeter. Observed coverage was 1.0003x. The $1.03M arithmetic difference - about three basis points - is smaller than risks the balance read cannot observe, so we classify the result as reconciled to par rather than excess reserve coverage.",
        M,
        y,
        W - 2 * M,
        size=10.2,
        leading=14.5,
    )

    line(c, 510)
    stat(c, money(HEAD["lockbox"], 4), "OBSERVED RESERVE BALANCE", M, 470, 135)
    stat(c, f"{HEAD['ratio']:.4f}x", "OBSERVED COVERAGE RATIO", 225, 470, 150)
    stat(c, "~3bp", "MEASURED DIFFERENCE / NOT A CUSHION", 410, 470, 130)
    line(c, 405)

    col = (W - 2 * M - 34) / 2
    label(c, "What a bank can automate", M, 376, INK)
    y1 = paragraph(
        c,
        "The public-state control can read the canonical reserve account, aggregate every documented direct liability leg, version the accounting perimeter and alert on mismatch. The 12-month panel provides 183 block-aligned observations; the current head check covers all 20 documented direct liability legs in one session.",
        M,
        354,
        col,
        size=9.1,
        leading=13.2,
    )
    label(c, "What still requires external evidence", M + col + 34, 376, INK)
    paragraph(
        c,
        "A token balance does not establish whether reserves are encumbered, whether net mint/burn messages are in flight, or whether the deployment registry itself is complete. A bank also needs governance around the address map and independent evidence for the legal and operational status of reserves. At a 3bp margin, these are decision-relevant, not footnotes.",
        M + col + 34,
        354,
        col,
        size=9.1,
        leading=13.2,
    )
    label(c, "Control conclusion", M, max(178, y1 - 23), ORANGE_DARK)
    paragraph(
        c,
        "Use public-state reconciliation as a continuously repeatable first-line control. Treat registry governance, message state and reserve encumbrance as separate evidence requirements before relying on the asset for treasury, settlement or client-facing flows.",
        M,
        max(158, y1 - 43),
        W - 2 * M,
        font=SANS_BOLD,
        size=10.2,
        leading=14.2,
        color=INK,
    )
    finish_page(c, 2)


def page_3(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 3, "Model and data risk")
    label(c, "Control finding", M, H - 84, ORANGE_DARK)
    y = heading(c, "The two corrections are the control finding.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The first error created false excess coverage; the second created a false reserve shortfall. Both came from reference-data and perimeter failures that a bank control framework should catch before a ratio reaches a risk committee.",
        M,
        y - 10,
        455,
        size=9.4,
        leading=13.4,
    )

    top = 565
    cols = [M, 105, 280, 395, W - M]
    headers = ["VERSION", "REPORTED SIGNAL", "INTERPRETATION", "CONTROL FAILURE"]
    label(c, headers[0], cols[0], top, MUTED)
    label(c, headers[1], cols[1], top, MUTED)
    label(c, headers[2], cols[2], top, MUTED)
    label(c, headers[3], cols[3], top, MUTED)
    line(c, top - 12)
    rows = [
        ("V1", "1.042 endpoint", "False surplus", "Liability perimeter truncated"),
        ("V2", "0.513-0.588", "False shortfall", "Wrong Polygon collateral address"),
        ("V3", "1.0003 head", "Par / ~3bp", "Complete documented universe"),
    ]
    yy = top - 44
    for version, ratio, gap, issue in rows:
        set_fill(c, ORANGE if version == "V3" else INK)
        c.setFont(MONO_BOLD, 8.5)
        c.drawString(cols[0], yy, version)
        set_fill(c, INK)
        c.setFont(SANS_BOLD, 9)
        c.drawString(cols[1], yy, ratio)
        c.drawString(cols[2], yy, gap)
        paragraph(c, issue, cols[3], yy, cols[4] - cols[3], size=8, leading=10)
        line(c, yy - 18)
        yy -= 58

    label(c, "Control implications", M, 347, INK)
    yb = 318
    yb = bullet(
        c,
        "01",
        "Liability-perimeter governance",
        "V1 omitted $134.8M of liabilities. Completing the universe removed 96% of the reported buffer. Scope needs an owner, effective date, inclusion rule and completeness check.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "02",
        "Canonical-account governance",
        "V2's control address read $0.02 while the canonical Polygon predicate held $1.22B-$1.39B. In a monitoring system, that is a reference-data failure, not reserve deterioration.",
        M,
        yb,
        W - 2 * M,
    )
    bullet(
        c,
        "03",
        "Timestamp discipline",
        "Cross-chain balances need a common observation time. The panel resolves each chain to the target timestamp; the migration window is rescanned every six hours so settlement flow is not misread as reserve deficiency.",
        M,
        yb,
        W - 2 * M,
    )

    set_fill(c, PALE)
    c.rect(M, 69, W - 2 * M, 49, stroke=0, fill=1)
    label(c, "Operating rule", M + 14, 97, ORANGE_DARK)
    paragraph(
        c,
        "Treat the address registry as controlled reference data: version scope, canonical contracts, effective dates and containment relationships before calculating coverage.",
        M + 132,
        98,
        W - 2 * M - 148,
        font=SANS_BOLD,
        size=8.5,
        leading=11,
        color=INK,
    )
    finish_page(c, 3)


def page_4(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 4, "Reserve accounting")
    label(c, "Observed perimeter", M, H - 84, ORANGE_DARK)
    y = heading(c, "The measurable perimeter closes across twenty direct liability legs.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The observable accounting identity is straightforward: the verified Ethereum reserve balance should cover aggregate supply across the issuer-documented direct USDT0 deployments. HyperCore is verified as a sub-ledger of HyperEVM and is not double-counted; Tron and TON sit outside this perimeter as Legacy Mesh.",
        M,
        y - 10,
        470,
        size=9.2,
        leading=13.2,
    )

    set_fill(c, INK)
    c.roundRect(M, 530, W - 2 * M, 78, 5, stroke=0, fill=1)
    label(c, "1 Aug 2026 / 01:53 UTC", M + 18, 586, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SERIF, 20)
    c.drawString(M + 18, 555, "$3.4536B collateral  /  $3.4526B liabilities  =  1.0003x")

    label(c, "Direct liability perimeter", M, 496, INK)
    ybars = draw_chain_bars(c, M, 471, W - 2 * M)
    line(c, ybars + 8)
    set_fill(c, INK)
    c.setFont(SANS_BOLD, 9)
    c.drawString(M, ybars - 16, "20 legs directly measured")
    c.drawString(220, ybars - 16, "0 excluded")
    c.drawString(325, ybars - 16, "1 verified sub-ledger")
    c.setFont(MONO, 6.4)
    set_fill(c, MUTED)
    c.drawRightString(W - M, ybars - 16, "HEAD_SNAPSHOT_20260801.JSON")

    box_y = 83
    set_fill(c, TEAL_PALE)
    c.rect(M, box_y, W - 2 * M, 90, stroke=0, fill=1)
    label(c, "Interpretation", M + 16, box_y + 63, INK)
    paragraph(
        c,
        "For a bank control, 1.0003x should be classified as reconciled to par within measurement tolerance, not as positive excess reserves. The head reads span roughly a minute rather than one aligned block and do not constitute a reserve attestation.",
        M + 16,
        box_y + 43,
        W - 2 * M - 32,
        font=SANS_BOLD,
        size=8.5,
        leading=11.4,
        color=INK,
    )
    finish_page(c, 4)


def page_5(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 5, "Reference-data event")
    label(c, "Why the shortfall disappeared", M, H - 84, ORANGE_DARK)
    y = heading(c, "$1.3B of apparent reserve deficiency was address-mapping risk.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "Before 27 August 2025, Polygon PoS USDT backing sat in the canonical Polygon predicate rather than the USDT0 lockbox. V2 checked a different address and converted an address-map failure into an apparent 41%-49% reserve deficiency. For a bank monitor, wrong reference data can be as consequential as a wrong balance.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    draw_series_chart(c, M + 36, 455, W - 2 * M - 36, 115)
    c.setFont(MONO, 6.2)
    set_fill(c, MUTED)
    c.drawString(M + 36, 425, "DASHED: V2 PUBLISHED     SOLID: CANONICAL PREDICATE INCLUDED")
    c.setFont(SANS_BOLD, 8.5)
    set_fill(c, TEAL)
    c.drawRightString(W - M, 425, "0 / 183 CORRECTED OBSERVATIONS BELOW PAR")

    line(c, 392)
    label(c, "Six-hour migration bracket / 27 Aug 2025", M, 367, INK)
    figures = [
        ("-$1,358.8M", "CANONICAL PREDICATE"),
        ("+$1,258.6M", "ETHEREUM LOCKBOX"),
        ("-$98.1M", "ARBITRUM SUPPLY"),
        ("$2.1M", "RESIDUAL FLOW"),
    ]
    cell_w = (W - 2 * M) / 4
    for i, (value, caption) in enumerate(figures):
        xx = M + i * cell_w
        if i:
            c.setStrokeColor(HAIR)
            c.line(xx, 285, xx, 344)
        set_fill(c, INK)
        c.setFont(SANS_BOLD, 15.5)
        c.drawString(xx + (9 if i else 0), 324, value)
        paragraph(c, caption, xx + (9 if i else 0), 302, cell_w - 16, font=MONO, size=6.2, leading=8, color=MUTED)

    set_fill(c, PALE)
    c.rect(M, 160, W - 2 * M, 91, stroke=0, fill=1)
    label(c, "Control validation", M + 16, 225, ORANGE_DARK)
    paragraph(
        c,
        "The $1,358.8M predicate outflow matched Polygon supply at bracket open ($1,358.759M) to within about $82K - 0.006% of the flow. The issuer also announced the backing migration that day. Independent documentary evidence and chain state describe the same perimeter change.",
        M + 16,
        203,
        W - 2 * M - 32,
        size=8.8,
        leading=12,
    )
    label(c, "Lesson", M, 124, INK)
    paragraph(
        c,
        "Treat contract and address changes as governed reference-data events. Otherwise an accounting-boundary migration can look indistinguishable from a reserve impairment.",
        M,
        104,
        W - 2 * M,
        font=SANS_BOLD,
        size=9,
        leading=12,
        color=INK,
    )
    finish_page(c, 5)


def page_6(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 6, "Coverage dynamics")
    label(c, "Historical context", M, H - 84, ORANGE_DARK)
    y = heading(c, "Coverage moved from a visible cushion to measurement tolerance.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "Historical corrected coverage stayed above par, but the measured excess was not stable: the buffer share ranged from roughly 15bp to 18.7% of liabilities. By the end of the sample, excess coverage had compressed to measurement tolerance. For a bank, the endpoint matters more than the historical maximum.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    draw_buffer_chart(c, M + 36, 445, W - 2 * M - 36, 130)
    c.setFont(MONO, 6.2)
    set_fill(c, MUTED)
    c.drawString(M + 36, 413, "CORRECTED COLLATERAL MINUS DOCUMENTED LIABILITIES")

    line(c, 382)
    end = BUFFER["buffer_post_break"]["terminal_drawdown"]
    stats = [
        (money(BUFFER["buffer_post_break"]["buffer_max"]["buffer"]), "MAX / 15 DEC 2025"),
        (money(end["buffer_2025_12_31"]), "31 DEC 2025"),
        (money(end["buffer_2026_07_17"]), "17 JUL 2026"),
        (money(end["buffer_2026_07_25"]), "25 JUL / PANEL END"),
    ]
    cell_w = (W - 2 * M) / 4
    for i, (value, caption) in enumerate(stats):
        xx = M + i * cell_w
        set_fill(c, INK)
        c.setFont(SANS_BOLD, 17)
        c.drawString(xx, 345, value)
        paragraph(c, caption, xx, 324, cell_w - 11, font=MONO, size=6.2, leading=8, color=MUTED)

    set_fill(c, INK)
    c.rect(M, 176, W - 2 * M, 101, stroke=0, fill=1)
    label(c, "Final eight days", M + 18, 248, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SANS_BOLD, 15)
    c.drawString(M + 18, 218, "-$192.9M collateral  vs  -$75.7M liabilities")
    paragraph(
        c,
        "About $117M more collateral left than liabilities declined. The panel buffer fell to $5.1M; the complete-universe head check six days later measured $1.03M.",
        M + 18,
        197,
        W - 2 * M - 36,
        size=8.3,
        leading=11,
        color=WHITE,
    )

    label(c, "Interpretation", M, 137, INK)
    paragraph(
        c,
        "For underwriting, historical excess coverage should not be carried forward as a current risk buffer. The relevant state is the endpoint: observed coverage is effectively par, and unobservable exposures are larger than the measured difference.",
        M,
        116,
        W - 2 * M,
        font=SANS_BOLD,
        size=9.3,
        leading=12.4,
        color=INK,
    )
    finish_page(c, 6)


def compare_row(
    c: canvas.Canvas,
    y: float,
    left_title: str,
    left_body: str,
    right_title: str,
    right_body: str,
) -> float:
    col = (W - 2 * M - 30) / 2
    set_fill(c, TEAL)
    c.circle(M + 4, y + 3, 3, stroke=0, fill=1)
    set_fill(c, INK)
    c.setFont(SANS_BOLD, 9.3)
    c.drawString(M + 15, y, left_title)
    ly = paragraph(c, left_body, M + 15, y - 17, col - 15, size=8.2, leading=11.2)
    x2 = M + col + 30
    set_fill(c, RED)
    c.circle(x2 + 4, y + 3, 3, stroke=0, fill=1)
    set_fill(c, INK)
    c.setFont(SANS_BOLD, 9.3)
    c.drawString(x2 + 15, y, right_title)
    ry = paragraph(c, right_body, x2 + 15, y - 17, col - 15, size=8.2, leading=11.2)
    return min(ly, ry) - 24


def page_7(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 7, "Control perimeter")
    label(c, "Public-state check vs attestation", M, H - 84, ORANGE_DARK)
    y = heading(c, "The ledger can be reconciled; the reserve claim still needs off-chain evidence.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "Public chain state can support a repeatable first-line reserve control. It cannot, by itself, answer the legal and operational questions a bank needs before treating that control as proof of available reserves.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    label(c, "Automatable onchain control", M, 584, TEAL)
    label(c, "Requires additional evidence", M + 266, 584, RED)
    line(c, 570)
    yy = 539
    yy = compare_row(
        c,
        yy,
        "Collateral balance",
        "USDT balanceOf() on the verified Ethereum OAdapter lockbox.",
        "Asset encumbrance / legal claim",
        "A positive token balance does not establish that reserves are unencumbered, bankruptcy-remote, or senior to other claims.",
    )
    yy = compare_row(
        c,
        yy,
        "Documented token supply",
        "totalSupply() on each documented USDT0 deployment, with decimals and live contracts checked.",
        "Settlement state / messages in flight",
        "A point-in-time sum does not expose net mint or burn instructions moving between chains.",
    )
    yy = compare_row(
        c,
        yy,
        "Versioned accounting perimeter",
        "Twenty direct liability legs, plus an explicit HyperCore containment check; Tron and TON classified as Legacy Mesh.",
        "Registry completeness / governance",
        "The method verifies documented deployments; it cannot prove that the issuer registry omits nothing or that its change process is complete.",
    )

    set_fill(c, PALE)
    c.rect(M, 151, W - 2 * M, 112, stroke=0, fill=1)
    label(c, "Minimum evidence stack for a bank", M + 16, 235, INK)
    items = [
        "01  Versioned liability registry",
        "02  Canonical reserve accounts",
        "03  Net messages in flight",
        "04  Encumbrance / legal-status evidence",
        "05  Contract + migration change control",
        "06  Independent attestation / registry check",
    ]
    c.setFont(MONO, 7)
    set_fill(c, INK_2)
    for i, item in enumerate(items):
        col = i % 2
        row = i // 2
        c.drawString(M + 16 + col * 245, 211 - row * 23, item)

    label(c, "Threshold", M, 118, ORANGE_DARK)
    paragraph(
        c,
        "At ~3bp, any omitted, in-flight or encumbered position above $1.03M overwhelms the arithmetic difference. Escalation policy should reflect that scale.",
        M,
        98,
        W - 2 * M,
        font=SANS_BOLD,
        size=9.2,
        leading=12,
        color=INK,
    )
    finish_page(c, 7)


def page_8(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 8, "Bank control design")
    label(c, "Suggested operating model", M, H - 84, ORANGE_DARK)
    y = heading(c, "Automate the reconciliation; govern the evidence it cannot see.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The practical architecture is a layered control: public-state reconciliation for continuous observation, event-driven governance for perimeter changes, and external evidence for reserve conditions that token balances cannot establish.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    label(c, "Control layers", M, 579, INK)
    yb = 549
    yb = bullet(c, "01", "Daily public-state reconciliation", "Read canonical reserves and every documented direct liability leg; version the timestamp, address map and accounting perimeter; alert when a configured threshold is breached.", M, yb, W - 2 * M)
    yb = bullet(c, "02", "Event-driven perimeter controls", "Detect new deployments, migrations, upgrades, containment changes and registry revisions. Reverify contract identity, symbol, decimals and supply before inclusion.", M, yb, W - 2 * M)
    yb = bullet(c, "03", "External evidence overlay", "Pair the chain-state control with issuer or attestation evidence for encumbrance, registry completeness and message state; escalate when unobservable exposure can exceed the measured difference.", M, yb, W - 2 * M)

    label(c, "Independent audit trail", M, yb - 3, INK)
    file_y = yb - 27
    files = [
        ("data/usdt0_timeseries.csv", "183-row panel + retained wrong-address control"),
        ("data/polygon_predicate_prebreak.json", "canonical Polygon backing backfill"),
        ("data/head_snapshot_20260801.json", "complete-universe head measurement"),
        ("data/buffer_dynamics.json", "flow coupling + terminal drawdown"),
        ("code/collect_usdt0.py", "panel collection harness"),
        ("code/head_snapshot.py", "current-universe snapshot"),
    ]
    for path, desc in files:
        c.setFont(MONO_BOLD, 6.7)
        set_fill(c, ORANGE_DARK)
        c.drawString(M, file_y, path)
        c.setFont(SANS, 7.6)
        set_fill(c, MUTED)
        c.drawString(M + 208, file_y, desc)
        file_y -= 21

    set_fill(c, INK)
    c.rect(M, 71, W - 2 * M, 69, stroke=0, fill=1)
    label(c, "Open methodology and source data", M + 16, 116, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SANS_BOLD, 9)
    c.drawString(M + 16, 92, "suwappu.bot/research/replication")
    c.linkURL(REPLICATION_URL, (M + 15, 82, M + 260, 103), relative=0)
    finish_page(c, 8)


def page_9(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 9, "Banking implications")
    label(c, "Conclusion", M, H - 84, ORANGE_DARK)
    y = heading(c, "The underwriting upgrade is a controlled accounting perimeter.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The durable result is not the 1.0003x ratio. It is that a cross-chain dollar can be monitored as a defined set of reserve and liability accounts - provided the perimeter itself is governed like financial reference data and the off-chain evidence remains separate.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    yb = 569
    yb = bullet(
        c,
        "01",
        "For treasury and payments",
        "Use the public-state check as a repeatable control overlay, not an attestation. It can flag divergence or stale reference data before the asset is relied on for settlement or client-facing flows.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "02",
        "For risk and model governance",
        "Version the registry, address map and method. Treat contract migrations, new deployments and corrections as controlled model-data changes with an auditable history.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "03",
        "For issuers and infrastructure partners",
        "Publish a dated machine-readable registry of each liability leg, backing account, containment relationship and migration. This reduces operational and model risk for counterparties.",
        M,
        yb,
        W - 2 * M,
    )

    line(c, yb + 5)
    label(c, "Disclosures", M, yb - 20, INK)
    yd = paragraph(
        c,
        "This report is research, not a reserve attestation, audit opinion or investment recommendation. Suwappu builds cross-chain execution infrastructure and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. No directional position informed this analysis. Tether, Everdawn Labs, and other named parties did not review the work before publication. All inputs are public chain state or cited public documents. The working paper is canonical where this report and the paper differ.",
        M,
        yb - 41,
        W - 2 * M,
        size=7.7,
        leading=10.5,
        color=MUTED,
    )

    label(c, "Selected sources", M, yd - 10, INK)
    sources = [
        "USDT0 technical documentation: deployments and Legacy Mesh (accessed 31 Jul 2026)",
        "USDT0, Polygon USDT Now Upgraded to USDT0 (27 Aug 2025)",
        "Polygon PoS Bridge documentation: canonical ERC20 predicate (accessed 31 Jul 2026)",
        "Everdawn Labs: USDT0 audit reports; Chaos Labs: USDT0 Mechanism Design Review (2025)",
        "Newey-West (1987); Politis-Romano (1994); Bai-Perron (1998)",
    ]
    ys = yd - 29
    c.setFont(SANS, 6.7)
    set_fill(c, MUTED)
    for source in sources:
        c.drawString(M, ys, source)
        ys -= 13

    set_fill(c, INK)
    c.rect(M, 52, W - 2 * M, 54, stroke=0, fill=1)
    label(c, "Working paper + evidence bundle", M + 16, 83, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SANS_BOLD, 8.2)
    c.drawRightString(W - M - 16, 82, "SUWAPPU.BOT/RESEARCH/REPLICATION")
    c.linkURL(REPLICATION_URL, (W - M - 250, 69, W - M, 94), relative=0)
    finish_page(c, 9)


def build() -> Path:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("Accounting for an Omnichain Dollar")
    c.setAuthor("Tsolmondorj Natsagdorj / Suwappu Research")
    c.setSubject("USDT0 reserve reconciliation, accounting perimeter, and banking control implications")
    c.setKeywords("USDT0, stablecoin reserves, treasury, settlement risk, reserve reconciliation, Suwappu Research")
    for draw in (page_1, page_2, page_3, page_4, page_5, page_6, page_7, page_8, page_9):
        draw(c)
    c.save()
    return OUTPUT


if __name__ == "__main__":
    result = build()
    print(result)
