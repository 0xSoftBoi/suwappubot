"""Pure helpers for classifying a non-custodial wallet provider tag.

Kept dependency-free so it can be imported by the FastAPI auth route and unit
tested without standing up the app.
"""

from typing import Optional

# Keyless / client-signing providers — the wallet or hardware device signs, never
# the server. "ledger" is a hardware wallet; "external" is any software wallet.
EXTERNAL_PROVIDERS = ("external", "ledger")


def normalize_wallet_provider(raw: Optional[str]) -> str:
    """Normalize a client-supplied provider tag for a non-custodial wallet.

    Only "ledger" is special-cased; anything else (or absent) collapses to the
    keyless "external" default, so a bogus or malicious value can never select a
    custodial ("turnkey"/"local") signing path.
    """
    tag = (raw or "external").strip().lower()
    return tag if tag in EXTERNAL_PROVIDERS else "external"
