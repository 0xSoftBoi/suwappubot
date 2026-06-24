"""Season / convertible-points system database models.

Seasons introduce a per-season convertible currency ("season points") that
converts to tokens PRO-RATA at TGE:

    your_tokens = your_season_points / total_season_points * season.token_pool

This is distinct from the existing points system:
- ``user_points.xp``        — permanent, drives level/leaderboard. UNCHANGED.
- ``user_points.current_points`` — spendable in the rewards store. UNCHANGED.
- ``season_points.points``  — NEW convertible currency, settled at season end.

The Python ``Base.metadata.create_all`` is the source of truth for the DDL of
these tables (the api-ts Drizzle schema MUST mirror the column names/types
exactly so cross-ORM queries against the shared Postgres DB do not break).

This file mirrors the style of ``bot/models/points.py``.
"""

from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
)

from database.db import Base

# ---------------------------------------------------------------------------
# Anti-farm constants (identical in both stacks — see SEASONS_SPEC.md)
# ---------------------------------------------------------------------------

# Swaps below this USD value earn 0 season points (kills dust wash-trade farming).
MIN_SWAP_USD_FOR_SEASON_POINTS = 5.0

# Max season points one user can accrue per UTC day.
DAILY_SEASON_POINT_CAP = 5000.0

# Max season referral points per user per season.
REFERRAL_SEASON_POINT_CAP = 10000.0

# Only these actions accrue season points.
# EXCLUDED on purpose: level_up (meta), redemption (spend/negative),
# twitter_share (stubbed / unverifiable), get_copied (passive).
SEASON_POINT_ACTION_ALLOWLIST = {
    "swap",
    "first_swap_daily",
    "checkin",
    "streak_bonus",
    "referral_signup",
    "referral_first_swap",
    "copy_trade",
    "milestone",
    # Whole-product earn actions. The fee-bearing ones (perps/predict/p2p) accrue
    # FEE-DENOMINATED season points when the award carries `fee_usd` (wash-proof,
    # same rule as swaps — see FEE_DENOMINATED_SEASON_ACTIONS / accrue_season_points).
    "perps_trade",
    "predict_trade",
    "predict_win",
    "p2p_trade",
}

# Actions whose season-point base is denominated in FEES PAID (USD) rather than
# raw volume, when the award metadata carries ``fee_usd``. Wash-proof: points
# scale with fees, not notional. ``swap`` is the original member; the
# whole-product trading actions follow the same rule. ``predict_win`` is a flat
# settlement bonus (not fee-bearing) and is deliberately excluded.
FEE_DENOMINATED_SEASON_ACTIONS = {
    "swap",
    "perps_trade",
    "predict_trade",
    "p2p_trade",
}

# Referral actions, used for the per-season referral cap.
REFERRAL_SEASON_ACTIONS = {"referral_signup", "referral_first_swap"}


# ---------------------------------------------------------------------------
# Engagement multipliers (identical in both stacks)
# ---------------------------------------------------------------------------

LEVEL_MULTIPLIER = {
    "bronze": 1.0,
    "silver": 1.05,
    "gold": 1.10,
    "platinum": 1.20,
    "diamond": 1.35,
}

# Hard cap on the combined (level * streak) multiplier.
COMBINED_MULTIPLIER_CAP = 1.75


def combined_multiplier(level: str, daily_streak: int) -> float:
    """Compute the combined engagement multiplier for season-point accrual.

    combined = min(level_mult * (1 + min(streak, 30) * 0.01), 1.75)

    - ``level``        — user_points.level (bronze..diamond); unknown → bronze.
    - ``daily_streak`` — user_points.daily_streak (clamped to 30 for the bonus).
    """
    level_mult = LEVEL_MULTIPLIER.get(level or "bronze", 1.0)
    streak = max(0, int(daily_streak or 0))
    streak_mult = 1 + min(streak, 30) * 0.01
    return min(level_mult * streak_mult, COMBINED_MULTIPLIER_CAP)


# ---------------------------------------------------------------------------
# Tokenomics — committed emission schedule (identical in both stacks)
# Full model: docs/economics/SEASONS_TOKENOMICS.md
# ---------------------------------------------------------------------------

