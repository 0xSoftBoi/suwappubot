"""Discord embed builder utilities for Suwappu bot."""

import discord
from typing import Any, Dict, List, Optional

from bot.utils.formatters import format_amount, format_usd, format_chain_name, format_time_estimate

# Color palette
COLOR_SUCCESS = 0x00CC66
COLOR_ERROR = 0xFF3333
COLOR_INFO = 0x5865F2  # Discord blurple
COLOR_WARNING = 0xFFAA00
COLOR_SWAP = 0x00BFFF
COLOR_PORTFOLIO = 0x9B59B6
COLOR_ALERT = 0xFF6600
COLOR_LEADERBOARD = 0xFFD700
COLOR_PERPS_LONG = 0x00CC66
COLOR_PERPS_SHORT = 0xFF3333


def build_balance_embed(balances: Dict[str, Dict[str, float]]) -> discord.Embed:
    """Build a balance embed with chain-grouped fields."""
    embed = discord.Embed(title="Wallet Balances", color=COLOR_INFO)

    if not balances:
        embed.description = "No token balances found."
        return embed

    total_usd = 0.0
    for chain_name, tokens in balances.items():
        chain_display = format_chain_name(chain_name)
        lines = []
        for symbol, amount in tokens.items():
            if amount > 0:
                lines.append(f"`{format_amount(amount)}` {symbol}")
        if lines:
            embed.add_field(name=chain_display, value="\n".join(lines), inline=True)

    if total_usd > 0:
        embed.set_footer(text=f"Total: {format_usd(total_usd)}")

    return embed


def build_swap_quote_embed(quote: Any) -> discord.Embed:
    """Build embed for a swap quote."""
    embed = discord.Embed(title="Swap Quote", color=COLOR_SWAP)

    embed.add_field(name="From", value=f"{format_amount(quote.from_amount_human)} {quote.from_token}", inline=True)
    embed.add_field(name="To", value=f"~{format_amount(quote.to_amount_human)} {quote.to_token}", inline=True)
    embed.add_field(name="Rate", value=f"1 {quote.from_token} = {quote.exchange_rate:.6f} {quote.to_token}", inline=False)

    details = []
    if hasattr(quote, "gas_cost_usd") and quote.gas_cost_usd:
        details.append(f"Gas: {format_usd(quote.gas_cost_usd)}")
    if hasattr(quote, "fee_cost_usd") and quote.fee_cost_usd:
        details.append(f"Fee: {format_usd(quote.fee_cost_usd)}")
    if hasattr(quote, "provider") and quote.provider:
        details.append(f"Provider: {quote.provider}")
    if hasattr(quote, "estimated_time") and quote.estimated_time:
        details.append(f"Est. time: {format_time_estimate(int(quote.estimated_time))}")

    if details:
        embed.add_field(name="Details", value="\n".join(details), inline=False)

    return embed


def build_swap_result_embed(tx: Any, success: bool = True) -> discord.Embed:
    """Build embed for a swap result (success or failure)."""
    if success:
        embed = discord.Embed(title="Swap Submitted", color=COLOR_SUCCESS)
        embed.description = f"{format_amount(tx.from_amount)} {tx.from_token} -> {tx.to_token}"

        if tx.tx_hash:
            from bot.config.chains import get_chain_by_name
            chain = get_chain_by_name(tx.from_chain)
            if chain:
                url = f"{chain.explorer_url}/tx/{tx.tx_hash}"
                embed.add_field(name="Transaction", value=f"[View on Explorer]({url})", inline=False)
            else:
                short = f"{tx.tx_hash[:10]}...{tx.tx_hash[-6:]}"
                embed.add_field(name="Tx Hash", value=f"`{short}`", inline=False)

        embed.add_field(name="Status", value=tx.status, inline=True)
    else:
        embed = discord.Embed(title="Swap Failed", color=COLOR_ERROR)
        embed.description = "The swap could not be completed."
        if hasattr(tx, "error") and tx.error:
            embed.add_field(name="Error", value=str(tx.error)[:1024], inline=False)

    return embed


def build_portfolio_embed(balances: Dict[str, Dict[str, float]], total_usd: float = 0.0) -> discord.Embed:
    """Build a portfolio embed with multi-field USD totals."""
    embed = discord.Embed(title="Portfolio Summary", color=COLOR_PORTFOLIO)

    if not balances:
        embed.description = "No assets found."
        return embed

    for chain_name, tokens in balances.items():
        chain_display = format_chain_name(chain_name)
        lines = []
        for symbol, amount in tokens.items():
            if amount > 0:
                lines.append(f"`{format_amount(amount)}` {symbol}")
        if lines:
            embed.add_field(name=chain_display, value="\n".join(lines), inline=True)

    if total_usd > 0:
        embed.set_footer(text=f"Total Portfolio Value: {format_usd(total_usd)}")

    return embed


def build_alert_embed(
    alert_type: str,
    title: str,
    description: str,
    fields: Optional[List[Dict[str, str]]] = None,
) -> discord.Embed:
    """Build an alert embed (whale, price, trending, etc.)."""
    embed = discord.Embed(title=title, description=description, color=COLOR_ALERT)

    if fields:
        for f in fields:
            embed.add_field(
                name=f.get("name", ""),
                value=f.get("value", ""),
                inline=f.get("inline", True),
            )

    embed.set_footer(text=f"Alert Type: {alert_type}")
    return embed


