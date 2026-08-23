"""Campaigns paid through Merkl, which Curve's own API only half reports."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from typing import Any

MERKL_API = "https://api.merkl.xyz/v4"

#: Where a human goes to see a campaign, and to claim what it owes them.
MERKL_APP = "https://app.merkl.xyz"

#: Merkl's cap on `items`; anything larger is a 400 with a validation body.
MAX_ITEMS = 100

#: Reward token types Merkl prices, and therefore quotes an APR for.
PRICED_TYPES = frozenset({"TOKEN", "PRETGE"})

#: What Merkl calls a reward with no price.
POINT_TYPE = "POINT"

#: Percentage points within which the two sides of a campaign count as
#: paying the same rate.
SAME_RATE = 0.5


@dataclass(frozen=True, slots=True)
class MerklToken:
    """One thing a campaign pays out."""

    symbol: str
    address: str
    #: True when Merkl types this `POINT`: no price, so no APR, ever.
    points: bool = False
    #: Merkl's id for the underlying, when this is a wrapper.
    underlying_id: str = ""
    #: The token a claimer actually receives. None when this is not a
    #: wrapper, and also when the lookup did not come back -- in which
    #: case the wrapper's own symbol is shown, which is what Merkl
    #: shows.
    underlying: MerklToken | None = None

    @property
    def wrapped(self) -> bool:
        return self.underlying is not None

    @property
    def paid_symbol(self) -> str:
        """What to call this on screen: what arrives, not what is counted."""
        return self.underlying.symbol if self.underlying else self.symbol

    @property
    def paid_address(self) -> str:
        """And whose logo to draw. curve-assets has crvUSD, not ybwcrvUSD."""
        return self.underlying.address if self.underlying else self.address


@dataclass(frozen=True, slots=True)
class MerklCampaign:
    """One live Merkl opportunity, as it bears on a Curve pool."""

    chain_id: int
    identifier: str
    name: str
    apr: float
    opportunity_id: str
    tokens: tuple[MerklToken, ...] = ()

    @property
    def url(self) -> str:
        """The campaign's page on Merkl, where it can also be claimed."""
        if not self.opportunity_id:
            return f"{MERKL_APP}/protocols/curve"
        return f"{MERKL_APP}/opportunities/{self.opportunity_id}"

    @property
    def paid_tokens(self) -> tuple[MerklToken, ...]:
        return tuple(token for token in self.tokens if not token.points)

    @property
    def point_tokens(self) -> tuple[MerklToken, ...]:
        return tuple(token for token in self.tokens if token.points)

    @property
    def points_only(self) -> bool:
        """Nothing here has a price, so nothing here has a rate."""
        return bool(self.tokens) and not self.paid_tokens


@dataclass(frozen=True, slots=True)
class MerklRewards:
    """Everything Merkl pays one pool, split by where the liquidity sits."""

    #: Campaigns on the pool or its LP token: paid whether or not you stake.
    unstaked: tuple[MerklCampaign, ...] = ()
    #: Campaigns on the gauge: paid only on what is staked into it.
    staked: tuple[MerklCampaign, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.unstaked or self.staked)

    @property
    def all(self) -> tuple[MerklCampaign, ...]:
        return self.unstaked + self.staked

    @property
    def apr(self) -> float:
        """The best rate on offer, which is the one a total should carry."""
        return max(
            (sum(c.apr for c in side) for side in (self.unstaked, self.staked)),
            default=0.0,
        )

    @property
    def tokens(self) -> tuple[MerklToken, ...]:
        """Every distinct token paid, priced ones first, in payout order."""
        return _distinct(c.tokens for c in self.all)

    @property
    def points(self) -> tuple[MerklToken, ...]:
        return tuple(token for token in self.tokens if token.points)

    def sides_for(self, token: MerklToken) -> tuple[tuple[str, float], ...]:
        """How to say what this token pays: `(qualifier, apr)` per row."""
        unstaked, staked = self.rate_for(token)
        if unstaked and staked:
            if abs(unstaked - staked) <= SAME_RATE:
                return (("", max(unstaked, staked)),)
            return (("unstaked LP", unstaked), ("staked", staked))
        if unstaked:
            return (("unstaked LP only", unstaked),)
        if staked:
            return (("staked only", staked),)
        return ()

    def rate_for(self, token: MerklToken) -> tuple[float, float]:
        """`(unstaked, staked)` APR for one token, zero where it is not paid."""
        return (
            _rate(self.unstaked, token),
            _rate(self.staked, token),
        )


def _rate(campaigns: Sequence[MerklCampaign], token: MerklToken) -> float:
    return sum(c.apr for c in campaigns if token in c.tokens)