TOKEN_MAX_SUPPLY = 1_000_000_000  # total SUWP supply
PROGRAM_ALLOCATION_PCT = 0.30  # A = 30% of supply across all seasons
SEASON_COUNT_N = 8  # number of committed seasons
EMISSION_DECAY_DELTA = 0.75  # δ — pool shrinks to 75% each season (−25%/season)
REVENUE_CAP_MULTIPLE_GAMMA = 2.0  # γ — revenue-cap multiple (groundwork)
SEASON_POINTS_PER_FEE_USD = 100.0  # swap season points = 100 × fees paid (wash-proof)


def program_allocation() -> float:
    """Total tokens reserved for the whole season program (A)."""
    return PROGRAM_ALLOCATION_PCT * TOKEN_MAX_SUPPLY


def season_pool(k: int) -> float:
    """Token pool for season ``k`` (1-based) under the geometric decay schedule.

    pool(k) = A * (1-δ) / (1 - δ**N) * δ**(k-1)

    The geometric series over k=1..N sums exactly to A. ``k`` is clamped to
    [1, N]; for k > N this returns 0 (no committed pool beyond the program).
    """
    try:
        k = int(k)
    except (TypeError, ValueError):
        return 0.0
    if k < 1:
        k = 1
    if k > SEASON_COUNT_N:
        return 0.0
    A = program_allocation()
    delta = EMISSION_DECAY_DELTA
    n = SEASON_COUNT_N
    return A * (1 - delta) / (1 - delta**n) * (delta ** (k - 1))


def season_inflation(k: int, circ_prev: float):
    """Inflation rate π_k for season ``k`` vs prior circulating program tokens.

    π_k = season_pool(k) / circ_prev, where circ_prev = Σ season_pool(j) for
    j=1..k-1. Returns None when circ_prev <= 0 (e.g. the first season).
    """
    if circ_prev is None or circ_prev <= 0:
        return None
    return season_pool(k) / circ_prev


# ---------------------------------------------------------------------------
# Seasonal calendar — weather-named seasons aligned to fiscal quarters.
# season_index 1 == Summer 2026 == Q3 2026. Seasons cycle Summer→Fall→Winter→
# Spring on calendar-quarter boundaries, so each season IS one official
# reporting quarter (Q1..Q4). 8 seasons == 8 quarters == 2 years.
# ---------------------------------------------------------------------------

# Calendar quarter (1..4) -> weather-season name, used for the season's display
# name and its calendar window. Q1=Jan-Mar … Q4=Oct-Dec.
WEATHER_BY_QUARTER = {1: "Winter", 2: "Spring", 3: "Summer", 4: "Fall"}
# First (1-based) month of each calendar quarter.
_QUARTER_START_MONTH = {1: 1, 2: 4, 3: 7, 4: 10}
# Anchor: season_index 1 == calendar Q3 2026 (Summer). Drives the weather name and
# the Jul–Sep window — NOT the reporting label (that is the company fiscal quarter).
_ANCHOR_QUARTER_ABS = 2026 * 4 + (3 - 1)

# Company FISCAL calendar: the fiscal year starts at the summer launch, so
# season_index 1 == Q1 FY26 (Summer 2026); fiscal quarters cycle Q1..Q4 and a new
# fiscal year begins each summer. This is the OFFICIAL reporting label.
_FISCAL_YEAR_ANCHOR = 2026  # fiscal year containing the Summer 2026 launch (FY26)


def _quarter_of(season_index: int):
    """(year, calendar quarter 1..4) for a 1-based season_index, anchored at Summer 2026.
    Used for the weather name and calendar window, NOT the reporting label."""
    try:
        k = int(season_index)
    except (TypeError, ValueError):
        k = 1
    if k < 1:
        k = 1
    q_abs = _ANCHOR_QUARTER_ABS + (k - 1)
    return q_abs // 4, q_abs % 4 + 1


def _fiscal_quarter(season_index: int):
    """(fiscal_year, fiscal_quarter 1..4) for a 1-based season_index. Beta == Q1 FY26."""
    try:
        k = int(season_index)
    except (TypeError, ValueError):
        k = 1
    if k < 1:
        k = 1
    return _FISCAL_YEAR_ANCHOR + (k - 1) // 4, (k - 1) % 4 + 1


