"""Secret screening for the data-capture pipeline (bot/services/capture_service.py).

FAIL CLOSED: on any ambiguity or internal error, treat input as unsafe. This
module gates whether raw user text is ever persisted to `user_intents` for
future fine-tuning — a false negative here means a private key or seed
phrase lands in a training dataset. A false positive just costs one row of
training text.

No vendored BIP-39 wordlist was found in this repo (checked eth_account,
searched for mnemonic/bip_utils packages and any vendored english.txt — none
present), so mnemonic detection falls back to a structural heuristic: a run
of >= 11 lowercase alpha tokens, each 3-8 chars, is treated as a probable
seed phrase. This is deliberately looser than word-list matching (some
ordinary sentences could trip it) because false positives are cheap and
false negatives are not.

Reuses the secret-shaped value patterns from bot/services/sentry_service.py
(`_SECRET_VALUE_PATTERNS`) rather than duplicating the hex/base58/JWT/AWS-key
regexes.
"""

from __future__ import annotations

import math
import re
from typing import Optional, Tuple

try:
    # Reuse the existing, audited secret-shape patterns instead of duplicating
    # them. These are private (leading underscore) but this module lives in
    # the same codebase and treats them as an internal shared constant.
    #
    # NOTE: sentry_service's catch-all long-hex pattern (`(0x)?[a-fA-F0-9]{40,}`)
    # is deliberately EXCLUDED here — a 40-hex-char EVM address matches it, and
    # addresses are explicitly not secrets for capture purposes (a swap
    # "send 1 eth to 0xabc...def" sentence must stay safe). Our own
    # `_HEX_PRIVATE_KEY` pattern below covers the 64-hex private-key case
    # instead. The Telegram-token / JWT / AWS-key / base58 patterns are
    # unambiguous and are reused as-is.
    from bot.services.sentry_service import _SECRET_VALUE_PATTERNS as _SENTRY_ALL_PATTERNS

    _SENTRY_SECRET_PATTERNS = tuple(p for p in _SENTRY_ALL_PATTERNS if "40," not in p.pattern)
except Exception:  # noqa: BLE001 — fail closed, not fail silent-import
    _SENTRY_SECRET_PATTERNS = ()

# --- Raw private key: 0x-prefixed or bare hex, 64+ chars ---
# Uses lookaround (not \b) so a 128-hex-char hex-encoded ed25519/Solana
# keypair — which \b cannot match mid-run of a longer hex string — is still
# caught. {64,} (not exactly 64) covers 64, 66 (0x+64), 128, and any longer
# hex secret. A 40-hex-char EVM/Tron address is well under the 64-char floor
# and stays unflagged.
_HEX_PRIVATE_KEY = re.compile(r"(?<![0-9a-fA-F])(0x)?[0-9a-fA-F]{64,}(?![0-9a-fA-F])")

# --- Solana / base58 secret keys (~64-128 base58 chars) ---
# Base58 alphabet excludes 0, O, I, l.
_BASE58_BLOB = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{64,128}\b")

# --- High-entropy whitespace-free token ---
_MIN_ENTROPY_LEN = 32
_MIN_ENTROPY_BITS = 3.5

# --- BIP-39-shaped mnemonic (structural fallback: no wordlist vendored) ---
_MNEMONIC_LENGTHS = {12, 15, 18, 21, 24}
_MNEMONIC_WORD = re.compile(r"^[a-z]{3,8}$")
_MIN_CONSECUTIVE_WORDLIKE_TOKENS = 11

# Attempt to load a real BIP-39 wordlist if one is vendored anywhere in the
# dependency tree. None found as of writing (see module docstring), but this
# keeps detection accurate for free if one shows up later (e.g. via
# `mnemonic` or `bip_utils` being added as a dependency).
_BIP39_WORDLIST: Optional[frozenset] = None
try:
    from mnemonic import Mnemonic as _Mnemonic  # type: ignore

    _BIP39_WORDLIST = frozenset(_Mnemonic("english").wordlist)
