"""On-chain fee-cashback rewards service (Rewards v1).

MONEY-PATH. Weekly epochs credit each user 10% of their own paid swap fees.
Aggregation is read-side (from ``fee_transactions``) at finalize time — no
per-swap write hooks, so a re-run of a failed finalize is naturally idempotent
(the epoch status transition is the once-only guard).

Settlement is EITHER on-chain (audited SuwappuRewardsDistributor, USDC on Base)
OR a custodial-balance credit — the entry status machine in
``bot/models/onchain_rewards.py`` guarantees never both.

Ops flow per epoch (admin `/rewards` subcommands, or scripts):
    finalize  -> aggregate + build Merkle tree + store proofs   (this service)
    publish   -> ops submits setEpoch(root, total, deadline) to the distributor,
                 then records the tx here (mark_published)
    reconcile -> read isClaimed() per leaf and settle claimed entries

Contract address / RPC come from env (REWARDS_DISTRIBUTOR_ADDRESS,
REWARDS_RPC_URL) rather than pydantic settings so this module adds zero
boot-time config surface.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func

from bot.models.fees import FeeTransaction
from bot.models.onchain_rewards import (
    ENTRY_STATUS_CARRYOVER,
    ENTRY_STATUS_CLAIMABLE,
    ENTRY_STATUS_CLAIMED_ONCHAIN,
    ENTRY_STATUS_CREDITED,
    ENTRY_STATUS_ONCHAIN,
    ENTRY_STATUS_ROLLED,
    EPOCH_STATUS_ACCRUING,
    EPOCH_STATUS_FINALIZED,
    EPOCH_STATUS_PUBLISHED,
    RewardEntry,
    RewardEpoch,
)
from bot.models.user import Wallet
from bot.utils.merkle import (
    build_distribution,
    sorted_entries,
    usd_to_base_units,
    verify_proof,
)
from eth_utils import to_checksum_address
from database.db import get_session

logger = logging.getLogger(__name__)

# Epoch 0 starts Monday 2026-01-05 00:00 UTC; each epoch is exactly 7 days.
EPOCH_ANCHOR = datetime(2026, 1, 5)
EPOCH_LENGTH = timedelta(days=7)

CASHBACK_RATE = 0.10  # 10% of the user's own paid fees
MIN_PAYOUT_USD = 1.0  # below this the amount carries over to the next epoch
PAYOUT_TOKEN = "USDC"
PAYOUT_CHAIN = "base"
DEFAULT_CLAIM_WINDOW = timedelta(days=90)

REWARDS_DISTRIBUTOR_ABI = [
    {
        "name": "isClaimed",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "epochId", "type": "uint256"},
            {"name": "index", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
]


def epoch_index_for(when: datetime) -> int:
    """Whole weeks elapsed since the anchor (clamped at 0)."""
    return max(0, int((when - EPOCH_ANCHOR) // EPOCH_LENGTH))


def epoch_window(index: int) -> Tuple[datetime, datetime]:
    start = EPOCH_ANCHOR + index * EPOCH_LENGTH
    return start, start + EPOCH_LENGTH


@dataclass
class RewardsSummary:
    """User-facing rollup for /rewards and the Mini App."""

    accruing_usd: float = 0.0
    accruing_epoch_index: int = 0
    accruing_ends_at: Optional[datetime] = None
    claimable_usd: float = 0.0  # settleable to custodial balance right now
    onchain_usd: float = 0.0  # published — claim via wallet in the Mini App
    lifetime_usd: float = 0.0  # everything ever settled
    carryover_usd: float = 0.0
    entries: List[dict] = field(default_factory=list)


class OnchainRewardsService:
    # --- epoch lifecycle -------------------------------------------------

    def get_or_create_epoch(self, index: int) -> RewardEpoch:
        starts_at, ends_at = epoch_window(index)
        with get_session() as session:
            epoch = session.query(RewardEpoch).filter(RewardEpoch.epoch_index == index).first()
            if epoch is None:
                epoch = RewardEpoch(
                    epoch_index=index,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    status=EPOCH_STATUS_ACCRUING,
                )
                session.add(epoch)
                session.flush()
            session.expunge(epoch)
            return epoch

    def finalize_epoch(self, index: int, now: Optional[datetime] = None) -> Tuple[bool, str]:
        """Aggregate the epoch, build the Merkle tree, store proofs.

        Idempotent: only an ``accruing`` epoch whose window has ended can be
        finalized, and the status flip happens in the same transaction as the
        entry inserts — a crash mid-way rolls everything back.
        """
        now = now or datetime.utcnow()
        starts_at, ends_at = epoch_window(index)
        if ends_at > now:
            return False, f"Epoch {index} is still accruing (ends {ends_at:%Y-%m-%d %H:%M} UTC)."

        with get_session() as session:
            epoch = (
                session.query(RewardEpoch)
                .filter(RewardEpoch.epoch_index == index)
                .with_for_update()
                .first()
            )
            if epoch is None:
                epoch = RewardEpoch(
                    epoch_index=index,
                    starts_at=starts_at,
                    ends_at=ends_at,
                    status=EPOCH_STATUS_ACCRUING,
                )
                session.add(epoch)
                session.flush()
            if epoch.status != EPOCH_STATUS_ACCRUING:
                return False, f"Epoch {index} is already {epoch.status}."

            # 1) Fee basis per user inside the window.
            basis_rows = (
                session.query(
                    FeeTransaction.user_id,
                    func.coalesce(func.sum(FeeTransaction.fee_amount_usd), 0.0),
                )
                .filter(
                    FeeTransaction.created_at >= starts_at,
                    FeeTransaction.created_at < ends_at,
                    FeeTransaction.fee_amount_usd.isnot(None),
                    FeeTransaction.fee_amount_usd > 0,
                )
                .group_by(FeeTransaction.user_id)
                .all()
            )
            basis: Dict[int, float] = {uid: float(total) for uid, total in basis_rows}

            # 2) Consume carryovers from earlier epochs (same transaction).
            # MONEY-PATH: consumption is a guarded bulk UPDATE (id IN … AND
            # status='carryover'), not read-then-mutate on ORM rows — if a
            # concurrent finalize already rolled any of these rows, the rowcount
            # mismatch aborts (and rolls back) this finalize instead of rolling
            # the same carryover into two epochs. Row locks (Postgres FOR UPDATE)
            # remain the first line of defense; this is the application-level
            # idempotency backstop.
            carry_rows = (
                session.query(RewardEntry.id, RewardEntry.user_id, RewardEntry.amount_usd)
                .join(RewardEpoch, RewardEntry.epoch_id == RewardEpoch.id)
                .filter(
                    RewardEntry.status == ENTRY_STATUS_CARRYOVER,
                    RewardEpoch.epoch_index < index,
                )
                .with_for_update(of=RewardEntry)
                .all()
            )
            carryover: Dict[int, float] = {}
            if carry_rows:
                rolled = (
                    session.query(RewardEntry)
                    .filter(
                        RewardEntry.id.in_([r.id for r in carry_rows]),
                        RewardEntry.status == ENTRY_STATUS_CARRYOVER,
                    )
                    .update(
                        {
                            RewardEntry.status: ENTRY_STATUS_ROLLED,
                            RewardEntry.settled_at: now,
                        },
                        synchronize_session=False,
                    )
                )
                if rolled != len(carry_rows):
                    raise RuntimeError(
                        f"carryover consumption raced: expected {len(carry_rows)} "
                        f"rows, rolled {rolled} — aborting finalize of epoch {index}"
                    )
                for row in carry_rows:
                    carryover[row.user_id] = carryover.get(row.user_id, 0.0) + row.amount_usd

            # 3) Per-user totals.
            user_ids = set(basis) | set(carryover)
            if not user_ids:
                epoch.status = EPOCH_STATUS_FINALIZED
                epoch.finalized_at = now
                return True, f"Epoch {index} finalized with no activity."

            totals: Dict[int, Tuple[float, float, float]] = {}
            for uid in user_ids:
                cashback = round(basis.get(uid, 0.0) * CASHBACK_RATE, 6)
                carry = round(carryover.get(uid, 0.0), 6)
                totals[uid] = (cashback, carry, round(cashback + carry, 6))

            # 4) Claim address = user's default (else first) active EVM wallet.
            wallets = (
                session.query(Wallet.user_id, Wallet.address, Wallet.is_default)
                .filter(
                    Wallet.user_id.in_(user_ids),
                    Wallet.chain_type == "evm",
                    Wallet.is_active == True,  # noqa: E712
                )
                .order_by(Wallet.is_default.desc(), Wallet.id.asc())
                .all()
            )
            claim_address: Dict[int, str] = {}
            for uid, address, _default in wallets:
                claim_address.setdefault(uid, address)

            # 5) Create entries; build the tree over payable entries WITH an address.
            entries: Dict[int, RewardEntry] = {}
            leaf_input: List[Tuple[str, int]] = []
            address_to_user: Dict[str, int] = {}
            # Sorted by user id so leaf assignment is deterministic — among N
            # users sharing one claim address, exactly the LOWEST uid gets the
            # on-chain leaf; the rest stay custodial-only.
            for uid, (cashback, carry, total) in sorted(totals.items()):
                entry = RewardEntry(
                    epoch_id=epoch.id,
                    user_id=uid,
                    cashback_usd=cashback,
                    carryover_usd=carry,
                    amount_usd=total,
                    fee_basis_usd=round(basis.get(uid, 0.0), 6),
                    claim_address=claim_address.get(uid),
                    status=(
                        ENTRY_STATUS_CLAIMABLE
                        if total >= MIN_PAYOUT_USD
                        else ENTRY_STATUS_CARRYOVER
                    ),
                )
                session.add(entry)
                entries[uid] = entry
                if entry.status == ENTRY_STATUS_CLAIMABLE and entry.claim_address:
                    base_units = usd_to_base_units(total)
                    if base_units > 0:
                        # Normalize once — sorted_entries/build_distribution work
                        # in checksummed form, so keys must match.
                        addr = to_checksum_address(entry.claim_address)
                        entry.claim_address = addr
                        if addr in address_to_user:
                            # Two users sharing one claim address cannot both hold
                            # a leaf — the second settles custodially only.
                            logger.warning(
                                "rewards: address %s shared by users %s/%s — "
                                "second user gets no on-chain leaf",
                                addr,
                                address_to_user[addr],
                                uid,
                            )
                            continue
                        address_to_user[addr] = uid
                        leaf_input.append((addr, base_units))

            if leaf_input:
                dist = build_distribution(leaf_input)
                for leaf_index, (addr, base_units) in enumerate(sorted_entries(leaf_input)):
                    entry = entries[address_to_user[addr]]
                    entry.leaf_index = leaf_index
                    entry.amount_base_units = str(base_units)
                    entry.merkle_proof = json.dumps(dist.proof_hex(leaf_index))
                epoch.merkle_root = dist.root_hex

            payable = [e for e in entries.values() if e.status == ENTRY_STATUS_CLAIMABLE]
            epoch.total_amount_usd = round(sum(e.amount_usd for e in payable), 6)
            epoch.entry_count = len(payable)
            epoch.status = EPOCH_STATUS_FINALIZED
            epoch.finalized_at = now

            return True, (
                f"Epoch {index} finalized: {len(payable)} payable entries, "
                f"${epoch.total_amount_usd:.2f} total, "
                f"{len(leaf_input)} on-chain leaves, root {epoch.merkle_root or '—'}."
            )

    def get_publish_payload(self, index: int) -> Optional[dict]:
        """The exact setEpoch() arguments ops must submit to the distributor."""
        with get_session() as session:
            epoch = session.query(RewardEpoch).filter(RewardEpoch.epoch_index == index).first()
            if epoch is None or epoch.status != EPOCH_STATUS_FINALIZED or not epoch.merkle_root:
                return None
            # Funded total = exact sum of the per-leaf base units (each leaf was
            # rounded down individually) — NOT usd_to_base_units(sum of USD),
            # which can exceed the claimable sum by dust and strand USDC.
            leaf_units = (
                session.query(RewardEntry.amount_base_units)
                .filter(
                    RewardEntry.epoch_id == epoch.id,
                    RewardEntry.leaf_index.isnot(None),
                )
                .all()
            )
            total_base_units = sum(int(units) for (units,) in leaf_units)
            deadline = datetime.utcnow() + DEFAULT_CLAIM_WINDOW
            return {
                "epochId": epoch.epoch_index,
                "merkleRoot": epoch.merkle_root,
                "totalAmountBaseUnits": total_base_units,
                "suggestedClaimDeadline": int(deadline.timestamp()),
                "token": PAYOUT_TOKEN,
                "chain": PAYOUT_CHAIN,
            }

    def mark_published(
        self, index: int, tx_hash: str, claim_deadline: datetime
    ) -> Tuple[bool, str]:
        """Record the on-chain setEpoch tx; flips leaf entries to on-chain-only."""
        with get_session() as session:
            epoch = (
                session.query(RewardEpoch)
                .filter(RewardEpoch.epoch_index == index)
                .with_for_update()
                .first()
            )
            if epoch is None or epoch.status != EPOCH_STATUS_FINALIZED:
                return False, f"Epoch {index} is not in a finalized state."
            epoch.status = EPOCH_STATUS_PUBLISHED
            epoch.published_tx_hash = tx_hash
            epoch.published_at = datetime.utcnow()
            epoch.claim_deadline = claim_deadline
            moved = (
                session.query(RewardEntry)
                .filter(
                    RewardEntry.epoch_id == epoch.id,
                    RewardEntry.status == ENTRY_STATUS_CLAIMABLE,
                    RewardEntry.leaf_index.isnot(None),
                )
                .update({RewardEntry.status: ENTRY_STATUS_ONCHAIN}, synchronize_session=False)
            )
            return True, f"Epoch {index} published ({moved} entries now on-chain-only)."

    # --- settlement ------------------------------------------------------

    def _custodially_settleable(self, session, user_id: int, now: datetime):
        """Entries this user may settle to custodial balance right now.

        claimable            -> always (epoch never published on-chain)
        onchain + deadline past -> the contract refuses claims after the
                                   deadline, so custodial credit cannot double-pay
        """
        rows = (
            session.query(RewardEntry, RewardEpoch)
            .join(RewardEpoch, RewardEntry.epoch_id == RewardEpoch.id)
            .filter(
                RewardEntry.user_id == user_id,
                RewardEntry.status.in_([ENTRY_STATUS_CLAIMABLE, ENTRY_STATUS_ONCHAIN]),
            )
            .with_for_update(of=RewardEntry)
            .all()
        )
        eligible = []
        for entry, epoch in rows:
            if entry.status == ENTRY_STATUS_CLAIMABLE:
                eligible.append(entry)
            elif (
                entry.status == ENTRY_STATUS_ONCHAIN
                and epoch.claim_deadline is not None
                and epoch.claim_deadline < now
            ):
                eligible.append(entry)
        return eligible

    def credit_custodial(self, user_id: int) -> Tuple[bool, str, float]:
        """Settle every custodially-settleable entry to the user's USDC balance.

        Mirrors referral_service.claim_rewards' crash-safe shape: statuses flip
        (and commit) BEFORE the balance credit; on credit failure they are
        restored. A crash between the two leaves entries marked ``credited``
        with no balance — visible in reconciliation as credited-without-settled
        amounts, never as a double pay.
        """
        now = datetime.utcnow()
        with get_session() as session:
            eligible = self._custodially_settleable(session, user_id, now)
            if not eligible:
                return False, "Nothing to claim right now.", 0.0
            total = round(sum(e.amount_usd for e in eligible), 6)
            prior = [(e.id, e.status) for e in eligible]
            for e in eligible:
                e.status = ENTRY_STATUS_CREDITED
                e.settled_at = now

        try:
            from bot.services.hot_wallet import hot_wallet_service

            hot_wallet_service.update_custodial_balance(
                user_id=user_id,
                chain=PAYOUT_CHAIN,
                token_symbol=PAYOUT_TOKEN,
                amount=Decimal(str(total)),
                operation="add",
            )
        except Exception as e:
            logger.error("rewards: custodial credit failed for user %s: %s", user_id, e)
            with get_session() as session:
                for entry_id, prior_status in prior:
                    session.query(RewardEntry).filter(RewardEntry.id == entry_id).update(
                        {RewardEntry.status: prior_status, RewardEntry.settled_at: None},
                        synchronize_session=False,
                    )
            return (
                False,
                "Could not credit your balance right now. Your rewards are safe — try again shortly.",
                0.0,
            )

        logger.info("rewards: credited $%.2f to user %s (%d entries)", total, user_id, len(prior))
        return True, f"${total:.2f} USDC credited to your balance.", total

    def reconcile_onchain(self, index: int) -> Tuple[bool, str, List[Tuple[int, float]]]:
        """Settle entries whose leaves the distributor reports as claimed.

        Returns (ok, message, [(user_id, amount_usd), ...]) for newly settled
        entries so the caller can notify users. Read-only against the chain;
        requires REWARDS_DISTRIBUTOR_ADDRESS + REWARDS_RPC_URL.
        """
        address = os.getenv("REWARDS_DISTRIBUTOR_ADDRESS")
        rpc_url = os.getenv("REWARDS_RPC_URL")
        if not address or not rpc_url:
            return False, "REWARDS_DISTRIBUTOR_ADDRESS / REWARDS_RPC_URL not configured.", []

        try:
            from web3 import Web3

            w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 15}))
            contract = w3.eth.contract(
                address=Web3.to_checksum_address(address), abi=REWARDS_DISTRIBUTOR_ABI
            )
        except Exception as e:
            return False, f"RPC connection failed: {e}", []

        with get_session() as session:
            epoch = session.query(RewardEpoch).filter(RewardEpoch.epoch_index == index).first()
            if epoch is None or epoch.status != EPOCH_STATUS_PUBLISHED:
                return False, f"Epoch {index} is not published.", []
            epoch_root = epoch.merkle_root
            pending = (
                session.query(
                    RewardEntry.id,
                    RewardEntry.user_id,
                    RewardEntry.leaf_index,
                    RewardEntry.amount_usd,
                    RewardEntry.claim_address,
                    RewardEntry.amount_base_units,
                    RewardEntry.merkle_proof,
                )
                .filter(
                    RewardEntry.epoch_id == epoch.id,
                    RewardEntry.status == ENTRY_STATUS_ONCHAIN,
                    RewardEntry.leaf_index.isnot(None),
                )
                .all()
            )

        settled: List[Tuple[int, float]] = []
        now = datetime.utcnow()
        for (
            entry_id,
            user_id,
            leaf_index,
            amount_usd,
            claim_addr,
            base_units,
            proof_json,
        ) in pending:
            # MONEY-PATH: isClaimed(index) alone only proves SOME leaf at that
            # index was claimed. Before terminally marking this user settled,
            # verify our stored proof still verifies against the published root —
            # if the root diverged from what we finalized, refuse to settle.
            try:
                proof = [bytes.fromhex(h[2:]) for h in json.loads(proof_json)]
                root_ok = verify_proof(
                    bytes.fromhex(epoch_root[2:]),
                    leaf_index,
                    claim_addr,
                    int(base_units),
                    proof,
                )
            except Exception as e:
                logger.error("rewards: proof re-verify failed for entry %s: %s", entry_id, e)
                continue
            if not root_ok:
                logger.error(
                    "rewards: stored proof for entry %s does NOT match epoch %s root — "
                    "root diverged? NOT settling.",
                    entry_id,
                    index,
                )
                continue
            try:
                claimed = contract.functions.isClaimed(index, leaf_index).call()
            except Exception as e:
                logger.warning("rewards: isClaimed(%s, %s) failed: %s", index, leaf_index, e)
                continue
            if not claimed:
                continue
            with get_session() as session:
                updated = (
                    session.query(RewardEntry)
                    .filter(
                        RewardEntry.id == entry_id,
                        RewardEntry.status == ENTRY_STATUS_ONCHAIN,
                    )
                    .update(
                        {
                            RewardEntry.status: ENTRY_STATUS_CLAIMED_ONCHAIN,
                            RewardEntry.settled_at: now,
                        },
                        synchronize_session=False,
                    )
                )
            if updated:
                settled.append((user_id, amount_usd))

        return True, f"Reconciled epoch {index}: {len(settled)} newly claimed on-chain.", settled

    # --- read side --------------------------------------------------------

    def get_user_summary(self, user_id: int, now: Optional[datetime] = None) -> RewardsSummary:
        now = now or datetime.utcnow()
        current_index = epoch_index_for(now)
        starts_at, ends_at = epoch_window(current_index)
        summary = RewardsSummary(accruing_epoch_index=current_index, accruing_ends_at=ends_at)

        with get_session() as session:
            live_basis = (
                session.query(func.coalesce(func.sum(FeeTransaction.fee_amount_usd), 0.0))
                .filter(
                    FeeTransaction.user_id == user_id,
                    FeeTransaction.created_at >= starts_at,
                    FeeTransaction.created_at < ends_at,
                    FeeTransaction.fee_amount_usd.isnot(None),
                    FeeTransaction.fee_amount_usd > 0,
                )
                .scalar()
            )
            summary.accruing_usd = round(float(live_basis) * CASHBACK_RATE, 6)

            rows = (
                session.query(RewardEntry, RewardEpoch)
                .join(RewardEpoch, RewardEntry.epoch_id == RewardEpoch.id)
                .filter(RewardEntry.user_id == user_id)
                .order_by(RewardEpoch.epoch_index.desc())
                .all()
            )
            for entry, epoch in rows:
                deadline_passed = epoch.claim_deadline is not None and epoch.claim_deadline < now
                if entry.status == ENTRY_STATUS_CLAIMABLE or (
                    entry.status == ENTRY_STATUS_ONCHAIN and deadline_passed
                ):
                    summary.claimable_usd += entry.amount_usd
                elif entry.status == ENTRY_STATUS_ONCHAIN:
                    summary.onchain_usd += entry.amount_usd
                elif entry.status in (ENTRY_STATUS_CREDITED, ENTRY_STATUS_CLAIMED_ONCHAIN):
                    summary.lifetime_usd += entry.amount_usd
                elif entry.status == ENTRY_STATUS_CARRYOVER:
                    summary.carryover_usd += entry.amount_usd
                summary.entries.append(
                    {
                        "epoch_index": epoch.epoch_index,
                        "amount_usd": entry.amount_usd,
                        "status": entry.status,
                        "claim_deadline": (
                            epoch.claim_deadline.isoformat() if epoch.claim_deadline else None
                        ),
                        "claimed_tx_hash": entry.claimed_tx_hash,
                    }
                )
            summary.claimable_usd = round(summary.claimable_usd, 6)
            summary.onchain_usd = round(summary.onchain_usd, 6)
            summary.lifetime_usd = round(summary.lifetime_usd, 6)
            summary.carryover_usd = round(summary.carryover_usd, 6)
        return summary


onchain_rewards_service = OnchainRewardsService()
