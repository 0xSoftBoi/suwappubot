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
    c.drawString(M, 18, "RESEARCH - NOT INVESTMENT ADVICE")
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


def page_1(c: canvas.Canvas) -> None:
    page_bg(c)
    label(c, "Suwappu Research", M, H - 44, INK)
    c.setFont(MONO, 7)
    set_fill(c, MUTED)
    c.drawRightString(W - M, H - 44, "REPORT 01 / AUGUST 2026")
    line(c, H - 56)

    label(c, "Stablecoin solvency / Evidence status: research", M, H - 98, ORANGE_DARK)
    y = heading(c, "Accounting for an Omnichain Dollar", M, H - 139, W - 2 * M, size=42, leading=43)
    y -= 12
    paragraph(
        c,
        "A 12-month public-state reconciliation of USDT0, twice corrected.",
        M,
        y,
        390,
        font=SANS,
        size=13,
        leading=17,
        color=INK_2,
    )

    band_y = 160
    band_h = 300
    set_fill(c, INK)
    c.rect(0, band_y, W, band_h, stroke=0, fill=1)
    label(c, "Published result", M, band_y + band_h - 38, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SERIF, 24)
    c.drawString(M, band_y + band_h - 77, "The documented universe now reconciles to 1.0003.")
    c.setFont(SERIF, 24)
    c.drawString(M, band_y + band_h - 105, "That measured difference is only three basis points.")
    draw_series_chart(c, M + 31, band_y + 59, W - 2 * M - 31, 126, cover=True)
    c.setFont(MONO, 6.2)
    set_fill(c, WHITE)
    c.drawString(M + 31, band_y + 33, "DASHED: V2 PUBLISHED SERIES     SOLID: CORRECTED SERIES")

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
    label(c, "The finding", M, H - 84, ORANGE_DARK)
    y = heading(
        c,
        "Measured completely, the system is indistinguishable from exactly 1:1.",
        M,
        H - 118,
        W - 2 * M,
        size=31,
        leading=32,
    )
    y -= 18
    paragraph(
        c,
        "At 01:53 UTC on 1 August 2026, the Ethereum lockbox held $3.4536B of USDT against $3.4526B of directly measured USDT0 liabilities. That is a 1.0003 ratio and a $1.03M measured difference - about three basis points. Because the reads are not block-aligned and cannot see encumbrance or in-flight messages, we do not call that difference a cushion.",
        M,
        y,
        W - 2 * M,
        size=10.2,
        leading=14.5,
    )

    line(c, 510)
    stat(c, money(HEAD["lockbox"], 4), "USDT IN ETHEREUM LOCKBOX", M, 470, 135)
    stat(c, f"{HEAD['ratio']:.4f}", "MEASURED COLLATERAL / LIABILITIES", 225, 470, 150)
    stat(c, "183", "BLOCK-ALIGNED OBSERVATIONS / 12 MONTHS", 410, 470, 130)
    line(c, 405)

    col = (W - 2 * M - 34) / 2
    label(c, "What changed", M, 376, INK)
    y1 = paragraph(
        c,
        "Version 1 omitted liabilities and manufactured a surplus. Version 2 fixed the liability side but verified the wrong Polygon collateral address, manufacturing a shortfall. This revision completes both sides. Zero of 183 corrected panel observations fall below par; the endpoint, however, has wound down to measurement noise.",
        M,
        354,
        col,
        size=9.1,
        leading=13.2,
    )
    label(c, "What did not change", M + col + 34, 376, INK)
    paragraph(
        c,
        "A public balance reconciliation is a necessary solvency check, not a solvency certificate. It cannot establish legal encumbrance of escrowed USDT, net cross-chain messages in flight, or whether the issuer registry itself is complete. At a 3bp margin, each omission can dominate the measured difference.",
        M + col + 34,
        354,
        col,
        size=9.1,
        leading=13.2,
    )
    label(c, "Decision frame", M, max(178, y1 - 23), ORANGE_DARK)
    paragraph(
        c,
        "Use the on-chain check as an always-on reconciliation primitive. Pair it with evidence about registry completeness, message state, and the legal status of collateral before treating the result as proof of full backing.",
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
    report_header(c, 3, "Correction ledger")
    label(c, "Corrections are part of the result", M, H - 84, ORANGE_DARK)
    y = heading(c, "Two errors moved the headline in opposite directions.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "Neither error required private information to find. Both were failures to define and verify the accounting perimeter before interpreting the ratio.",
        M,
        y - 10,
        455,
        size=9.4,
        leading=13.4,
    )

    top = 565
    cols = [M, 105, 280, 395, W - M]
    headers = ["VERSION", "REPORTED ENDPOINT", "BUFFER", "WHAT WAS WRONG"]
    label(c, headers[0], cols[0], top, MUTED)
    label(c, headers[1], cols[1], top, MUTED)
    label(c, headers[2], cols[2], top, MUTED)
    label(c, headers[3], cols[3], top, MUTED)
    line(c, top - 12)
    rows = [
        ("V1", "1.042", "$137.5M", "Liability universe truncated"),
        ("V2", "1.0015 panel", "$5.1M", "Wrong Polygon collateral address"),
        ("V3", "1.0003 head", "$1.03M", "Complete documented universe"),
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

    label(c, "Error anatomy", M, 347, INK)
    yb = 318
    yb = bullet(
        c,
        "01",
        "Universe truncation",
        "Omit liabilities and an apparent reserve surplus appears. V1 missed $134.8M of liabilities; completing the universe removed 96% of the reported buffer.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "02",
        "Account misattribution",
        "Verify the wrong backing address and a healthy system can appear insolvent. The canonical Polygon predicate held $1.22B-$1.39B during the pre-migration window; V2's control read $0.02 at a different address.",
        M,
        yb,
        W - 2 * M,
    )
    bullet(
        c,
        "03",
        "Timestamp misalignment",
        "Compare balances from different moments and migration flow becomes a false mismatch. The panel resolves each chain to a block at the same target timestamp; the event window is rescanned every six hours.",
        M,
        yb,
        W - 2 * M,
    )

    set_fill(c, PALE)
    c.rect(M, 69, W - 2 * M, 49, stroke=0, fill=1)
    label(c, "Operating rule", M + 14, 97, ORANGE_DARK)
    paragraph(
        c,
        "Define the liability universe, verify every account, align time - then interpret the ratio.",
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
    report_header(c, 4, "Current snapshot")
    label(c, "Accounting invariant", M, H - 84, ORANGE_DARK)
    y = heading(c, "One escrow. Twenty directly measured liability legs.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "For a lock-and-mint omnichain dollar, the public-state test is simple: collateral held in the canonical Ethereum lockbox should cover the sum of remote USDT0 supply. HyperCore is verified as a sub-ledger of HyperEVM and is not double-counted.",
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

    label(c, "Direct liability snapshot", M, 496, INK)
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
        "The $1.03M arithmetic difference is smaller than uncertainties this read cannot observe. We therefore report par, not a positive reserve cushion. The precision belongs to the measurement; the conclusion respects its limits.",
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
    report_header(c, 5, "Migration")
    label(c, "Correction 02", M, H - 84, ORANGE_DARK)
    y = heading(c, "The apparent shortfall was a wrong-address artifact.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "Before 27 August 2025, Polygon PoS USDT backing sat in the canonical Polygon predicate, not the USDT0 lockbox. V2 checked a different address and interpreted the missing $1.3B as an unidentified reserve account.",
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
    label(c, "Independent cross-check", M + 16, 225, ORANGE_DARK)
    paragraph(
        c,
        "The $1,358.8M predicate outflow matched Polygon supply at bracket open ($1,358.759M) to within about $82K - 0.006% of the flow. The issuer had also announced the backing migration that day. Chain state and the public statement describe the same event.",
        M + 16,
        203,
        W - 2 * M - 32,
        size=8.8,
        leading=12,
    )
    label(c, "Lesson", M, 124, INK)
    paragraph(
        c,
        "A break in a reserve time series can be an accounting-boundary migration, not an economic impairment. Verify the address map before fitting the story.",
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
    report_header(c, 6, "Buffer dynamics")
    label(c, "The endpoint matters", M, H - 84, ORANGE_DARK)
    y = heading(c, "The historical cushion was wound down toward par.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The measured buffer ranged from roughly 15bp to 18.7% of liabilities across the year - a 124x span inconsistent with a visible proportional target. The end of the sample is more decision-relevant than the historical exceedance.",
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
        "Historically above par does not mean meaningfully overcollateralized now. At the endpoint, measurement uncertainty is the headline.",
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
    report_header(c, 7, "Proof boundary")
    label(c, "Necessary, not sufficient", M, H - 84, ORANGE_DARK)
    y = heading(c, "What public chain state can - and cannot - prove.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "A balance reconciliation answers one narrow question very well. Treating it as a complete reserve attestation would erase exactly the uncertainty that becomes decisive at a three-basis-point margin.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    label(c, "Visible from public state", M, 584, TEAL)
    label(c, "Not established by the read", M + 266, 584, RED)
    line(c, 570)
    yy = 539
    yy = compare_row(
        c,
        yy,
        "Canonical escrow balance",
        "USDT balanceOf() on the verified Ethereum OAdapter lockbox.",
        "Legal encumbrance",
        "A positive token balance does not establish that the collateral is unencumbered or bankruptcy-remote.",
    )
    yy = compare_row(
        c,
        yy,
        "Remote token supply",
        "totalSupply() on each documented USDT0 deployment, with decimals and live contracts checked.",
        "Messages in flight",
        "A point-in-time sum does not expose net mint/burn instructions moving between chains.",
    )
    yy = compare_row(
        c,
        yy,
        "Accounting perimeter used",
        "Twenty direct liability legs, plus an explicit HyperCore containment check; Tron and TON classified as Legacy Mesh.",
        "Registry completeness",
        "The method can verify documented deployments; it cannot prove that the issuer's deployment registry omits nothing.",
    )

    set_fill(c, PALE)
    c.rect(M, 151, W - 2 * M, 112, stroke=0, fill=1)
    label(c, "A monitoring stack should track", M + 16, 235, INK)
    items = [
        "01  Complete liability registry",
        "02  Collateral + legacy escrows",
        "03  Net messages in flight",
        "04  Account-level encumbrance evidence",
        "05  Boundary migrations and contract upgrades",
        "06  Corrections to the address map",
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
        "At $1.03M, any single invisible item above roughly three basis points can flip the sign of the measured buffer.",
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
    report_header(c, 8, "Method and replication")
    label(c, "Audit the result - and the mistakes", M, H - 84, ORANGE_DARK)
    y = heading(c, "Everything needed to rerun the measurement is public.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "The panel uses public RPC endpoints, no explorer API, no indexer, and no credentials. Superseded series are retained so a reader can reproduce the exact errors that produced earlier conclusions.",
        M,
        y - 10,
        470,
        size=9.3,
        leading=13.4,
    )

    label(c, "Measurement design", M, 579, INK)
    yb = 549
    yb = bullet(c, "01", "183 aligned observations", "Every 48 hours from 26 July 2025 through 25 July 2026, with block resolution per chain at each target timestamp.", M, yb, W - 2 * M)
    yb = bullet(c, "02", "Six-hour event rescan", "The 25 Aug-1 Sep migration window is rescanned at six-hour resolution; the canonical predicate is backfilled at all 16 pre-break panel blocks.", M, yb, W - 2 * M)
    yb = bullet(c, "03", "Complete-universe head check", "Twenty direct liability legs measured in one session on 1 Aug 2026, with the HyperCore containment relationship verified and no documented direct leg excluded.", M, yb, W - 2 * M)

    label(c, "Proof files", M, yb - 3, INK)
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
    label(c, "Open replication bundle", M + 16, 116, ORANGE)
    set_fill(c, WHITE)
    c.setFont(SANS_BOLD, 9)
    c.drawString(M + 16, 92, "suwappu.bot/research/replication")
    c.linkURL(REPLICATION_URL, (M + 15, 82, M + 260, 103), relative=0)
    finish_page(c, 8)


def page_9(c: canvas.Canvas) -> None:
    page_bg(c)
    report_header(c, 9, "Decision frame")
    label(c, "What to do with the result", M, H - 84, ORANGE_DARK)
    y = heading(c, "Make the accounting perimeter a product surface.", M, H - 118, 470, size=29, leading=30)
    paragraph(
        c,
        "This paper's most reusable result is operational: a cross-chain asset becomes easier to underwrite when the deployment registry, backing accounts, and boundary changes are published in machine-readable form.",
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
        "For issuers",
        "Publish a dated machine-readable registry of every liability leg, backing account, containment relationship, and migration. A reserve ratio is only as good as the address map behind it.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "02",
        "For allocators and routers",
        "Automate the public-state reconciliation, but do not equate it with a full reserve attestation. Escalate when the measured difference approaches the uncertainty in messages, encumbrance, or registry coverage.",
        M,
        yb,
        W - 2 * M,
    )
    yb = bullet(
        c,
        "03",
        "For monitor builders",
        "Version the accounting perimeter itself. Contract migrations, new deployments, sub-ledgers, and address corrections are state changes that should be observable and historically replayable.",
        M,
        yb,
        W - 2 * M,
    )

    line(c, yb + 5)
    label(c, "Disclosures", M, yb - 20, INK)
    yd = paragraph(
        c,
        "Research, not investment advice. Suwappu builds cross-chain execution infrastructure and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. No directional position informed this analysis. Tether, Everdawn Labs, and other named parties did not review the work before publication. All inputs are public chain state or cited public documents. The working paper is canonical where this report and the paper differ.",
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
    label(c, "Read the working paper + inspect the evidence", M + 16, 83, ORANGE)
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
    c.setSubject("A 12-month public-state reconciliation of USDT0, twice corrected")
    c.setKeywords("USDT0, stablecoin, collateral, cross-chain, solvency, Suwappu Research")
    for draw in (page_1, page_2, page_3, page_4, page_5, page_6, page_7, page_8, page_9):
        draw(c)
    c.save()
    return OUTPUT


if __name__ == "__main__":
    result = build()
    print(result)
