"""Tests for on-chain fee-cashback rewards (Rewards v1).

Covers the two MONEY-PATH surfaces:
  1. bot/utils/merkle.py — the tree must be deterministic and self-verifying
     (what we publish is what users claim against).
  2. bot/services/onchain_rewards_service.py — accrual aggregation, the
     finalize-once guard, carryover roll-forward, and the custodial-credit
     state machine (no double pay, crash-safe failure path).
"""

import json
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from bot.utils.merkle import (
    build_distribution,
    leaf_hash,
    sorted_entries,
    usd_to_base_units,
    verify_proof,
)

ADDR_A = "0x000000000000000000000000000000000000dEaD"
ADDR_B = "0x1111111111111111111111111111111111111111"
ADDR_C = "0x2222222222222222222222222222222222222222"
ADDR_D = "0x3333333333333333333333333333333333333333"
ADDR_E = "0x4444444444444444444444444444444444444444"


# ---------------------------------------------------------------------------
# Merkle tree
# ---------------------------------------------------------------------------


class TestUsdToBaseUnits:
    def test_exact(self):
        assert usd_to_base_units(1.0) == 1_000_000
        assert usd_to_base_units(2.5) == 2_500_000

    def test_rounds_down_sub_unit_dust(self):
        assert usd_to_base_units(10.1234567) == 10_123_456

    def test_float_noise_does_not_undershoot(self):
        # 1.23 * 1e6 can float to 1229999.9999... — the round(…, 4) guard fixes it
        assert usd_to_base_units(1.23) == 1_230_000

    def test_negative_rejected(self):
        with pytest.raises(ValueError):
            usd_to_base_units(-0.01)


class TestMerkleDistribution:
    def test_single_leaf(self):
        dist = build_distribution([(ADDR_A, 100)])
        assert dist.root == leaf_hash(0, ADDR_A, 100)
        assert dist.proofs[0] == ()
        assert verify_proof(dist.root, 0, ADDR_A, 100, [])

    def test_all_proofs_verify(self):
        entries = [(ADDR_A, 100), (ADDR_B, 250), (ADDR_C, 999), (ADDR_D, 1), (ADDR_E, 7)]
        dist = build_distribution(entries)
        canonical = sorted_entries(entries)
        for index, (account, amount) in enumerate(canonical):
            assert verify_proof(dist.root, index, account, amount, dist.proofs[index])

    def test_deterministic_regardless_of_input_order(self):
        entries = [(ADDR_A, 100), (ADDR_B, 250), (ADDR_C, 999)]
        assert build_distribution(entries).root == build_distribution(list(reversed(entries))).root

    def test_tampered_amount_fails(self):
        dist = build_distribution([(ADDR_A, 100), (ADDR_B, 250)])
        canonical = sorted_entries([(ADDR_A, 100), (ADDR_B, 250)])
        account, _ = canonical[0]
        assert not verify_proof(dist.root, 0, account, 251, dist.proofs[0])

    def test_duplicate_address_rejected(self):
        with pytest.raises(ValueError):
            build_distribution([(ADDR_A, 100), (ADDR_A.lower(), 200)])

    def test_zero_amount_rejected(self):
        with pytest.raises(ValueError):
            build_distribution([(ADDR_A, 0)])

    def test_empty_rejected(self):
        with pytest.raises(ValueError):
            build_distribution([])


# ---------------------------------------------------------------------------
# Accrual service (DB-backed)
# ---------------------------------------------------------------------------

EPOCH = 10  # 2026-03-16 .. 2026-03-23


def _mk_user(session, telegram_id, evm_address=None):
    from bot.models.user import User, Wallet

    user = User(telegram_id=telegram_id, username=f"u{telegram_id}")
    session.add(user)
    session.flush()
    if evm_address:
        session.add(
            Wallet(
                user_id=user.id,
                address=evm_address,
                chain_type="evm",
                is_active=True,
                is_default=True,
            )
        )
    return user.id


def _mk_fee(session, user_id, usd, when):
    from bot.models.fees import FeeTransaction

    session.add(
        FeeTransaction(
            user_id=user_id,
            chain="base",
            token_symbol="USDC",
            swap_amount=usd * 100,
            fee_percentage=1.0,
            fee_amount=usd,
            fee_amount_usd=usd,
            created_at=when,
        )
    )


@pytest.fixture()
def rewards_db(tmp_db):
    """tmp_db plus two users with fees inside epoch 10."""
    from bot.services.onchain_rewards_service import epoch_window
    from database.db import get_session

    starts_at, _ = epoch_window(EPOCH)
    inside = starts_at + timedelta(days=1)
    with get_session() as session:
        whale_id = _mk_user(session, 1001, evm_address=ADDR_A)
        shrimp_id = _mk_user(session, 1002)  # no EVM wallet → custodial only
        _mk_fee(session, whale_id, 30.0, inside)  # → $3.00 cashback
        _mk_fee(session, whale_id, 20.0, inside)  # → +$2.00 (same epoch)
        _mk_fee(session, shrimp_id, 4.0, inside)  # → $0.40 → carryover (< $1)
    return SimpleNamespace(whale_id=whale_id, shrimp_id=shrimp_id)


