"""Market data model — normalized OHLCV candles for cross-chain token prices.

Backs the Historical API (``GET /v1/data/history/ohlcv``) described in
docs/plans/market-data-parity.md. Populated by bot/services/market_data.py,
which polls CoinGecko/DexScreener/GeckoTerminal per tracked token, normalizes
into candles, and upserts here (Phase 2 — not yet implemented as of this
migration).

open/high/low/close/volume are USD-denominated Numeric(38, 18) so exact
decimal arithmetic holds across chains with wildly different token decimals
(e.g. 6dp USDC vs 18dp ETH vs 9dp SOL).
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Index, Integer, Numeric, String, UniqueConstraint

from database.db import Base


class MarketCandle(Base):
    """One OHLCV candle for a (symbol, chain, timeframe, ts) key.

    ts is the candle's open time, UTC. `source` records which upstream feed
    produced the candle (coingecko/dexscreener/geckoterminal) for provenance.
    """

    __tablename__ = "market_candles"

    id = Column(Integer, primary_key=True, autoincrement=True)

    symbol = Column(String(20), nullable=False)  # uppercase, e.g. ETH
    chain = Column(String(50), nullable=False)  # chain slug from bot/config/chains.py
    token_address = Column(String(255), nullable=True)  # canonical address on that chain
    timeframe = Column(String(10), nullable=False)  # '1m' | '5m' | '1h' | '1d'
    ts = Column(DateTime(timezone=True), nullable=False)  # candle open time, UTC

    open = Column(Numeric(38, 18), nullable=False)
    high = Column(Numeric(38, 18), nullable=False)
    low = Column(Numeric(38, 18), nullable=False)
    close = Column(Numeric(38, 18), nullable=False)
    volume = Column(Numeric(38, 18), nullable=True)

    source = Column(String(20), nullable=False)  # 'coingecko' | 'dexscreener' | 'geckoterminal'

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "symbol", "chain", "timeframe", "ts", name="uq_market_candles_symbol_chain_timeframe_ts"
        ),
        Index(
            "ix_market_candles_symbol_chain_timeframe_ts",
            "symbol",
            "chain",
            "timeframe",
            ts.desc(),
        ),
    )

    def __repr__(self) -> str:
        return f"<MarketCandle {self.symbol}/{self.chain} {self.timeframe} @ {self.ts}>"