def _distinct(groups: Iterable[Sequence[MerklToken]]) -> tuple[MerklToken, ...]:
    """Flatten token lists, dropping repeats, priced tokens first."""
    seen: list[MerklToken] = []
    for group in groups:
        for token in group:
            if token not in seen:
                seen.append(token)
    return tuple(sorted(seen, key=lambda t: t.points))


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def parse_opportunities(payload: Any) -> list[MerklCampaign]:
    """Read `/v4/opportunities` into campaigns, skipping anything not live."""
    if not isinstance(payload, list):
        return []
    campaigns = []
    for raw in payload:
        if not isinstance(raw, dict) or raw.get("status") != "LIVE":
            continue
        identifier = raw.get("identifier") or ""
        if not identifier:
            continue
        campaigns.append(
            MerklCampaign(
                chain_id=int(raw.get("chainId") or 0),
                identifier=identifier,
                name=raw.get("name") or "",
                apr=_float(raw.get("apr")),
                opportunity_id=str(raw.get("id") or ""),
                tokens=_tokens(raw),
            )
        )
    return campaigns


def parse_token(raw: Any) -> MerklToken | None:
    """One entry of `/v4/tokens`, or of a reward breakdown."""
    if not isinstance(raw, dict) or not (raw.get("symbol") or raw.get("name")):
        return None
    kind = (raw.get("type") or "").upper()
    return MerklToken(
        symbol=raw.get("symbol") or raw.get("name") or "?",
        address=raw.get("address") or "",
        points=kind == POINT_TYPE or kind not in PRICED_TYPES,
        underlying_id=_underlying_id(raw),
    )


def _underlying_id(raw: dict[str, Any]) -> str:
    """The wrapper's underlying, ignoring the ones that point at themselves."""
    underlying = str(raw.get("underlyingTokenId") or "")
    return "" if underlying == str(raw.get("id") or "") else underlying


def parse_tokens(payload: Any) -> dict[str, MerklToken]:
    """`/v4/tokens?id=…&id=…`, keyed by Merkl's id."""
    if not isinstance(payload, list):
        return {}
    found = {}
    for raw in payload:
        token = parse_token(raw)
        if token is not None and isinstance(raw, dict) and raw.get("id"):
            found[str(raw["id"])] = token
    return found


def underlying_ids(campaigns: Iterable[MerklCampaign]) -> set[str]:
    """Every wrapper's underlying that still needs looking up."""
    return {
        token.underlying_id
        for campaign in campaigns
        for token in campaign.tokens
        if token.underlying_id
    }


def with_underlying(
    campaigns: Iterable[MerklCampaign], resolved: dict[str, MerklToken]
) -> list[MerklCampaign]:
    """Attach what each wrapper actually pays. Unresolved ones are left alone."""

    def fill(token: MerklToken) -> MerklToken:
        underlying = resolved.get(token.underlying_id)
        if underlying is None:
            return token
        return replace(token, underlying=underlying)

    return [
        replace(campaign, tokens=tuple(fill(t) for t in campaign.tokens))
        for campaign in campaigns
    ]


def _tokens(raw: dict[str, Any]) -> tuple[MerklToken, ...]:
    record = raw.get("rewardsRecord")
    breakdowns = record.get("breakdowns") if isinstance(record, dict) else None
    tokens: list[MerklToken] = []
    for entry in breakdowns or []:
        found = parse_token(entry.get("token") if isinstance(entry, dict) else None)
        if found is not None and found not in tokens:
            tokens.append(found)
    return tuple(tokens)


def by_identifier(campaigns: Iterable[MerklCampaign]) -> dict[str, list[MerklCampaign]]:
    """Group campaigns by the (lowercased) address they watch."""
    index: dict[str, list[MerklCampaign]] = {}
    for campaign in campaigns:
        index.setdefault(campaign.identifier.lower(), []).append(campaign)
    return index


def split(
    index: dict[str, list[MerklCampaign]],
    *,
    pool: str = "",
    lp_token: str = "",
    gauge: str = "",
) -> MerklRewards:
    """Find this pool's campaigns and say which side of the gauge each is on."""
    seen: set[int] = set()

    def look(*addresses: str) -> tuple[MerklCampaign, ...]:
        found: list[MerklCampaign] = []
        for address in addresses:
            for campaign in index.get((address or "").lower(), ()):
                if id(campaign) in seen:
                    continue
                seen.add(id(campaign))
                found.append(campaign)
        return tuple(found)

    staked = look(gauge)
    return MerklRewards(unstaked=look(pool, lp_token), staked=staked)


#: An empty result, for a chain Merkl has never heard of and for every pool
#: before the lookup has landed.
NO_REWARDS = MerklRewards()
