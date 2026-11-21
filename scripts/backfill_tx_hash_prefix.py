#!/usr/bin/env python3
"""Backfill bare (unprefixed) EVM transaction hashes to the canonical `0x` form.

    python3 scripts/backfill_tx_hash_prefix.py              # dry run (default)
    python3 scripts/backfill_tx_hash_prefix.py --apply
    python3 scripts/backfill_tx_hash_prefix.py --apply --batch-size 500

WHY THIS IS A SCRIPT AND NOT A `_ensure_schema()` MIGRATION
-----------------------------------------------------------
`database/db.py::_ensure_schema()` is the right home for additive, idempotent
*schema* changes. This is none of those things in the way that matters:

1. It rewrites existing rows on a money-path table. `_ensure_schema` runs on
   EVERY boot of EVERY replica, and in webhook mode there are several. An
   unbounded `UPDATE` there means concurrent replicas racing the same rows and
   holding write locks while the bot is trying to come up -- paid for on every
   deploy, forever, to fix a finite backlog once.

2. It cannot be expressed safely as plain SQL. The obvious statement --
   `UPDATE swap_transactions SET tx_hash = '0x' || tx_hash
    WHERE tx_hash NOT LIKE '0x%' AND length(tx_hash) = 64`
   -- is WRONG. **TRON txids are canonically bare 64-char hex**, so that
   predicate matches them exactly and would corrupt every TRON row it touched.
   Telling EVM from TRON needs `from_chain`/`to_chain` checked against the
   chain registry, which lives in `bot/config/chains.py`, not in SQL. 43 of the
   46 configured chains are EVM and exactly one is TRON, which is precisely the
   kind of near-miss that a boot-time one-liner gets wrong silently.

3. It is not required for correctness. Every read path is tolerant of both
   spellings (`tx_hash_variants`), so this backfill only tidies the data; it
   does not unblock anything. Nothing justifies putting it in the boot path.

So: an operator runs it deliberately, once, having read the dry-run output.

WHAT IT TOUCHES
---------------
Only rows whose owning chain resolves to EVM or Starknet in the chain registry,
and only values that are bare hex. Solana (base58) and TRON (bare hex by
convention) are skipped by chain, never by shape.

  tx_hash              -> keyed on from_chain (source-chain hash)
  destination_tx_hash  -> keyed on to_chain   (lands on the destination chain)
  bridge_tx_hash       -> only when BOTH from_chain and to_chain are
                          hex-prefixed chains, since which leg the bridge hash
                          belongs to is not recorded. Conservative on purpose.

Idempotent: a second run finds nothing to do. Safe to interrupt -- it commits
per batch, and re-running resumes from the next id.

IT TOUCHES ONLY `swap_transactions`
-----------------------------------
Other tables hold the same hashes (notably
`execution_child_placements.external_tx_hash`) and are NOT rewritten, so after
a run the two can legitimately disagree on spelling AND on case -- this script
folds `0xAbC...` to `0xabc...`, and rows recorded through `/swap/record` before
canonicalization kept whatever case the client sent.

Every cross-table comparison must therefore fold case on BOTH sides, not just
match `tx_hash_variants` (which carries the incoming value's casing, not the
one already stored in the other column). `_same_tx_identity` in
`bot/services/legacy_swap_execution_adapter.py` does this; a money-path review
found that without it this backfill would make that adapter's identity guard
raise on every poll pass, before the commit, so the swap could never be written
COMPLETED or FAILED. Before adding a new reader of any of these columns, check
it against that helper.

See bot/utils/tx_hash.py for why the column holds two spellings at all.
"""

import argparse
import logging
import os
import sys
from collections import Counter
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_tx_hash")

# Which columns we fix, and the column naming the chain that each one lives on.
# bridge_tx_hash has no single owning chain, so it is gated on both (see below).
COLUMN_CHAIN_SOURCES: List[Tuple[str, Tuple[str, ...]]] = [
    ("tx_hash", ("from_chain",)),
    ("destination_tx_hash", ("to_chain",)),
    ("bridge_tx_hash", ("from_chain", "to_chain")),
]


def _hex_prefixed_chain_names() -> frozenset:
    """Chain names whose tx hashes are 0x-prefixed hex, from the registry.

    Derived rather than hardcoded so a newly added chain is covered without
    editing this script -- and so TRON/Solana can never drift into the set.
    """
    from bot.config.chains import CHAINS

    chains = CHAINS.values() if isinstance(CHAINS, dict) else CHAINS
    names = set()
    for chain in chains:
        chain_type = getattr(getattr(chain, "chain_type", None), "value", None)
        if chain_type in ("evm", "starknet"):
            names.add(chain.name.strip().lower())
    return frozenset(names)


