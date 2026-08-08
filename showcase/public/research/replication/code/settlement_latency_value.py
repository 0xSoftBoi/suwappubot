#!/usr/bin/env python3
"""Reproduce Paper 4's minute-scale latency / financing calibration.

The inputs are deliberately pinned rather than fetched at runtime:

* 10bp is the cross-chain speed-tiebreak ceiling in the source snapshot.
* 3.65% is the New York Fed SOFR observation for 2026-08-06, the latest
  available observation when the paper was written on 2026-08-08.
* The day-count basis uses the actual-calendar-day/360 convention documented
  by the New York Fed for SOFR averages/index. Minute-level simple interpolation
  is this study's explicit modeling assumption, not a New York Fed methodology.

This script uses only the Python standard library. It writes the CSV used by
the paper and the SVG used by the web article from the same calculations.
"""

from __future__ import annotations

import csv
import math
from decimal import Decimal, ROUND_HALF_UP, getcontext
from pathlib import Path


getcontext().prec = 40

SOFR_VALUE_DATE = "2026-08-06"
SOFR_RATE = Decimal("0.0365")
POLICY_CAP = Decimal("0.001")
POLICY_CAP_BPS = Decimal("10")
DAY_COUNT = Decimal("360")
MINUTES_PER_DAY = Decimal("1440")
MINUTES_PER_YEAR = DAY_COUNT * MINUTES_PER_DAY
SCENARIO_MINUTES = (1, 5, 10, 30, 60)
USD_SCALE = Decimal("1000000")

REPLICATION_ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = REPLICATION_ROOT / "data" / "settlement_latency_value.csv"
FIGURE_PATH = REPLICATION_ROOT.parent / "latency-carry.svg"


def carry_fraction(minutes: int) -> Decimal:
    return SOFR_RATE * Decimal(minutes) / MINUTES_PER_YEAR


def carry_bps(minutes: int) -> Decimal:
    return carry_fraction(minutes) * Decimal("10000")


def cap_to_carry_multiple(minutes: int) -> Decimal:
    return POLICY_CAP / carry_fraction(minutes)


def implied_annual_rate_pct(minutes: int) -> Decimal:
    return POLICY_CAP * MINUTES_PER_YEAR / Decimal(minutes) * Decimal("100")


def money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):f}"


def fixed(value: Decimal, places: int) -> str:
    quantum = Decimal(1).scaleb(-places)
    return f"{value.quantize(quantum, rounding=ROUND_HALF_UP):f}"


def rows() -> list[dict[str, str]]:
    result = []
    for minutes in SCENARIO_MINUTES:
        result.append(
            {
                "sofr_value_date": SOFR_VALUE_DATE,
                "sofr_rate_pct": "3.65",
                "day_count_basis": "ACT/360 simple",
                "policy_cap_bps": "10",
                "minutes_saved": str(minutes),
                "carry_bps": fixed(carry_bps(minutes), 9),
                "cap_to_carry_multiple": fixed(cap_to_carry_multiple(minutes), 6),
                "implied_simple_annual_rate_pct": fixed(implied_annual_rate_pct(minutes), 3),
                "carry_usd_per_1m_value": money(carry_fraction(minutes) * USD_SCALE),
                "policy_cap_usd_per_1m_value": money(POLICY_CAP * USD_SCALE),
            }
        )
    return result


def write_csv(result: list[dict[str, str]]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(result[0]))
        writer.writeheader()
        writer.writerows(result)


def svg_y(multiple: float) -> float:
    top, bottom = 185.0, 445.0
    log_min, log_max = math.log10(100.0), math.log10(20_000.0)
    share = (math.log10(multiple) - log_min) / (log_max - log_min)
    return bottom - share * (bottom - top)


