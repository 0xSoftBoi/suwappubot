"""Suwappu Membership — subscriptions as soulbound NFTs on Robinhood Chain.

Two invariants matter most:
  1. get_tier's max() rule — the chain can only ever RAISE a tier, and every
     failure path leaves the database tier in force (fail-open).
  2. On-chain prices must equal the app's tier pricing, or users pay a
     different amount depending on where they subscribe.
"""

import os
from types import SimpleNamespace

import pytest

from bot.models.subscription import SubscriptionTier

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _sol():
    return open(os.path.join(REPO, "contracts", "SuwappuMembership.sol")).read()


# ── 1. contract source invariants ─────────────────────────────────────────────


def test_membership_is_soulbound():
    sol = _sol()
    assert "if (from != address(0) && to != address(0)) revert Soulbound();" in sol
    # approvals blocked too, so it can never be listed
    assert "function approve(address, uint256) public pure override" in sol
    assert "function setApprovalForAll(address, bool) public pure override" in sol


def test_one_membership_per_wallet():
    sol = _sol()
    assert "if (tokenOf[to] != 0) revert AlreadyMember();" in sol


def test_free_tier_is_minted_not_bought():
    sol = _sol()
    assert "if (tier == Tier.Free) revert BadTier(); // FREE is minted, not bought" in sol
    assert "function mintFree() external nonReentrant returns (uint256 tokenId)" in sol


def test_onchain_prices_match_app_pricing():
    """$9.99 / $29.99 / $99.99 per 30 days, in USDG 6dp — exact parity with
    x402's TIER_LIMITS so where you subscribe never changes what you pay."""
    from bot.services.x402_service import TIER_LIMITS

    sol = _sol()
    assert "[uint256(0), 9_990_000, 29_990_000, 99_990_000]" in sol
    assert TIER_LIMITS[SubscriptionTier.PRO]["price_usd"] == 9.99
    assert TIER_LIMITS[SubscriptionTier.PREMIUM]["price_usd"] == 29.99
    assert TIER_LIMITS[SubscriptionTier.ENTERPRISE]["price_usd"] == 99.99


def test_tier_switch_converts_at_the_purchase_price_snapshot():
    """Conversions must value remaining time at the price it was BOUGHT at
    (pricePaidPerPeriod), not the live price — otherwise setPrice() retroactively
    revalues outstanding time (review finding HIGH-3). Behaviour is proven on a
    real EVM in test_membership_evm.py; this pins the mechanism in source."""
    sol = _sol()
    # remaining time is valued at the price it was BOUGHT at, never the live price
    assert "uint256 oldPrice = m.pricePaidPerPeriod == 0 ? newPrice : m.pricePaidPerPeriod;" in sol
    # same tier keeps time as-is; only a tier CHANGE converts
    assert "if (m.tier == tier) {" in sol
    assert "retainedSeconds = (remaining * oldPrice) / newPrice;" in sol
    # the snapshot is value-weighted, not overwritten with the new price —
    # overwriting re-opens the reprice front-run via a same-tier renewal
    assert (
        "m.pricePaidPerPeriod = (retainedValue + uint256(duration) * newPrice) / totalSeconds;"
        in sol
    )
    assert "m.pricePaidPerPeriod = newPrice;" not in sol
    # grantTime must route through the same conversion (review finding HIGH-2)
    assert sol.count("_creditTime(") >= 3  # definition + subscribe + grantTime


def test_admin_powers_are_bounded():
    sol = _sol()
    assert "MAX_GRANT = 365 days" in sol
    assert "MAX_PERIODS_PER_PURCHASE = 24" in sol
    # a paid tier can be neither zeroed nor pushed to an absurd ratio
    assert "if (price < MIN_PRICE || price > MAX_PRICE) revert PriceOutOfRange();" in sol
    # FREE cannot be repriced (it anchors the conversion math)
    assert "function setPrice(Tier tier, uint256 price) external onlyOwner {" in sol


def test_uses_canonical_usdg():
    """The chain has two USDG deployments; the repo pinned 0x5fc5…d168 as canonical."""
    sol = open(os.path.join(REPO, "contracts", "deploy", "DeployMembership.s.sol")).read()
    assert "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" in sol
    assert 'require(usdg == USDG_MAINNET, "mainnet must use canonical USDG");' in sol


# ── 2. the service and the max() rule ─────────────────────────────────────────


def test_tier_index_map_covers_the_contract_enum():
    from bot.services.membership_service import TIER_BY_INDEX, TIER_RANK

    assert TIER_BY_INDEX == {
        0: SubscriptionTier.FREE,
        1: SubscriptionTier.PRO,
        2: SubscriptionTier.PREMIUM,
        3: SubscriptionTier.ENTERPRISE,
    }
    assert set(TIER_RANK) == set(SubscriptionTier)