def season_schedule(k: int) -> dict:
    """Committed identity for season ``k`` (1-based): weather name, official
    quarter label, quarter-aligned window, and emission pool. ends_at is the
    first day of the next quarter (exclusive boundary).
    """
    year, quarter = _quarter_of(k)
    weather = WEATHER_BY_QUARTER[quarter]
    starts_at = datetime(year, _QUARTER_START_MONTH[quarter], 1)
    ny, nq = _quarter_of(int(k) + 1)
    ends_at = datetime(ny, _QUARTER_START_MONTH[nq], 1)
    return {
        "season_index": int(k),
        "name": f"{weather} {year}",
        "slug": f"{year}-q{quarter}-{weather.lower()}",
        "quarter": quarter_label_for_index(k),
        "weather": weather,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "token_pool": season_pool(k),
        "token_symbol": "SUWP",
    }


def weather_for_index(season_index: int) -> str:
    """Weather-season name (Summer/Fall/Winter/Spring) for a season_index."""
    return WEATHER_BY_QUARTER[_quarter_of(season_index)[1]]


def quarter_label_for_index(season_index: int) -> str:
    """Official company fiscal-quarter label (e.g. 'Q1 FY26') for a season_index."""
    fy, fq = _fiscal_quarter(season_index)
    return f"Q{fq} FY{fy % 100:02d}"


# ---------------------------------------------------------------------------
# ORM models
# ---------------------------------------------------------------------------


class Season(Base):
    """A convertible-points season. Points convert to tokens pro-rata at settle."""

    __tablename__ = "seasons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(50), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default="upcoming")  # upcoming|active|ended|settled

    # 1-based position in the committed emission schedule; drives token_pool via
    # season_pool(season_index) and the weather/quarter identity via season_schedule.
    season_index = Column(Integer, nullable=False, default=1)
    # Official fiscal-quarter label, e.g. "Q3 2026". Each season is one calendar
    # quarter; the weather season lives in ``name`` (e.g. "Summer 2026").
    quarter = Column(String(16), nullable=True)

    starts_at = Column(DateTime, nullable=False)
    ends_at = Column(DateTime, nullable=False)

    token_pool = Column(Float, nullable=False, default=0)  # total tokens for pro-rata
    token_symbol = Column(String(20), nullable=False, default="SUWP")
    description = Column(String(255), nullable=True)

    # Denominator set at settle (SUM of all positive season_points.points).
    total_points_snapshot = Column(Float, nullable=True)
    # Realized fee revenue for the season (SUM of season_points.fee_paid_usd),
    # set at settle. Revenue-cap groundwork + transparency.
    realized_fee_revenue_usd = Column(Float, nullable=True)
    settled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SeasonPoints(Base):
    """Live per-user-per-season convertible-point accrual."""

    __tablename__ = "season_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    season_id = Column(Integer, ForeignKey("seasons.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    points = Column(Float, nullable=False, default=0)  # post-multiplier convertible points
    base_points = Column(Float, nullable=False, default=0)  # pre-multiplier (audit)
    swap_volume_usd = Column(
        Float, nullable=False, default=0
    )  # season volume (display + anti-farm)
    fee_paid_usd = Column(Float, nullable=False, default=0)  # season fees paid (revenue audit)
    referral_points = Column(Float, nullable=False, default=0)  # season referral points (for cap)
    daily_points_awarded = Column(Float, nullable=False, default=0)  # rolling per-UTC-day counter
    daily_window_date = Column(String(10), nullable=True)  # 'YYYY-MM-DD' UTC of the daily counter

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ux_season_points_season_user", "season_id", "user_id", unique=True),)


class SeasonSnapshot(Base):
    """Immutable per-user settlement record, written once at settle time."""

    __tablename__ = "season_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    season_id = Column(Integer, ForeignKey("seasons.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    final_points = Column(Float, nullable=False)
    rank = Column(Integer, nullable=True)
    total_points = Column(Float, nullable=False)  # denominator at settle
    token_pool = Column(Float, nullable=False)
    token_allocation = Column(Float, nullable=False)  # final_points/total_points*token_pool
    token_symbol = Column(String(20), nullable=False, default="SUWP")

    claimed = Column(Boolean, nullable=False, default=False)
    claimed_at = Column(DateTime, nullable=True)
    claim_tx_hash = Column(String(120), nullable=True)
    wallet_address = Column(String(120), nullable=True)

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ux_season_snapshots_season_user", "season_id", "user_id", unique=True),
    )
