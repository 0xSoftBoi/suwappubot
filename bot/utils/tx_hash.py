"""Canonical transaction-hash handling for swap records. [MONEY-PATH]

Why this module exists
----------------------
``requirements.txt`` pins ``hexbytes==1.3.1`` (via ``web3==7.16.0``). From
hexbytes 1.x onward ``HexBytes.hex()`` returns the digest **without** the
``0x`` prefix::

    >>> Web3.keccak(hexstr="0xdeadbeef").hex()
    'd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1'
    >>> Web3.to_hex(Web3.keccak(hexstr="0xdeadbeef"))
    '0xd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1'

Every EVM executor in ``swap_engine`` returns ``tx_hash.hex()``, so EVM swap
rows historically carry **bare** hashes, while hashes from provider APIs and
block explorers are ``0x``-prefixed. ``SwapTransaction.tx_hash`` therefore
holds a mix of both spellings.

That mix breaks two things:

1. **Equality comparisons.** ``stored == explorer_supplied`` can never match
   across spellings, silently turning guards into no-ops.
2. **Raw JSON-RPC calls.** Node tolerance is provider-dependent. Verified
   live against a real mainnet receipt::

       ethereum-rpc.publicnode.com  bare -> accepted
       eth.drpc.org                 bare -> {"error": "json: cannot unmarshal
                                             hex string without 0x prefix"}

   ``*.drpc.org`` sits in the default RPC rotation for 14 chains in
   ``bot/config/settings.py`` (and is *first* for tempo), so a bare hash
   presents as a transaction that simply never resolves.

The canonical form
------------------
``0x`` + lowercase hex. It is what JSON-RPC requires, what explorers expect,
and what ``Web3.to_hex`` produces.

Policy: **normalize on write, stay tolerant on read.** Existing rows are not
rewritten by application code, so every read path that compares a hash must go
through :func:`tx_hash_variants` rather than ``==``.

Non-EVM chains are *not* hex-prefixed and must pass through untouched:

* **Solana** signatures are base58 (case-sensitive -- never lowercase them).
* **TRON** txids are canonically **bare** 64-char hex. They have the exact
  same shape as a bare EVM hash, so shape alone cannot distinguish the two.
  This is why :func:`canonical_tx_hash` is chain-aware and refuses to guess.

Relationship to ``bot/services/swap_nonce.py`` (branch amazing-bell-ykhxgv)
---------------------------------------------------------------------------
That unmerged branch adds an 819-line nonce-recording module at
``bot/services/swap_nonce.py`` which defines its own ``canonical_tx_hash`` and
``tx_hash_variants``. They are **deliberately different** from these, and the
difference is not an accident on either side:

===================  ==============================  =========================
                     swap_nonce (that branch)        this module
===================  ==============================  =========================
signature            ``canonical_tx_hash(value)``    ``(value, chain=None)``
non-hex input        returns ``None``                returns input unchanged
``tx_hash_variants`` ``list[str]``, ``[]`` on junk   ``frozenset``
chain awareness      none (EVM-only by context)      required to add a prefix
===================  ==============================  =========================

Theirs is strict and fail-closed because its caller is a nonce-ownership guard:
an unparseable value must produce an EMPTY list, so the caller cannot read
"query found nothing" as "no other swap owns this hash". Ours passes unknown
values through because its callers handle legitimately non-hex hashes -- a
Solana base58 signature must still match its own row, and a bare TRON txid must
keep its form.

Both behaviours are correct for their own call sites, which is exactly why they
must not share a name. So this module lives here and nothing re-exports it from
``bot/services/swap_nonce.py``; that path belongs to the nonce module. **When
that branch merges there is no file conflict, but do not then "unify" the two
functions without reading both docstrings** -- collapsing them either way
silently breaks one set of callers. If they are ever merged, the chain-aware
form must win for swap/CCTP/explorer paths and the fail-closed form for the
nonce guard; that likely means two differently-named functions, not one.
"""

from typing import Any, FrozenSet, Optional

__all__ = [
    "EVM_HASH_HEX_LEN",
    "canonical_tx_hash",
    "looks_like_evm_tx_hash",
    "rpc_tx_hash",
    "tx_hash_variants",
]

# An EVM transaction hash is keccak256: 32 bytes == 64 hex characters.
EVM_HASH_HEX_LEN = 64

# Chain types whose transaction hashes are 0x-prefixed hex. Starknet hashes are
# felt252 and may be SHORTER than 64 hex chars (leading zeros are stripped by
# most tooling), so they are prefix-normalized but never length-checked.
_HEX_PREFIXED_CHAIN_TYPES = frozenset({"evm", "starknet"})

# Chain types that must pass through verbatim. Solana is base58 and
# case-sensitive; TRON is bare hex by convention.
_PASSTHROUGH_CHAIN_TYPES = frozenset({"solana", "tron"})