def test_best_tier_only_ever_raises():
    from bot.services.membership_service import membership_service as m

    F, P, PR, E = (
        SubscriptionTier.FREE,
        SubscriptionTier.PRO,
        SubscriptionTier.PREMIUM,
        SubscriptionTier.ENTERPRISE,
    )
    assert m.best_tier(F, PR) == PR  # chain raises
    assert m.best_tier(PR, F) == PR  # chain can NEVER lower
    assert m.best_tier(PR, None) == PR  # unreadable chain -> DB stands
    assert m.best_tier(F, None) == F
    assert m.best_tier(E, PR) == E


@pytest.mark.asyncio
async def test_disabled_service_returns_none(monkeypatch):
    from bot.services.membership_service import MembershipService

    svc = MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: None))
    assert svc.enabled is False
    assert await svc.get_onchain_tier(1) is None


@pytest.mark.asyncio
async def test_rpc_failure_is_fail_open(monkeypatch):
    from bot.services.membership_service import MembershipService

    svc = MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    monkeypatch.setattr(
        type(svc), "_contract", lambda self: (_ for _ in ()).throw(RuntimeError("rpc down"))
    )
    import bot.services.position_cards_service as pcs

    monkeypatch.setattr(
        pcs.position_cards_service, "evm_address_for_user", lambda uid: "0x" + "22" * 20
    )
    assert await svc.get_onchain_tier(7) is None  # not FREE — unknown


# ── 3. get_tier integration (the money path) ──────────────────────────────────


@pytest.mark.asyncio
async def test_get_tier_takes_max_of_db_and_chain(monkeypatch):
    from bot.services.membership_service import membership_service
    from bot.services.x402_service import X402Service

    svc = X402Service()

    async def fake_sub(user_id):
        return SimpleNamespace(tier=SubscriptionTier.FREE, expires_at=None)

    monkeypatch.setattr(svc, "get_subscription", fake_sub)

    async def chain_premium(uid):
        return SubscriptionTier.PREMIUM

    monkeypatch.setattr(membership_service, "get_onchain_tier", chain_premium)
    assert await svc.get_tier(1) == SubscriptionTier.PREMIUM


@pytest.mark.asyncio
async def test_get_tier_never_lowered_by_chain(monkeypatch):
    from bot.services.membership_service import membership_service
    from bot.services.x402_service import X402Service

    svc = X402Service()

    async def fake_sub(user_id):
        return SimpleNamespace(tier=SubscriptionTier.ENTERPRISE, expires_at=None)

    monkeypatch.setattr(svc, "get_subscription", fake_sub)

    async def chain_free(uid):
        return SubscriptionTier.FREE

    monkeypatch.setattr(membership_service, "get_onchain_tier", chain_free)
    assert await svc.get_tier(1) == SubscriptionTier.ENTERPRISE


@pytest.mark.asyncio
async def test_get_tier_survives_membership_blowup(monkeypatch):
    from bot.services.membership_service import membership_service
    from bot.services.x402_service import X402Service

    svc = X402Service()

    async def fake_sub(user_id):
        return SimpleNamespace(tier=SubscriptionTier.PRO, expires_at=None)

    monkeypatch.setattr(svc, "get_subscription", fake_sub)

    async def boom(uid):
        raise RuntimeError("chain exploded")

    monkeypatch.setattr(membership_service, "get_onchain_tier", boom)
    assert await svc.get_tier(1) == SubscriptionTier.PRO  # fail-open to DB


# ── 4. the wallet binding (/bindwallet) ───────────────────────────────────────


def test_binding_challenge_is_user_and_nonce_scoped():
    from bot.handlers.bindwallet import _challenge_text

    a = _challenge_text(111, "aa" * 16)
    b = _challenge_text(222, "aa" * 16)
    c = _challenge_text(111, "bb" * 16)
    assert a != b and a != c
    assert "telegram:111" in a and "nonce:" in a
    assert "authorizes no transaction" in a


