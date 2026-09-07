"""Point campaigns that no API knows about, kept in Curve's own frontend."""

from __future__ import annotations

import re
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

#: The `main` branch, raw. A tag would be reproducible and would also stop
#: reporting campaigns the day it went stale, which is the opposite of what
#: this file is for.
EXTERNAL_BASE = (
    "https://raw.githubusercontent.com/curvefi/curve-frontend"
    "/main/packages/external-rewards/src"
)

#: The list of campaign files. Read rather than hardcoded: a new platform is
#: a new file plus a line here, and a list kept locally would show the same
#: nothing for it as for a platform that has no campaign at all.
MANIFEST = f"{EXTERNAL_BASE}/campaign-list.json"

#: The only action that describes a pool. `supply` and `borrow` belong to
#: lending markets, which this app does not list.
LP_ACTION = "lp"

#: A file name and nothing else -- see `parse_manifest`.
_SAFE_NAME = re.compile(r"[A-Za-z0-9._-]+")

#: A multiplier that reads as one: `30x`, `2.5x`, `0-1x`, `15+`.
_MULTIPLIER = re.compile(r"[\d.]+(-[\d.]+)?[x+]")


@dataclass(frozen=True, slots=True)
class ExternalCampaign:
    """One platform's offer on one pool."""

    platform: str
    #: Where the platform itself reports what you have earned.
    dashboard: str
    network: str
    address: str
    #: Free text: `30x`, `15+`, `crvUSD`, or empty.
    multiplier: str = ""
    #: The campaign's own line, where it has one -- e.g.
    note: str = ""
    tags: tuple[str, ...] = ()
    #: Unix seconds, or 0 for "no stated window".
    starts: int = 0
    #: Unix seconds. Recorded, deliberately not enforced -- see the
    #: module docstring for the count that settles why.
    ends: int = 0

    @property
    def points(self) -> bool:
        """Points rather than tokens, which is the default where neither is said."""
        return "tokens" not in self.tags

    @property
    def label(self) -> str:
        """`Ethena 30x`, or the platform alone where the multiplier is prose."""
        if _MULTIPLIER.fullmatch(self.multiplier):
            return f"{self.platform} {self.multiplier}"
        return self.platform

    def describe(self) -> str:
        """The long form, for a tooltip: who, what, and any caveat."""
        kind = "points" if self.points else "token rewards"
        rate = f" at {self.multiplier}" if _MULTIPLIER.fullmatch(self.multiplier) else ""
        line = f"{self.platform} {kind}{rate} for providing liquidity."
        return f"{line} {self.note}" if self.note else line

    def started_by(self, now: float) -> bool:
        """Has this begun? An unstated start has always been running."""
        return not self.starts or now >= self.starts


def _int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _text(value: Any) -> str:
    """A field upstream writes as the string "null" when it means nothing."""
    text = str(value or "").strip()
    return "" if text.lower() == "null" else text


def parse_manifest(payload: Any) -> list[str]:
    """The campaign file names, in the order upstream lists them."""
    if not isinstance(payload, list):
        return []
    names = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        name = _text(entry.get("campaign"))
        if name.endswith(".json") and _SAFE_NAME.fullmatch(name):
            names.append(name)
    return names


def parse_campaign(payload: Any, *, now: float | None = None) -> list[ExternalCampaign]:
    """One platform's file, as the pools it currently covers."""
    if not isinstance(payload, dict):
        return []
    when = time.time() if now is None else now
    platform = _text(payload.get("platform"))
    dashboard = _text(payload.get("dashboardLink"))
    found = []
    for raw in payload.get("pools") or []:
        if not isinstance(raw, dict) or _text(raw.get("action")) != LP_ACTION:
            continue
        address = _text(raw.get("address"))
        network = _text(raw.get("network"))
        if not address or not network:
            continue
        campaign = ExternalCampaign(
            platform=platform or "?",
            dashboard=dashboard,
            network=network.lower(),
            address=address,
            multiplier=_text(raw.get("multiplier")),
            note=_text(raw.get("description")),
            tags=tuple(_text(t) for t in raw.get("tags") or [] if _text(t)),
            starts=_int(raw.get("campaignStart")),
            ends=_int(raw.get("campaignEnd")),
        )
        if campaign.started_by(when):
            found.append(campaign)
    return found


def by_pool(
    campaigns: Iterable[ExternalCampaign],
) -> dict[tuple[str, str], list[ExternalCampaign]]:
    """Group by `(chain name, lowercased pool address)`."""
    index: dict[tuple[str, str], list[ExternalCampaign]] = {}
    for campaign in campaigns:
        index.setdefault((campaign.network, campaign.address.lower()), []).append(
            campaign
        )
    return index
