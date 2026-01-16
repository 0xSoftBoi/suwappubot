"""Admin commands for monitoring and management."""

import asyncio
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType
from bot.utils.cache import price_cache, quote_cache, balance_cache, gas_cache
from database.db import get_session
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus


# Admin user IDs (add your Telegram ID here)
ADMIN_IDS = []  # e.g., [123456789]


def is_admin(user_id: int) -> bool:
    """Check if user is admin."""
    return user_id in ADMIN_IDS or len(ADMIN_IDS) == 0  # Allow all if no admins set


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /status command - show system health status."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return
    
    loading_msg = await update.message.reply_text("🔍 Checking system status...")
    
    # Check RPC endpoints
    rpc_status = await _check_rpc_endpoints()
    
    # Check external APIs
    api_status = await _check_external_apis()
    
    # Get database stats
    db_stats = _get_database_stats()
    
    # Get cache stats
    cache_stats = _get_cache_stats()
    
    # Build status message
    lines = ["🖥️ *System Status*\n"]
    
    # RPC Status
    lines.append("*RPC Endpoints:*")
    for chain, status in rpc_status.items():
        emoji = "✅" if status["ok"] else "❌"
        latency = f"{status['latency']:.0f}ms" if status.get("latency") else "N/A"
        lines.append(f"  {emoji} {chain}: {latency}")
    
    lines.append("")
    
    # API Status
    lines.append("*External APIs:*")
    for api, status in api_status.items():
        emoji = "✅" if status["ok"] else "❌"
        lines.append(f"  {emoji} {api}: {'OK' if status['ok'] else status.get('error', 'Error')}")
    
    lines.append("")
    
    # Database Stats
    lines.append("*Database:*")
    lines.append(f"  👥 Users: {db_stats['users']}")
    lines.append(f"  👛 Wallets: {db_stats['wallets']}")
    lines.append(f"  🔄 Total Swaps: {db_stats['swaps']}")
    lines.append(f"  ✅ Completed: {db_stats['completed_swaps']}")
    lines.append(f"  ❌ Failed: {db_stats['failed_swaps']}")
    
    lines.append("")
    
    # Cache Stats
    lines.append("*Cache:*")
    lines.append(f"  💰 Price: {cache_stats['price']['active_entries']} entries")
    lines.append(f"  📊 Quote: {cache_stats['quote']['active_entries']} entries")
    lines.append(f"  ⛽ Gas: {cache_stats['gas']['active_entries']} entries")
    
    keyboard = [[InlineKeyboardButton("🔄 Refresh", callback_data="admin_status")]]
    
    await loading_msg.edit_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def _check_rpc_endpoints() -> dict:
    """Check health of RPC endpoints."""
    results = {}
    
    for chain_name, chain in CHAINS.items():
        try:
            rpc_url = getattr(settings, chain.rpc_url_env.lower(), None)
            if not rpc_url:
                results[chain_name] = {"ok": False, "error": "Not configured"}
                continue
            
            if chain.chain_type == ChainType.SOLANA:
                payload = {"jsonrpc": "2.0", "method": "getHealth", "id": 1}
            else:
                payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
            
            import time
            start = time.time()
            
            async with aiohttp.ClientSession() as session:
                async with session.post(rpc_url, json=payload, timeout=5) as resp:
                    latency = (time.time() - start) * 1000
                    
                    if resp.status == 200:
                        results[chain_name] = {"ok": True, "latency": latency}
                    else:
                        results[chain_name] = {"ok": False, "error": f"HTTP {resp.status}"}
        except asyncio.TimeoutError:
            results[chain_name] = {"ok": False, "error": "Timeout"}
        except Exception as e:
            results[chain_name] = {"ok": False, "error": str(e)[:50]}
    
    return results


async def _check_external_apis() -> dict:
    """Check health of external APIs."""
    results = {}
    
    # Check Li.Fi
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://li.quest/v1/chains", timeout=5) as resp:
                results["Li.Fi"] = {"ok": resp.status == 200}
    except Exception as e:
        results["Li.Fi"] = {"ok": False, "error": str(e)[:50]}
    
    # Check Jupiter
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000", timeout=5) as resp:
                results["Jupiter"] = {"ok": resp.status == 200}
    except Exception as e:
        results["Jupiter"] = {"ok": False, "error": str(e)[:50]}
    
    # Check CoinGecko
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://api.coingecko.com/api/v3/ping", timeout=5) as resp:
                results["CoinGecko"] = {"ok": resp.status == 200}
    except Exception as e:
        results["CoinGecko"] = {"ok": False, "error": str(e)[:50]}
    
    return results


def _get_database_stats() -> dict:
    """Get database statistics."""
    with get_session() as session:
        users = session.query(User).count()
        wallets = session.query(Wallet).filter(Wallet.is_active == True).count()
        swaps = session.query(SwapTransaction).count()
        completed = session.query(SwapTransaction).filter(
            SwapTransaction.status == SwapStatus.COMPLETED.value
        ).count()
        failed = session.query(SwapTransaction).filter(
            SwapTransaction.status == SwapStatus.FAILED.value
        ).count()
    
    return {
        "users": users,
        "wallets": wallets,
        "swaps": swaps,
        "completed_swaps": completed,
        "failed_swaps": failed,
    }


def _get_cache_stats() -> dict:
    """Get cache statistics."""
    return {
        "price": price_cache.stats(),
        "quote": quote_cache.stats(),
        "balance": balance_cache.stats(),
        "gas": gas_cache.stats(),
    }


async def clear_cache_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /clearcache command - clear all caches."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return
    
    await price_cache.clear()
    await quote_cache.clear()
    await balance_cache.clear()
    await gas_cache.clear()
    
    await update.message.reply_text("✅ All caches cleared!")


async def broadcast_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /broadcast command - send message to all users."""
    user = update.effective_user
    
    if not is_admin(user.id):
        await update.message.reply_text("❌ This command is for admins only.")
        return
    
    if not context.args:
        await update.message.reply_text(
            "Usage: /broadcast <message>\n\n"
            "Example: /broadcast 🎉 New feature released!"
        )
        return
    
    message = " ".join(context.args)
    
    with get_session() as session:
        users = session.query(User).all()
        user_ids = [u.telegram_id for u in users]
    
    sent = 0
    failed = 0
    
    for telegram_id in user_ids:
        try:
            await context.bot.send_message(
                chat_id=telegram_id,
                text=f"📢 *Announcement*\n\n{message}",
                parse_mode="Markdown",
            )
            sent += 1
        except Exception:
            failed += 1
    
    await update.message.reply_text(
        f"✅ Broadcast complete!\n"
        f"Sent: {sent}\n"
        f"Failed: {failed}"
    )


# Create handlers
status_handler = CommandHandler("st", status_command)
clear_cache_handler = CommandHandler("cc", clear_cache_command)
broadcast_handler = CommandHandler("bc", broadcast_command)

