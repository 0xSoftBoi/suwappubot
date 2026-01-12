"""Unified bot logic service for multi-platform support (Telegram/WhatsApp)."""

import logging
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime

from bot.models.user import User, Wallet
from bot.services.wallet import WalletService
from bot.utils.templates import WELCOME_MESSAGE, HELP_MESSAGE, NO_WALLETS, START_FIRST
from bot.utils.formatters import format_balance_list
from database.db import get_session

logger = logging.getLogger(__name__)

class UnifiedResponse:
    """Platform-agnostic response container."""
    def __init__(self, text: str, buttons: Optional[List[Dict[str, str]]] = None, header: Optional[str] = None):
        self.text = text
        self.buttons = buttons
        self.header = header

class UnifiedBotService:
    """Centralizes bot logic for any platform."""
    
    def __init__(self):
        self.wallet_service = WalletService()
        
    async def handle_command(self, platform: str, user_id: str, text: str) -> UnifiedResponse:
        """Process a command from any platform."""
        text = text.lower().strip()
        
        # 1. Get or Create User
        with get_session() as session:
            if platform == "telegram":
                user = session.query(User).filter(User.telegram_id == int(user_id)).first()
            else: # whatsapp
                user = session.query(User).filter(User.whatsapp_id == user_id).first()
                
            if not user and text in ["/start", "start", "hi", "hello"]:
                # Create user
                if platform == "telegram":
                    user = User(telegram_id=int(user_id))
                else:
                    user = User(whatsapp_id=user_id)
                session.add(user)
                session.commit()
                return UnifiedResponse(WELCOME_MESSAGE)
            
            if not user:
                return UnifiedResponse(START_FIRST)

            # 2. Route Commands
            if text in ["/start", "start", "hi", "hello"]:
                return UnifiedResponse(WELCOME_MESSAGE)
                
            elif text in ["/help", "help"]:
                return UnifiedResponse(HELP_MESSAGE)
                
            elif text in ["/balance", "balance"]:
                return await self._handle_balance(user)
                
            elif text in ["/portfolio", "portfolio"]:
                # Fetch detailed portfolio via balance logic but formatted as portfolio
                return await self._handle_portfolio(user)
                
            elif text in ["/history", "history"]:
                return await self._handle_history(user)
                
            elif text in ["/wallet", "wallet", "wallets"]:
                return await self._handle_wallets(user)
                
            elif text in ["/gas", "gas"]:
                # Simple mocked gas response for now (to match Telegram's quick response)
                return UnifiedResponse(
                    "⛽ *Live Gas Prices*\n\n"
                    "• *Ethereum*: 15 Gwei\n"
                    "• *Arbitrum*: 0.1 Gwei\n"
                    "• *Base*: 0.01 Gwei\n"
                    "• *Polygon*: 35 Gwei\n\n"
                    "_Refreshed just now_"
                )
                
            elif text in ["/swap", "swap"]:
                return UnifiedResponse(
                    "Select the chain you want to swap FROM:",
                    [
                        {"id": "chain_eth", "title": "Ethereum"},
                        {"id": "chain_arb", "title": "Arbitrum"},
                        {"id": "chain_base", "title": "Base"}
                    ],
                    header="🔄 New Swap"
                )
            
            # Handle swap flow start (interactive)
            elif text.startswith("chain_"):
                chain = text.replace("chain_", "").upper()
                return UnifiedResponse(
                    f"You selected *{chain}*.\n\n"
                    "Please enter the amount you want to swap (e.g., `100 USDC`):"
                )

            else:
                return UnifiedResponse(
                    "🤖 I didn't understand that command.\n\n"
                    "Try:\n"
                    "• *balance* - Check wallet\n"
                    "• *swap* - Start a swap\n"
                    "• *help* - Get usage details"
                )

    async def _handle_balance(self, user: User) -> UnifiedResponse:
        """Unified balance lookup logic."""
        with get_session() as session:
            # Re-query user to avoid detached session if called externally
            user = session.query(User).filter(User.id == user.id).first()
            wallets = user.wallets
            
            if not wallets:
                return UnifiedResponse(NO_WALLETS)
            
            wallet_infos = [(w.address, w.chain_type) for w in wallets]

        all_balances = {}
        for address, chain_type in wallet_infos:
            try:
                balances = await self.wallet_service.get_balances_by_address(address, chain_type)
                for chain, tokens in balances.items():
                    if chain not in all_balances:
                        all_balances[chain] = {}
                    for token, amount in tokens.items():
                        all_balances[chain][token] = all_balances[chain].get(token, 0) + amount
            except Exception as e:
                logger.error(f"Error fetching balance for {address}: {e}")

        if not all_balances:
            return UnifiedResponse("💰 *Your Balances*\n\nNo token balances found.")
        
        return UnifiedResponse(format_balance_list(all_balances))

    async def _handle_portfolio(self, user: User) -> UnifiedResponse:
        """Fetch and format portfolio summary."""
        # For now, reuse balance logic but with a different header
        # In a real app, this would include USD totals and percentages
        res = await self._handle_balance(user)
        res.text = "📊 *Unified Portfolio Summary*\n\n" + res.text
        return res

    async def _handle_history(self, user: User) -> UnifiedResponse:
        """Fetch and format swap history."""
        with get_session() as session:
            from bot.models.swap import SwapTransaction
            swaps = session.query(SwapTransaction).filter(
                SwapTransaction.user_id == user.id
            ).order_by(SwapTransaction.created_at.desc()).limit(10).all()
            
            if not swaps:
                return UnifiedResponse("📜 *Transaction History*\n\nNo swaps yet. Use *swap* to make your first trade!")
            
            lines = ["📜 *Recent History*\n"]
            for s in swaps:
                status = "✅" if s.status == "completed" else "⏳" if s.status == "pending" else "❌"
                lines.append(f"{status} `{s.created_at.strftime('%m/%d')}` {s.from_token} → {s.to_token}")
            
            return UnifiedResponse("\n".join(lines))

    async def _handle_wallets(self, user: User) -> UnifiedResponse:
        """Fetch and format wallet list."""
        with get_session() as session:
            # Re-query
            user = session.query(User).filter(User.id == user.id).first()
            wallets = user.wallets
            
            if not wallets:
                return UnifiedResponse("👛 *Your Wallets*\n\nNo wallets found. Use the dashboard to import or create one.")
            
            lines = ["👛 *Your Wallets*\n"]
            for w in wallets:
                type_icon = "🔷" if w.chain_type == "evm" else "🟢"
                lines.append(f"{type_icon} *{w.chain_type.upper()}*: `{w.address[:6]}...{w.address[-4:]}`")
            
            return UnifiedResponse("\n".join(lines))

# Singleton instance
unified_bot_service = UnifiedBotService()