def _plan_row(
    row: Dict[str, Optional[str]],
    hex_chains: frozenset,
) -> Tuple[Dict[str, str], Counter]:
    """Return {column: canonical_value} for the columns this row needs changed."""
    from bot.utils.tx_hash import canonical_tx_hash, looks_like_evm_tx_hash

    updates: Dict[str, str] = {}
    skips: Counter = Counter()

    for column, chain_columns in COLUMN_CHAIN_SOURCES:
        value = row.get(column)
        if not value or not isinstance(value, str):
            continue

        chains = [(row.get(c) or "").strip().lower() for c in chain_columns]
        if not all(chains):
            skips[f"{column}: chain column empty"] += 1
            continue
        if not all(c in hex_chains for c in chains):
            # Solana/TRON/unknown. Deliberately skipped BY CHAIN -- a bare TRON
            # txid has the same shape as a bare EVM hash and must keep its form.
            skips[f"{column}: non-hex chain ({'/'.join(sorted(set(chains)))})"] += 1
            continue

        stripped = value.strip()
        if stripped[:2].lower() == "0x":
            # Already prefixed. Fold case only if it is not already lowercase.
            canonical = canonical_tx_hash(stripped, chains[0])
            if canonical != value:
                updates[column] = canonical
            continue

        if not looks_like_evm_tx_hash(stripped):
            # Bare but not 64 hex chars: not something we can vouch for.
            skips[f"{column}: bare but not 64-hex"] += 1
            continue

        canonical = canonical_tx_hash(stripped, chains[0])
        if canonical != value and str(canonical).startswith("0x"):
            updates[column] = canonical
        else:
            skips[f"{column}: canonicalization refused"] += 1

    return updates, skips


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill bare EVM tx hashes in swap_transactions to 0x form."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write. Without it the script only reports (default).",
    )
    parser.add_argument(
        "--batch-size", type=int, default=1000, help="Rows committed per batch (default 1000)."
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Stop after examining this many rows."
    )
    args = parser.parse_args()

    from sqlalchemy import or_

    from bot.models.swap import SwapTransaction
    from database.db import get_session

    hex_chains = _hex_prefixed_chain_names()
    logger.info(
        "Chains treated as 0x-hex: %d (Solana and TRON are excluded by chain, "
        "not by hash shape)",
        len(hex_chains),
    )
    if not hex_chains:
        logger.error("Chain registry resolved no EVM chains -- refusing to run.")
        return 2

    mode = "APPLY" if args.apply else "DRY RUN"
    logger.info("Mode: %s", mode)

    examined = 0
    planned_rows = 0
    per_column: Counter = Counter()
    all_skips: Counter = Counter()
    samples: List[str] = []

    with get_session() as session:
        # Keyset pagination on `id`, deliberately NOT Query.yield_per().
        # On SQLAlchemy 2.x yield_per sets stream_results=True, which with
        # psycopg2 is a named server-side cursor -- and the per-batch
        # session.commit() in _flush() ends the transaction that cursor lives
        # in, so the next fetch raises and the run dies after its first
        # committed batch. Re-reading from `id > last_id` each round survives
        # the commit and is what makes "resumable" actually true.
        last_id = 0
        pending: List[Tuple[int, Dict[str, str]]] = []
        done = False

        while not done:
            batch = (
                session.query(
                    SwapTransaction.id,
                    SwapTransaction.from_chain,
                    SwapTransaction.to_chain,
                    SwapTransaction.tx_hash,
                    SwapTransaction.bridge_tx_hash,
                    SwapTransaction.destination_tx_hash,
                )
                .filter(
                    SwapTransaction.id > last_id,
                    # Any row carrying at least one hash. Narrowing this in SQL
                    # is not possible without the chain-awareness that lives in
                    # Python (a bare 64-hex TRON txid looks exactly like a bare
                    # EVM one), so the filtering decision is made in _plan_row.
                    or_(
                        SwapTransaction.tx_hash.isnot(None),
                        SwapTransaction.bridge_tx_hash.isnot(None),
                        SwapTransaction.destination_tx_hash.isnot(None),
                    ),
                )
                .order_by(SwapTransaction.id)
                .limit(args.batch_size)
                .all()
            )
            if not batch:
                break

            for row in batch:
                last_id = row.id
                examined += 1
                if args.limit is not None and examined > args.limit:
                    examined -= 1
                    done = True
                    break

                row_dict = {
                    "from_chain": row.from_chain,
                    "to_chain": row.to_chain,
                    "tx_hash": row.tx_hash,
                    "bridge_tx_hash": row.bridge_tx_hash,
                    "destination_tx_hash": row.destination_tx_hash,
                }
                updates, skips = _plan_row(row_dict, hex_chains)
                all_skips.update(skips)
                if not updates:
                    continue

                planned_rows += 1
                for column in updates:
                    per_column[column] += 1
                if len(samples) < 10:
                    column = next(iter(updates))
                    samples.append(
                        f"  id={row.id} {row.from_chain}->{row.to_chain} "
                        f"{column}: {row_dict[column]} -> {updates[column]}"
                    )

                if args.apply:
                    pending.append((row.id, updates))

            if args.apply and pending:
                _flush(session, pending)
                logger.info("  committed %d rows (examined %d)", len(pending), examined)
                pending.clear()

        if args.apply and pending:
            _flush(session, pending)
            logger.info("  committed %d rows (examined %d)", len(pending), examined)

    logger.info("")
    logger.info("Examined rows        : %d", examined)
    logger.info("Rows needing change  : %d", planned_rows)
    for column, count in sorted(per_column.items()):
        logger.info("  %-20s %d", column, count)
    if samples:
        logger.info("Samples:")
        for line in samples:
            logger.info("%s", line)
    if all_skips:
        logger.info("Skipped (by reason):")
        for reason, count in sorted(all_skips.items(), key=lambda kv: -kv[1])[:12]:
            logger.info("  %-44s %d", reason, count)

    if not args.apply and planned_rows:
        logger.info("")
        logger.info("Dry run -- nothing written. Re-run with --apply to commit.")
    return 0


def _flush(session, pending: List[Tuple[int, Dict[str, str]]]) -> None:
    """Apply one batch of per-row column updates and commit."""
    from bot.models.swap import SwapTransaction

    for row_id, updates in pending:
        session.query(SwapTransaction).filter(SwapTransaction.id == row_id).update(
            updates, synchronize_session=False
        )
    session.commit()


if __name__ == "__main__":
    sys.exit(main())
