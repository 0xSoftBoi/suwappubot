"""AI-powered features using Anthropic Claude API."""
import json
import logging
import time
from typing import Optional, Dict, Any
import anthropic
from bot.config.settings import get_settings

logger = logging.getLogger(__name__)

# Rate limiting for portfolio analysis
_analysis_cache: Dict[int, float] = {}  # user_id -> last_analysis_timestamp
ANALYSIS_COOLDOWN = 3600  # 1 hour

SUPPORTED_CHAINS = ["ethereum", "base", "solana", "arbitrum", "polygon", "bsc", "optimism", "avalanche"]

TRADE_PARSE_SYSTEM_PROMPT = """You are a crypto trading intent parser. Parse the user's message into a structured trading action.

Available actions:
- swap: Exchange one token for another
- limit_order: Set a conditional order (types: limit_buy, limit_sell, stop_loss, take_profit, trailing_stop)
- alert: Set a price alert

Supported chains: ethereum, base, solana, arbitrum, polygon, bsc, optimism, avalanche

Common token symbols: ETH, BTC, SOL, USDC, USDT, BONK, PEPE, WIF, JUP, ARB, OP, MATIC, AVAX, BNB

Output JSON only, no explanation. If you cannot parse, output {"action": "unknown"}.

Examples:
User: "buy 100 USDC of BONK on solana"
{"action": "swap", "from_token": "USDC", "to_token": "BONK", "amount": "100", "chain": "solana"}

User: "swap 0.5 ETH to USDC"
{"action": "swap", "from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "ethereum"}

User: "set stop loss 15% on SOL"
{"action": "limit_order", "type": "trailing_stop", "token": "SOL", "percent": 15}

User: "alert me when ETH hits 5000"
{"action": "alert", "token": "ETH", "condition": "above", "price": 5000}"""


class AIService:
    def __init__(self):
        self._client = None

    @property
    def client(self) -> Optional[anthropic.AsyncAnthropic]:
        if self._client is None:
            settings = get_settings()
            if settings.anthropic_api_key:
                self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    @property
    def is_available(self) -> bool:
        return self.client is not None

    async def parse_trade_intent(self, text: str) -> Optional[Dict[str, Any]]:
        """Parse natural language into structured trade intent."""
        if not self.is_available:
            return None

        try:
            settings = get_settings()
            response = await self.client.messages.create(
                model=settings.ai_model,
                max_tokens=200,
                system=TRADE_PARSE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": text}],
            )

            result_text = response.content[0].text.strip()
            # Extract JSON from response (handle markdown code blocks)
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            intent = json.loads(result_text)
            if intent.get("action") == "unknown":
                return None
            return intent
        except Exception as e:
            logger.warning(f"AI trade parsing failed: {e}")
            return None

    async def analyze_token(self, token_data: Dict, goplus_data: Dict) -> Optional[str]:
        """Generate human-readable token safety analysis."""
        if not self.is_available:
            return None

        try:
            settings = get_settings()
            prompt = f"""Analyze this token's safety in 2-3 concise sentences.

Token Data:
{json.dumps(token_data, indent=2, default=str)[:2000]}

Security Data (GoPlus):
{json.dumps(goplus_data, indent=2, default=str)[:2000]}

Focus on: holder concentration, contract age, liquidity lock status, mint/freeze authority, and any red flags.
Use risk levels: LOW RISK, MODERATE RISK, HIGH RISK, or CRITICAL RISK.
Be direct and actionable."""

            response = await self.client.messages.create(
                model=settings.ai_analysis_model,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text.strip()
        except Exception as e:
            logger.warning(f"AI token analysis failed: {e}")
            return None

    async def generate_portfolio_summary(self, positions: list, trades_7d: list = None) -> Optional[str]:
        """Generate AI portfolio recap."""
        if not self.is_available:
            return None

        try:
            settings = get_settings()
            prompt = f"""Generate a brief portfolio recap (3-5 sentences).

Current Positions:
{json.dumps(positions, indent=2, default=str)[:3000]}

Recent Trades (7d):
{json.dumps(trades_7d or [], indent=2, default=str)[:2000]}

Include: overall performance, best/worst performers, and one actionable suggestion.
Be concise and direct. Use emoji sparingly (1-2 max)."""

            response = await self.client.messages.create(
                model=settings.ai_analysis_model,
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text.strip()
        except Exception as e:
            logger.warning(f"AI portfolio summary failed: {e}")
            return None

    def can_analyze(self, user_id: int) -> bool:
        """Check if user can request AI analysis (rate limiting)."""
        last_time = _analysis_cache.get(user_id, 0)
        return time.time() - last_time >= ANALYSIS_COOLDOWN

    def record_analysis(self, user_id: int):
        """Record that user used AI analysis."""
        _analysis_cache[user_id] = time.time()


ai_service = AIService()