def _finalize(index, days_after_end=1):
    from bot.services.onchain_rewards_service import epoch_window, onchain_rewards_service

    _, ends_at = epoch_window(index)
    return onchain_rewards_service.finalize_epoch(
        index, now=ends_at + timedelta(days=days_after_end)
    )


class TestFinalizeEpoch:
    def test_refuses_open_window(self, rewards_db):
        from bot.services.onchain_rewards_service import epoch_window, onchain_rewards_service

        starts_at, _ = epoch_window(EPOCH)
        ok, msg = onchain_rewards_service.finalize_epoch(EPOCH, now=starts_at + timedelta(days=3))
        assert not ok
        assert "still accruing" in msg

    def test_aggregates_and_builds_leaves(self, rewards_db):
        from bot.models.onchain_rewards import RewardEntry
        from database.db import get_session

        ok, msg = _finalize(EPOCH)
        assert ok, msg

        with get_session() as session:
            whale = (
                session.query(RewardEntry).filter(RewardEntry.user_id == rewards_db.whale_id).one()
            )
            shrimp = (
                session.query(RewardEntry).filter(RewardEntry.user_id == rewards_db.shrimp_id).one()
            )

        assert whale.status == "claimable"
        assert whale.amount_usd == pytest.approx(5.0)
        assert whale.fee_basis_usd == pytest.approx(50.0)
        # Has an EVM wallet → gets an on-chain leaf with a verifiable proof
        assert whale.leaf_index == 0
        assert whale.amount_base_units == str(usd_to_base_units(5.0))
        proof = [bytes.fromhex(h[2:]) for h in json.loads(whale.merkle_proof)]
        from bot.models.onchain_rewards import RewardEpoch
        from database.db import get_session as gs

        with gs() as session:
            epoch = session.query(RewardEpoch).filter_by(epoch_index=EPOCH).one()
        assert verify_proof(
            bytes.fromhex(epoch.merkle_root[2:]),
            whale.leaf_index,
            whale.claim_address,
            int(whale.amount_base_units),
            proof,
        )

        # Below $1 → carryover, no leaf
        assert shrimp.status == "carryover"
        assert shrimp.amount_usd == pytest.approx(0.4)
        assert shrimp.leaf_index is None

    def test_finalize_is_once_only(self, rewards_db):
        ok, _ = _finalize(EPOCH)
        assert ok
        ok, msg = _finalize(EPOCH)
        assert not ok
        assert "already" in msg

    def test_carryover_rolls_into_next_epoch(self, rewards_db):
        from bot.models.onchain_rewards import RewardEntry
        from bot.services.onchain_rewards_service import epoch_window
        from database.db import get_session

        ok, _ = _finalize(EPOCH)
        assert ok

        # Shrimp pays $8 fees in epoch 11 → $0.80 + $0.40 carryover = $1.20 payable
        starts_at, _ = epoch_window(EPOCH + 1)
        with get_session() as session:
            _mk_fee(session, rewards_db.shrimp_id, 8.0, starts_at + timedelta(days=1))
        ok, msg = _finalize(EPOCH + 1)
        assert ok, msg

        with get_session() as session:
            entries = (
                session.query(RewardEntry)
                .filter(RewardEntry.user_id == rewards_db.shrimp_id)
                .order_by(RewardEntry.id)
                .all()
            )
            statuses = [e.status for e in entries]
            new_entry = entries[-1]
            assert statuses[0] == "rolled"
            assert new_entry.status == "claimable"
            assert new_entry.cashback_usd == pytest.approx(0.8)
            assert new_entry.carryover_usd == pytest.approx(0.4)
            assert new_entry.amount_usd == pytest.approx(1.2)


class _StubHotWallet:
    """Injected as bot.services.hot_wallet so the crypto import chain never loads."""

    def __init__(self, fail=False):
        self.fail = fail
        self.credits = []

    def update_custodial_balance(self, **kwargs):
        if self.fail:
            raise RuntimeError("credit backend down")
        self.credits.append(kwargs)
        return kwargs["amount"]


@pytest.fixture()
def stub_hot_wallet(monkeypatch):
    stub = _StubHotWallet()
    module = SimpleNamespace(hot_wallet_service=stub)
    monkeypatch.setitem(sys.modules, "bot.services.hot_wallet", module)
    return stub