def build_leaderboard_embed(
    leaders: List[Dict[str, Any]],
    title: str = "Leaderboard",
    category: str = "volume",
) -> discord.Embed:
    """Build a ranked leaderboard embed."""
    embed = discord.Embed(title=title, color=COLOR_LEADERBOARD)

    medals = ["🥇", "🥈", "🥉"]
    lines = []
    for i, entry in enumerate(leaders[:25]):
        prefix = medals[i] if i < 3 else f"`#{i+1}`"
        name = entry.get("username", entry.get("discord_username", "Unknown"))
        value = entry.get(category, 0)
        if category in ("volume", "pnl", "rewards"):
            formatted = format_usd(value)
        else:
            formatted = f"{value:,}"
        lines.append(f"{prefix} **{name}** — {formatted}")

    embed.description = "\n".join(lines) if lines else "No data yet."
    embed.set_footer(text=f"Category: {category.title()}")
    return embed


def build_perps_embed(position: Dict[str, Any], is_open: bool = True) -> discord.Embed:
    """Build a perps position embed with PnL coloring."""
    pnl = position.get("pnl", 0.0)
    color = COLOR_PERPS_LONG if pnl >= 0 else COLOR_PERPS_SHORT
    side = position.get("side", "long").upper()

    title = f"{'Open' if is_open else 'Closed'} Position — {side}"
    embed = discord.Embed(title=title, color=color)

    embed.add_field(name="Asset", value=position.get("asset", "?"), inline=True)
    embed.add_field(name="Size", value=format_usd(position.get("size", 0)), inline=True)
    embed.add_field(name="Leverage", value=f"{position.get('leverage', 1)}x", inline=True)
    embed.add_field(name="Entry", value=format_usd(position.get("entry_price", 0)), inline=True)

    if "mark_price" in position:
        embed.add_field(name="Mark", value=format_usd(position["mark_price"]), inline=True)

    pnl_str = format_usd(abs(pnl))
    pnl_prefix = "+" if pnl >= 0 else "-"
    embed.add_field(name="PnL", value=f"{pnl_prefix}{pnl_str}", inline=True)

    if "liq_price" in position:
        embed.add_field(name="Liquidation", value=format_usd(position["liq_price"]), inline=True)

    return embed


def build_wallet_embed(wallets: list) -> discord.Embed:
    """Build a wallet list embed."""
    embed = discord.Embed(title="Your Wallets", color=COLOR_INFO)

    if not wallets:
        embed.description = "No wallets found. Use `/wallet create` to get started."
        return embed

    for w in wallets:
        icon = "🔷" if w.chain_type == "evm" else "🟢"
        short_addr = f"{w.address[:6]}...{w.address[-4:]}"
        status = "✅ Active" if w.is_active else "⬜ Inactive"
        embed.add_field(
            name=f"{icon} {w.name or w.chain_type.upper()}",
            value=f"`{short_addr}`\n{status}",
            inline=True,
        )

    return embed


def build_history_embed(swaps: list) -> discord.Embed:
    """Build a transaction history embed."""
    embed = discord.Embed(title="Recent Transactions", color=COLOR_INFO)

    if not swaps:
        embed.description = "No swaps yet. Use `/swap` to make your first trade!"
        return embed

    lines = []
    for s in swaps[:10]:
        status = "✅" if s.status == "completed" else "⏳" if s.status == "pending" else "❌"
        date = s.created_at.strftime("%m/%d")
        lines.append(f"{status} `{date}` {s.from_token} → {s.to_token}")

    embed.description = "\n".join(lines)
    return embed


def build_help_embed() -> discord.Embed:
    """Build the help/commands embed."""
    embed = discord.Embed(
        title="Suwappu Bot — Commands",
        description="Cross-chain DEX bot for swapping tokens across 7+ chains.",
        color=COLOR_INFO,
    )

    embed.add_field(
        name="Trading",
        value="`/swap` — Swap tokens\n`/price` — Token price\n`/gas` — Gas prices\n`/trending` — Trending tokens",
        inline=True,
    )
    embed.add_field(
        name="Wallet",
        value="`/wallet create` — New wallet\n`/wallet balance` — Balances\n`/wallet deposit` — Deposit address\n`/wallet list` — All wallets",
        inline=True,
    )
    embed.add_field(
        name="Portfolio",
        value="`/portfolio` — Portfolio summary\n`/balance` — Quick balances\n`/history` — Trade history\n`/pnl` — Profit & Loss",
        inline=True,
    )
    embed.add_field(
        name="Alerts & Orders",
        value="`/alert set` — Set price alert\n`/limit` — Limit order\n`/dca` — DCA order\n`/orders list` — Active orders",
        inline=True,
    )
    embed.add_field(
        name="Perps",
        value="`/long` — Open long\n`/short` — Open short\n`/positions` — View positions\n`/close` — Close position",
        inline=True,
    )
    embed.add_field(
        name="Social",
        value="`/ref` — Referral link\n`/xp` — XP balance\n`/checkin` — Daily check-in\n`/leaderboard` — Rankings",
        inline=True,
    )

    embed.set_footer(text="DM commands are private. Channel commands are ephemeral.")
    return embed
