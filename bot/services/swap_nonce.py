"""Swap transaction-hash identity helpers. [MONEY-PATH]

The implementation lives in :mod:`bot.utils.tx_hash` and is re-exported here.

Why the split: ``formatters.format_tx_link`` needs to canonicalize a hash too,
and ``bot/utils/__init__.py`` imports ``.formatters`` eagerly. Keeping the
implementation under ``bot/services/`` would therefore make a dependency-free
string helper reachable only by importing the whole ``bot.services`` package
(wallet, swap_engine, web3, solders). The real code sits on a leaf module under
``bot/utils/`` instead; this module exists so service-layer callers can keep
importing ``bot.services.swap_nonce``, which is the path the nonce-guard work
on branch ``claude/amazing-bell-ykhxgv`` uses.

See :mod:`bot.utils.tx_hash` for the full rationale on why
``SwapTransaction.tx_hash`` holds two spellings of the same hash.
"""

from bot.utils.tx_hash import (
    EVM_HASH_HEX_LEN,
    canonical_tx_hash,
    looks_like_evm_tx_hash,
    rpc_tx_hash,
    tx_hash_variants,
)

__all__ = [
    "EVM_HASH_HEX_LEN",
    "canonical_tx_hash",
    "looks_like_evm_tx_hash",
    "rpc_tx_hash",
    "tx_hash_variants",
]