class TestCreditCustodial:
    def test_credits_claimable_entries(self, rewards_db, stub_hot_wallet):
        from bot.models.onchain_rewards import RewardEntry
        from bot.services.onchain_rewards_service import onchain_rewards_service
        from database.db import get_session

        _finalize(EPOCH)
        ok, msg, amount = onchain_rewards_service.credit_custodial(rewards_db.whale_id)
        assert ok, msg
        assert amount == pytest.approx(5.0)
        assert len(stub_hot_wallet.credits) == 1
        assert stub_hot_wallet.credits[0]["token_symbol"] == "USDC"

        with get_session() as session:
            entry = (
                session.query(RewardEntry).filter(RewardEntry.user_id == rewards_db.whale_id).one()
            )
            assert entry.status == "credited"

        # Second claim finds nothing — no double pay.
        ok, msg, amount = onchain_rewards_service.credit_custodial(rewards_db.whale_id)
        assert not ok
        assert amount == 0.0
        assert len(stub_hot_wallet.credits) == 1

    def test_failure_restores_status(self, rewards_db, monkeypatch):
        from bot.models.onchain_rewards import RewardEntry
        from bot.services.onchain_rewards_service import onchain_rewards_service
        from database.db import get_session

        stub = _StubHotWallet(fail=True)
        monkeypatch.setitem(
            sys.modules, "bot.services.hot_wallet", SimpleNamespace(hot_wallet_service=stub)
        )
        _finalize(EPOCH)
        ok, msg, amount = onchain_rewards_service.credit_custodial(rewards_db.whale_id)
        assert not ok
        assert amount == 0.0

        with get_session() as session:
            entry = (
                session.query(RewardEntry).filter(RewardEntry.user_id == rewards_db.whale_id).one()
            )
            assert entry.status == "claimable"
            assert entry.settled_at is None

    def test_published_epoch_blocks_custodial_until_deadline(self, rewards_db, stub_hot_wallet):
        from bot.models.onchain_rewards import RewardEpoch
        from bot.services.onchain_rewards_service import onchain_rewards_service
        from database.db import get_session

        _finalize(EPOCH)
        ok, msg = onchain_rewards_service.mark_published(
            EPOCH, "0xabc", datetime.utcnow() + timedelta(days=90)
        )
        assert ok, msg

        # Whale's entry is now on-chain-only → custodial claim must refuse it.
        ok, _, amount = onchain_rewards_service.credit_custodial(rewards_db.whale_id)
        assert not ok
        assert amount == 0.0
        assert stub_hot_wallet.credits == []

        # After the deadline passes, the contract refuses claims → custodial is safe.
        with get_session() as session:
            epoch = session.query(RewardEpoch).filter_by(epoch_index=EPOCH).one()
            epoch.claim_deadline = datetime.utcnow() - timedelta(days=1)
        ok, msg, amount = onchain_rewards_service.credit_custodial(rewards_db.whale_id)
        assert ok, msg
        assert amount == pytest.approx(5.0)


class TestUserSummary:
    def test_live_accrual_estimate(self, rewards_db):
        from bot.services.onchain_rewards_service import epoch_window, onchain_rewards_service

        starts_at, _ = epoch_window(EPOCH)
        summary = onchain_rewards_service.get_user_summary(
            rewards_db.whale_id, now=starts_at + timedelta(days=2)
        )
        assert summary.accruing_usd == pytest.approx(5.0)
        assert summary.accruing_epoch_index == EPOCH
        assert summary.claimable_usd == 0.0

    def test_post_finalize_buckets(self, rewards_db):
        from bot.services.onchain_rewards_service import epoch_window, onchain_rewards_service

        _finalize(EPOCH)
        _, ends_at = epoch_window(EPOCH)
        summary = onchain_rewards_service.get_user_summary(
            rewards_db.whale_id, now=ends_at + timedelta(days=1)
        )
        assert summary.claimable_usd == pytest.approx(5.0)
        assert summary.entries[0]["status"] == "claimable"


class TestReviewFindings:
    """Regression tests for the money-path review fixes."""

    def test_shared_claim_address_lowest_uid_gets_leaf(self, tmp_db):
        from bot.models.onchain_rewards import RewardEntry
        from bot.services.onchain_rewards_service import epoch_window
        from database.db import get_session

        starts_at, _ = epoch_window(EPOCH)
        inside = starts_at + timedelta(days=1)
        with get_session() as session:
            first_id = _mk_user(session, 2001, evm_address=ADDR_B)
            second_id = _mk_user(session, 2002, evm_address=ADDR_B)  # same address
            _mk_fee(session, first_id, 20.0, inside)
            _mk_fee(session, second_id, 30.0, inside)
        assert first_id < second_id

        ok, msg = _finalize(EPOCH)
        assert ok, msg

        with get_session() as session:
            first = session.query(RewardEntry).filter_by(user_id=first_id).one()
            second = session.query(RewardEntry).filter_by(user_id=second_id).one()

        # Deterministic: lowest uid holds the leaf; the other stays custodial-only
        assert first.leaf_index is not None
        assert second.leaf_index is None
        assert second.status == "claimable"

    def test_publish_payload_total_equals_sum_of_leaf_units(self, rewards_db, monkeypatch):
        from bot.models.onchain_rewards import RewardEntry
        from bot.services.onchain_rewards_service import onchain_rewards_service
        from database.db import get_session

        _finalize(EPOCH)
        payload = onchain_rewards_service.get_publish_payload(EPOCH)
        assert payload is not None

        with get_session() as session:
            units = [
                int(e.amount_base_units)
                for e in session.query(RewardEntry).filter(RewardEntry.leaf_index.isnot(None)).all()
            ]
        assert payload["totalAmountBaseUnits"] == sum(units)
        assert payload["merkleRoot"].startswith("0x")