def _chain_type_name(chain: Any) -> Optional[str]:
    """Best-effort extraction of a lowercase chain-type name.

    Accepts a ``ChainConfig``, a ``ChainType``, or a plain string (either a
    chain *type* like ``"evm"`` or a chain *name* like ``"ethereum"``).
    Returns ``None`` when the chain cannot be resolved, which callers must
    treat as "do not guess".

    Imports of ``bot.config.chains`` are done lazily, and this module is kept a
    **leaf** on purpose. It is imported from ``bot/utils/formatters.py``, which
    ``bot/utils/__init__.py`` imports eagerly, so a module-scope import of
    anything in ``bot/services/`` here would drag the whole service package
    (wallet, swap_engine, web3, solders) into that path for the sake of a
    dependency-free string helper. Both import orders were verified to boot
    with the heavier arrangement too, so this is dependency hygiene rather
    than a fix for a crash.
    """
    if chain is None:
        return None

    # ChainType enum, or anything exposing .chain_type (ChainConfig).
    chain_type = getattr(chain, "chain_type", None)
    if chain_type is not None:
        value = getattr(chain_type, "value", chain_type)
        if isinstance(value, str):
            return value.lower()

    value = getattr(chain, "value", None)
    if isinstance(value, str):
        return value.lower()

    if not isinstance(chain, str):
        return None

    candidate = chain.strip().lower()
    if not candidate:
        return None
    if candidate in _HEX_PREFIXED_CHAIN_TYPES or candidate in _PASSTHROUGH_CHAIN_TYPES:
        return candidate

    # Treat it as a chain *name* and look up its type.
    try:
        from bot.config.chains import get_chain_by_name

        resolved = get_chain_by_name(candidate)
    except Exception:
        return None
    if resolved is None:
        return None
    resolved_type = getattr(resolved, "chain_type", None)
    resolved_value = getattr(resolved_type, "value", resolved_type)
    return resolved_value.lower() if isinstance(resolved_value, str) else None


def _hex_body(value: str) -> Optional[str]:
    """Return the lowercase hex body of ``value`` (prefix stripped), or None.

    ``None`` means "this is not hex", which is the signal that a value is a
    base58 Solana signature (or junk) and must not be touched.
    """
    body = value[2:] if value[:2].lower() == "0x" else value
    if not body:
        return None
    try:
        int(body, 16)
    except ValueError:
        return None
    return body.lower()


def looks_like_evm_tx_hash(value: Any) -> bool:
    """True when ``value`` has the shape of an EVM tx hash (64 hex chars).

    Shape only -- a bare TRON txid also satisfies this, which is precisely why
    :func:`canonical_tx_hash` will not prefix without knowing the chain.
    """
    if not isinstance(value, str):
        return False
    body = _hex_body(value.strip())
    return body is not None and len(body) == EVM_HASH_HEX_LEN


def canonical_tx_hash(value: Any, chain: Any = None) -> Any:
    """Return the canonical spelling of a transaction hash.

    For hex-prefixed chains (EVM, Starknet) that is ``0x`` + lowercase hex.
    For Solana/TRON the value is returned with whitespace trimmed but
    otherwise untouched.

    Args:
        value: The hash as produced by an executor, provider API or DB row.
            Non-strings (including ``None``) are returned unchanged.
        chain: A ``ChainConfig``, ``ChainType``, chain-type string or chain
            name. **Required to add a missing prefix** -- without it this
            function cannot tell a bare EVM hash from a bare TRON txid, and
            will not guess.

    Returns:
        The canonical hash, or ``value`` unchanged when it cannot be
        normalized safely. Never raises.
    """
    if not isinstance(value, str):
        return value

    trimmed = value.strip()
    if not trimmed:
        return value

    chain_type = _chain_type_name(chain)
    if chain_type in _PASSTHROUGH_CHAIN_TYPES:
        # base58 (Solana) or bare-hex-by-convention (TRON). Case is
        # significant for base58, so do not fold it.
        return trimmed

    body = _hex_body(trimmed)
    if body is None:
        # Not hex at all -- a base58 signature on an unresolved chain. Leave it.
        return trimmed

    already_prefixed = trimmed[:2].lower() == "0x"
    if already_prefixed:
        # Safe regardless of chain: it is already hex-prefixed, so only the
        # case is being canonicalized.
        return "0x" + body

    if chain_type in _HEX_PREFIXED_CHAIN_TYPES:
        return "0x" + body

    # Bare hex on an unknown chain: could be EVM (needs 0x) or TRON (must not
    # get one). Refuse to guess -- read paths use tx_hash_variants() instead.
    return trimmed


def rpc_tx_hash(value: Any) -> Any:
    """Return the spelling to put in an ``eth_*``/``starknet_*`` JSON-RPC param.

    Call sites that use this are already EVM- or Starknet-only by construction
    (a Solana signature never reaches ``eth_getTransactionReceipt``), so the
    chain is implied and a bare 64-hex value is unambiguously an EVM hash that
    strict nodes such as drpc would otherwise reject outright.
    """
    if not isinstance(value, str):
        return value
    trimmed = value.strip()
    body = _hex_body(trimmed)
    if body is None:
        return trimmed
    return "0x" + body


def tx_hash_variants(value: Any) -> FrozenSet[str]:
    """Every spelling ``value`` may have been persisted under.

    Use this for **all** comparisons against ``tx_hash``, ``bridge_tx_hash``
    and ``destination_tx_hash`` instead of ``==``, because rows written before
    normalization landed still carry the bare form (and are deliberately not
    rewritten).

    SQLAlchemy::

        q.filter(SwapTransaction.tx_hash.in_(tx_hash_variants(h)))

    Python::

        if stored in tx_hash_variants(incoming): ...

    Returns:
        A frozenset that always contains the value as given (trimmed) plus, for
        hex values, the bare and ``0x``-prefixed lowercase spellings. Empty
        frozenset for a falsy/non-string input, which makes an ``in_()`` filter
        match nothing rather than matching everything.
    """
    if not isinstance(value, str):
        return frozenset()

    trimmed = value.strip()
    if not trimmed:
        return frozenset()

    variants = {trimmed}

    body = _hex_body(trimmed)
    if body is not None:
        # Lowercase spellings are the only ones we ever write; include the
        # original casing above so a mixed-case legacy row still matches.
        variants.add(body)
        variants.add("0x" + body)

    return frozenset(variants)