except Exception:  # noqa: BLE001
    try:
        from bip_utils import Bip39WordsListGetter, Bip39Languages  # type: ignore

        _wordlist_obj = Bip39WordsListGetter().GetByLanguage(Bip39Languages.ENGLISH)
        _BIP39_WORDLIST = frozenset(str(w) for w in _wordlist_obj.GetWords())
    except Exception:  # noqa: BLE001
        _BIP39_WORDLIST = None

_MIN_WORDLIST_HITS = 8


def _shannon_entropy(token: str) -> float:
    if not token:
        return 0.0
    freq: dict[str, int] = {}
    for ch in token:
        freq[ch] = freq.get(ch, 0) + 1
    length = len(token)
    entropy = 0.0
    for count in freq.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy


def _looks_like_mnemonic(tokens: list[str]) -> bool:
    """Detect a BIP-39-shaped mnemonic among whitespace-split tokens."""
    lowered = [t.lower() for t in tokens if t]

    if _BIP39_WORDLIST is not None:
        # Real wordlist available: look for >= _MIN_WORDLIST_HITS consecutive
        # tokens that are wordlist members.
        run = 0
        for tok in lowered:
            if tok in _BIP39_WORDLIST:
                run += 1
                if run >= _MIN_WORDLIST_HITS:
                    return True
            else:
                run = 0
        return False

    # Fallback heuristic: no wordlist available. Treat >= 11 consecutive
    # alpha tokens, all lowercase, length 3-8, as unsafe. This also matches
    # phrases of the canonical 12/15/18/21/24 lengths when the whole input
    # is (close to) just the phrase.
    run = 0
    best = 0
    for tok in lowered:
        if _MNEMONIC_WORD.match(tok):
            run += 1
            best = max(best, run)
        else:
            run = 0
    if best >= _MIN_CONSECUTIVE_WORDLIKE_TOKENS:
        return True

    # Exact canonical mnemonic length + every token wordlike -> unsafe even
    # if the run counter above didn't fire (e.g. exactly 12 tokens total).
    if len(lowered) in _MNEMONIC_LENGTHS and all(_MNEMONIC_WORD.match(t) for t in lowered):
        return True

    return False


def screen_for_secrets(text: str) -> Tuple[bool, Optional[str]]:
    """Screen free text for secrets before it is persisted for training data.

    Returns (is_unsafe, reason). Fails closed: any internal error or
    ambiguity is treated as unsafe with reason 'screen_error'.

    This function must never raise.
    """
    try:
        if text is None:
            return False, None
        if not isinstance(text, str):
            return True, "non_string_input"

        stripped = text.strip()
        if not stripped:
            return False, None

        tokens = stripped.split()

        # 1. Mnemonic-shaped input.
        if _looks_like_mnemonic(tokens):
            return True, "mnemonic_detected"

        # 2. Raw private key (hex).
        if _HEX_PRIVATE_KEY.search(stripped):
            return True, "private_key_detected"

        # 3. Solana/base58 secret key.
        if _BASE58_BLOB.search(stripped):
            return True, "base58_secret_detected"

        # 4. Reused sentry secret-value patterns (Telegram token, JWT, AWS key,
        #    long hex, base58 — kept in sync with sentry_service.py).
        for pattern in _SENTRY_SECRET_PATTERNS:
            if pattern.search(stripped):
                return True, "secret_pattern_detected"

        # 5. High-entropy whitespace-free token. Pure hex tokens (e.g. a
        # 40-hex-char EVM/Tron address) are excluded here: hex has a fixed
        # max entropy of 4 bits/char, so essentially ANY hex string of this
        # length trips the threshold, and addresses are explicitly not
        # secrets. Actual hex private keys are still caught by
        # `_HEX_PRIVATE_KEY` above (64 hex chars).
        for token in tokens:
            if len(token) < _MIN_ENTROPY_LEN:
                continue
            bare = token[2:] if token.lower().startswith("0x") else token
            if re.fullmatch(r"[0-9a-fA-F]+", bare):
                continue
            if _shannon_entropy(token) > _MIN_ENTROPY_BITS:
                return True, "high_entropy_token"

        return False, None
    except Exception:  # noqa: BLE001 — fail closed on any unexpected error
        return True, "screen_error"
