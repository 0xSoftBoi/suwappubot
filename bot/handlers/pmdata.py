"""/pmdata — historical Polymarket orderbook data for traders.

Surfaces the free Polymarket Orderbook Archive (archive.pendulumflow.com):
era coverage, per-hour Parquet download links, and v3 manifest details.
Usage:
    /pmdata                     overview + latest hour
    /pmdata 2026-08-30          links for every hour of a UTC day
    /pmdata 2026-08-30 23       one hour: link, manifest, checksum
"""

import logging
from datetime import datetime, timedelta, timezone

from telegram import Update
from telegram.ext import CommandHandler, ContextTypes

from bot.services import polymarket_archive as archive

logger = logging.getLogger(__name__)

_USAGE = (
    "Usage:\n"
    "`/pmdata` — archive overview\n"
    "`/pmdata 2026-08-30` — links for a UTC day\n"
    "`/pmdata 2026-08-30 23` — one UTC hour + manifest"
)


def _era_line(era: archive.ArchiveEra) -> str:
    end = era.end.strftime("%Y-%m-%d %H:00") if era.end else "ongoing"
    trades = "trades" if era.has_trades else "no trades"
    return (
        f"• `{era.key}` — {era.start.strftime('%Y-%m-%d %H:00')} → {end} UTC "
        f"({trades}, {era.timestamp_unit} timestamps)"
    )


async def _send_overview(update: Update) -> None:
    try:
        entry = await archive.latest_available_hour()
    except Exception:  # pragma: no cover - network best-effort
        logger.warning("latest-hour probe failed", exc_info=True)
        entry = None
    lines = [
        "📊 *Polymarket Orderbook Archive*",
        "",
        "Free historical orderbook data: hourly Parquet, no auth, no rate limit.",
        "Orderbook snapshots + every individual price change since Feb 2026.",
        "",
        "*Coverage:*",
    ]
    lines.extend(_era_line(era) for era in archive.ERAS)
    if entry is not None:
        lines += ["", f"*Latest hour* ({entry['hour_utc']}):", f"`{entry['url']}`"]
    lines += [
        "",
        "_Note: `third-party/ag6` is a single-source capture, quality audit pending, "
        "no licence stated. The only hole is 68h: 2026-08-15T10 → 2026-08-18T05. "
        "Eras differ in schema — don't concatenate them blindly._",
        "",
        _USAGE,
        "",
        f"_{archive.ATTRIBUTION}_",
    ]
    await update.message.reply_text(
        "\n".join(lines), parse_mode="Markdown", disable_web_page_preview=True
    )


async def _send_day(update: Update, day: datetime) -> None:
    entries = archive.hours_in_range(day, day + timedelta(hours=23))
    served = [e for e in entries if e["url"]]
    if not served:
        await update.message.reply_text(
            f"No archive data for {day.strftime('%Y-%m-%d')} — outside every era's span.",
            parse_mode="Markdown",
        )
        return
    eras = sorted({e["era"] for e in served})
    lines = [f"📊 *Archive files for {day.strftime('%Y-%m-%d')} (UTC)* — era `{'`, `'.join(eras)}`"]
    lines.extend(f"`{e['url']}`" for e in served)
    missing = len(entries) - len(served)
    if missing:
        lines.append(f"_{missing} hour(s) of this day fall outside the archive's coverage._")
    lines += ["", f"_{archive.ATTRIBUTION}_"]
    await update.message.reply_text(
        "\n".join(lines), parse_mode="Markdown", disable_web_page_preview=True
    )


async def _send_hour(update: Update, hour: datetime) -> None:
    entry = archive.hour_urls(hour)
    if entry is None:
        await update.message.reply_text(
            f"No archive data for {hour.strftime('%Y-%m-%d %H:00')} UTC — "
            "outside every era's span.",
            parse_mode="Markdown",
        )
        return
    lines = [
        f"📊 *{entry['hour_utc']}* — era `{entry['era']}`",
        f"`{entry['url']}`",
    ]
    if entry["manifest_url"]:
        lines.append(f"Manifest: `{entry['manifest_url']}`")
        try:
            manifest = await archive.get_hour_manifest(hour)
        except Exception:  # pragma: no cover - network best-effort
            logger.warning("archive manifest fetch failed", exc_info=True)
            manifest = None
        if isinstance(manifest, dict):
            if manifest.get("sha256"):
                lines.append(f"sha256: `{manifest['sha256']}`")
            if manifest.get("row_count") and manifest.get("bytes"):
                lines.append(
                    f"{int(manifest['row_count']):,} rows, "
                    f"{int(manifest['bytes']) / 1e9:.2f} GB"
                )
            # Rows are grouped by event type; each product's byte_range lets a
            # trader pull just that slice with an HTTP Range request.
            products = manifest.get("products")
            if isinstance(products, dict):
                type_lines = []
                for name, p in sorted(products.items()):
                    if isinstance(p, dict) and p.get("row_count") is not None:
                        type_lines.append(f"  `{name}`: {int(p['row_count']):,} rows")
                if type_lines:
                    lines += [
                        "",
                        "*Event types in this hour* (rows are grouped by type; the "
                        "manifest's per-type `byte_range` lets DuckDB/pyarrow read "
                        "one type over HTTP without downloading the hour):",
                        *type_lines,
                    ]
    lines += ["", f"_{archive.ATTRIBUTION}_"]
    await update.message.reply_text(
        "\n".join(lines), parse_mode="Markdown", disable_web_page_preview=True
    )


async def pmdata_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /pmdata — Polymarket historical data download links."""
    args = context.args or []
    try:
        if not args:
            await _send_overview(update)
            return
        day = datetime.strptime(args[0], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if len(args) == 1:
            await _send_day(update, day)
            return
        hour = int(args[1])
        if not 0 <= hour <= 23:
            raise ValueError("hour out of range")
        await _send_hour(update, day.replace(hour=hour))
    except ValueError:
        await update.message.reply_text(_USAGE, parse_mode="Markdown")
    except Exception:
        logger.exception("pmdata command failed")
        await update.message.reply_text(
            "❌ Couldn't reach the archive right now. Try again in a minute."
        )


pmdata_handler = CommandHandler("pmdata", pmdata_command)