def write_svg(result: list[dict[str, str]]) -> None:
    x_values = (164, 316, 468, 620, 772)
    points = []
    labels = []
    for x, row in zip(x_values, result, strict=True):
        multiple = float(row["cap_to_carry_multiple"])
        y = svg_y(multiple)
        points.append(f"{x},{y:.1f}")
        labels.append(
            f'<circle cx="{x}" cy="{y:.1f}" r="5" fill="#b75e12"/>'
            f'<text x="{x}" y="{y - 13:.1f}" text-anchor="middle" fill="#17324a" '
            f'font-family="Arial, sans-serif" font-size="12" font-weight="700">'
            f'{multiple:,.0f}×</text>'
            f'<text x="{x}" y="470" text-anchor="middle" fill="#667b87" '
            f'font-family="Arial, sans-serif" font-size="12">{row["minutes_saved"]} min</text>'
        )

    grid = []
    for value, label in ((100, "100×"), (1_000, "1,000×"), (10_000, "10,000×")):
        y = svg_y(float(value))
        grid.append(
            f'<line x1="110" x2="825" y1="{y:.1f}" y2="{y:.1f}" stroke="#d8dedc" stroke-width="1"/>'
            f'<text x="96" y="{y + 4:.1f}" text-anchor="end" fill="#667b87" '
            f'font-family="Arial, sans-serif" font-size="11">{label}</text>'
        )

    equivalent_days = POLICY_CAP / SOFR_RATE * DAY_COUNT
    five_minute_carry = Decimal(result[1]["carry_usd_per_1m_value"])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" role="img" aria-labelledby="title desc">
  <title id="title">Ten basis points versus minute-scale SOFR financing carry</title>
  <desc id="desc">At a 3.65 percent annual SOFR benchmark on ACT/360, a ten basis point route-score concession is 14,203 times one minute of simple financing carry, 2,841 times five minutes, 1,420 times ten minutes, 473 times thirty minutes, and 237 times sixty minutes.</desc>
  <rect width="960" height="600" fill="#fbfaf5"/>
  <text x="54" y="47" fill="#b75e12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="700" letter-spacing="1.2">LATENCY / FINANCING CALIBRATION</text>
  <text x="54" y="84" fill="#17324a" font-family="Georgia, 'Times New Roman', serif" font-size="28">10 bp = {float(equivalent_days):.2f} days of simple SOFR carry.</text>
  <text x="54" y="110" fill="#667b87" font-family="Arial, sans-serif" font-size="13">3.65% SOFR · value date 6 Aug 2026 · ACT/360 · scenario benchmark, not Suwappu's funding cost</text>

  <text x="110" y="151" fill="#17324a" font-family="Arial, sans-serif" font-size="12" font-weight="700">10bp policy cap ÷ financing carry for time saved (log scale)</text>
  {''.join(grid)}
  <polyline points="{' '.join(points)}" fill="none" stroke="#4f6f7f" stroke-width="2.5"/>
  {''.join(labels)}

  <rect x="54" y="505" width="852" height="62" rx="3" fill="#eef3f2" stroke="#d8dedc"/>
  <text x="76" y="531" fill="#b75e12" font-family="Arial, sans-serif" font-size="11" font-weight="700" letter-spacing=".8">$1M USD-EQUIVALENT SCORE VALUE / FIVE-MINUTE EXAMPLE</text>
  <text x="76" y="553" fill="#17324a" font-family="Arial, sans-serif" font-size="15" font-weight="700">SOFR carry ≈ ${five_minute_carry:.2f} · full 10bp concession = $1,000</text>
  <text x="906" y="589" text-anchor="end" fill="#7a8a91" font-family="Arial, sans-serif" font-size="10">Source: Suwappu Research · generated by settlement_latency_value.py</text>
</svg>
'''
    FIGURE_PATH.write_text(svg, encoding="utf-8")


def main() -> None:
    result = rows()
    equivalent_days = POLICY_CAP / SOFR_RATE * DAY_COUNT
    assert abs(equivalent_days - Decimal("9.8630136986301369863")) < Decimal("1e-18")
    assert result[1]["cap_to_carry_multiple"] == "2840.547945"
    assert result[-1]["carry_bps"] == "0.042245370"
    write_csv(result)
    write_svg(result)
    print(f"wrote {DATA_PATH}")
    print(f"wrote {FIGURE_PATH}")


if __name__ == "__main__":
    main()