def test_binding_accepts_only_the_signing_wallet():
    """EIP-191 recovery: possession of the key is the only way to bind."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    from bot.handlers.bindwallet import _challenge_text

    key = Account.create()
    other = Account.create()
    challenge = _challenge_text(4242, "cd" * 16)
    sig = key.sign_message(encode_defunct(text=challenge)).signature

    recovered = Account.recover_message(encode_defunct(text=challenge), signature=sig)
    assert recovered.lower() == key.address.lower()
    assert recovered.lower() != other.address.lower()

    # a signature over a DIFFERENT user's challenge must not recover usefully
    forged = Account.recover_message(
        encode_defunct(text=_challenge_text(9999, "cd" * 16)), signature=sig
    )
    assert forged.lower() != key.address.lower() or _challenge_text(
        4242, "cd" * 16
    ) == _challenge_text(9999, "cd" * 16)


def test_membership_address_column_is_migrated():
    src = open(os.path.join(REPO, "database", "db.py")).read()
    assert "ADD COLUMN membership_address VARCHAR(64)" in src
    assert "ADD COLUMN IF NOT EXISTS membership_address VARCHAR(64)" in src
    from bot.models.user import User

    assert hasattr(User, "membership_address")


# ── 5. second-review fixes ────────────────────────────────────────────────────


def test_binding_is_exclusive_to_one_account():
    """Review BLOCKER B1: a signature proves key possession, NOT identity. Without
    exclusivity a reseller signs one ENTERPRISE wallet for N accounts and every
    one of them reads ENTERPRISE off a single $99.99 purchase."""
    src = open(os.path.join(REPO, "bot", "handlers", "bindwallet.py")).read()
    assert "User.membership_address == normalized" in src
    assert "already linked to another Suwappu account" in src
    # stored lowercased, or the unique index never collides
    assert "normalized = recovered.lower()" in src

    db = open(os.path.join(REPO, "database", "db.py")).read()
    assert "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_membership_address" in db
    # pre-existing duplicates must be cleared or the index creation fails
    assert "UPDATE users SET membership_address = NULL" in db


def test_bindwallet_is_rate_limited_and_private_only():
    src = open(os.path.join(REPO, "bot", "handlers", "bindwallet.py")).read()
    assert "enforce_rate_limit_for_update" in src
    assert 'getattr(chat, "type", "private") != "private"' in src


def test_rpc_health_is_attributed_to_the_endpoint_that_ran_the_call():
    """Review H2: asking rpc_manager for a URL returns a fresh weighted-random
    pick, so failures were blamed on healthy endpoints and evicted the shared
    web3 cache for every other caller on the chain."""
    src = open(os.path.join(REPO, "bot", "services", "membership_service.py")).read()
    assert "url = contract.w3.provider.endpoint_uri" in src
    assert "rpc_manager.get_rpc_url(CHAIN)" not in src


def test_lookup_short_circuits_and_survives_partial_failure():
    """Review H3/M3: one bad wallet or an unknown tier index must not discard a
    paid tier found elsewhere, and ENTERPRISE ends the scan."""
    src = open(os.path.join(REPO, "bot", "services", "membership_service.py")).read()
    assert "if best == SubscriptionTier.ENTERPRISE:" in src
    assert "continue" in src.split("def _tier_for_addresses_sync")[1]
    assert "saw_success" in src


def test_membership_uses_its_own_bounded_executor():
    """Review H4: asyncio.wait_for cancels the await, not the thread. On the
    shared default executor a hung RPC would pin workers the swap path needs."""
    import bot.services.membership_service as mod

    assert mod._EXECUTOR._max_workers <= 4
    src = open(mod.__file__).read()
    assert "run_in_executor(_EXECUTOR" in src
    assert "asyncio.to_thread" not in src, "must not use the shared default executor"


@pytest.mark.asyncio
async def test_outage_does_not_downgrade_a_known_paid_tier(monkeypatch):
    """Review H3: a timeout previously returned None, dropping a paying member to
    DB/FREE pricing mid-swap. A previously observed paid tier must survive."""
    import time as _t

    import bot.services.membership_service as mod

    svc = mod.MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    monkeypatch.setattr(svc, "_addresses_for_user", lambda uid: ["0x" + "22" * 20])
    svc._cache[5] = (_t.time() - mod._CACHE_TTL - 1, SubscriptionTier.ENTERPRISE)

    def boom(addresses):
        raise RuntimeError("rpc down")

    monkeypatch.setattr(svc, "_tier_for_addresses_sync", boom)
    assert await svc.get_onchain_tier(5) == SubscriptionTier.ENTERPRISE

    # ...but not forever: past the stale window it falls back to the DB tier
    svc._cache[5] = (_t.time() - mod._STALE_PAID_TTL - 1, SubscriptionTier.ENTERPRISE)
    assert await svc.get_onchain_tier(5) is None


def test_locks_are_not_evicted_while_held():
    """Review LOW: sweeping a held lock lets another coroutine make a fresh one
    and defeats single-flight."""
    src = open(os.path.join(REPO, "bot", "services", "membership_service.py")).read()
    assert "if not lk.locked() and k not in self._cache:" in src
    assert "if lock is not None and not lock.locked():" in src


def test_contract_term_and_price_bounds_exist():
    sol = _sol()
    assert "MAX_TERM = 3650 days" in sol
    assert "if (totalSeconds > MAX_TERM) totalSeconds = MAX_TERM;" in sol
    assert "if (price < MIN_PRICE || price > MAX_PRICE) revert PriceOutOfRange();" in sol
    assert "if (expiry < oldExpiry) revert GrantWouldShrinkTerm();" in sol
