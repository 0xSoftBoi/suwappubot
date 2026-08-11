"""Suwappu Membership — subscriptions as soulbound NFTs on Robinhood Chain.

Two invariants matter most:
  1. get_tier's max() rule — the chain can only ever RAISE a tier, and every
     failure path leaves the database tier in force (fail-open).
  2. On-chain prices must equal the app's tier pricing, or users pay a
     different amount depending on where they subscribe.
"""

import asyncio
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
    assert "uint256 totalValue = retainedValue + uint256(duration) * newPrice;" in sol
    assert "m.pricePaidPerPeriod = totalValue / totalSeconds;" in sol
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
    assert "if (totalSeconds > MAX_TERM) {" in sol
    assert "if (!allowClamp) revert TermCapReached();" in sol
    assert "totalValue = (totalValue * MAX_TERM) / totalSeconds;" in sol
    assert "if (price < MIN_PRICE || price > MAX_PRICE) revert PriceOutOfRange();" in sol
    assert "if (expiry < oldExpiry) revert GrantWouldShrinkTerm();" in sol


# ── 6. dev-server integration findings ────────────────────────────────────────


def test_robinhood_is_registered_with_rpc_manager():
    """Found by running against the dev environment: `robinhood` was in neither
    CHAINLIST_IDS nor the extras list, so rpc_manager raised "No RPC endpoints
    for robinhood" on first use. Every Robinhood Chain read — position cards and
    the membership tier that sets a user's swap fee — fails open, so the whole
    feature set would have been silently, permanently dead in production."""
    src = open(os.path.join(REPO, "bot", "services", "rpc_manager.py")).read()
    assert '"tempo", "solana", "tron", "plasma", "robinhood"' in src

    from bot.config.chains import CHAINS

    assert "robinhood" in CHAINS


def test_contract_errors_do_not_count_against_rpc_health():
    """Also found live: pointing the service at an address with no code
    circuit-opened rpc.mainnet.chain.robinhood.com within six calls, which would
    have taken position cards and every other read on that chain down with it.
    A missing contract says nothing about endpoint health."""
    import bot.services.membership_service as mod
    from web3.exceptions import BadFunctionCallOutput, ContractLogicError

    assert mod._is_transport_error(BadFunctionCallOutput("no code")) is False
    assert mod._is_transport_error(ContractLogicError("reverted")) is False
    assert mod._is_transport_error(ConnectionError("refused")) is True
    assert mod._is_transport_error(TimeoutError()) is True

    src = open(mod.__file__).read()
    assert "if _is_transport_error(e):" in src


def test_all_contract_errors_cache_as_no_membership_not_as_an_outage():
    """A misconfigured contract address must resolve to "no membership" (cached)
    rather than raising, or stale-while-revalidate would keep serving a tier the
    chain no longer backs."""
    src = open(os.path.join(REPO, "bot", "services", "membership_service.py")).read()
    assert "if contract_errors == len(addresses):" in src
    assert 'raise RuntimeError("all tierOf calls failed on transport errors")' in src


@pytest.mark.asyncio
async def test_bad_node_returning_empty_state_cannot_demote_a_paid_member(monkeypatch):
    """A node serving empty state answers eth_call with 0x, which web3 decodes as
    a CONTRACT error, not a transport error — so it takes the "all contract
    errors -> no membership" path rather than raising. Without stale protection
    on that path a paying ENTERPRISE holder would be cached as FREE and billed
    1% instead of 0.1% for the next five minutes."""
    import time as _t

    import bot.services.membership_service as mod

    svc = mod.MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    monkeypatch.setattr(svc, "_addresses_for_user", lambda uid: ["0x" + "22" * 20])
    svc._cache[42] = (_t.time() - 1, SubscriptionTier.ENTERPRISE)

    # all addresses hit contract errors -> the sync helper returns None (no raise)
    monkeypatch.setattr(svc, "_tier_for_addresses_sync", lambda addrs: None)
    assert await svc.get_onchain_tier(42) == SubscriptionTier.ENTERPRISE

    # a genuinely un-held tier (never seen paid) still resolves to None
    assert await svc.get_onchain_tier(43) is None

    # and stale protection expires
    svc._cache[42] = (_t.time() - mod._STALE_PAID_TTL - 1, SubscriptionTier.ENTERPRISE)
    assert await svc.get_onchain_tier(42) is None


def test_bindwallet_does_not_hold_a_db_session_across_an_await():
    """Awaiting Telegram inside `with get_session()` pins a pooled connection for
    a full network round-trip. The DB work runs in one short transaction off the
    await path instead."""
    src = open(os.path.join(REPO, "bot", "handlers", "bindwallet.py")).read()
    bind_block = src[src.index("def _bind()") : src.index("outcome = await run_in_db")]
    assert "await " not in bind_block, "the bind transaction must not await"
    assert "run_in_db(_bind)" in src
    # no `with get_session()` may contain an await anywhere in this handler
    for chunk in src.split("with get_session() as session:")[1:]:
        body = chunk.split("\n\n")[0]
        assert "await " not in body, "a DB session is held across an await"


@pytest.mark.asyncio
async def test_invalidate_is_not_undone_by_an_in_flight_lookup(monkeypatch):
    """/bindwallet invalidates so a freshly bound wallet shows up immediately.
    A lookup that started before the invalidation must not write its stale
    result afterwards, or the new binding stays hidden for a full TTL."""
    import bot.services.membership_service as mod

    svc = mod.MembershipService()
    # monkeypatch (not a raw assignment + del) — deleting the class property in a
    # finally block removed it for every later test in the module.
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    if True:
        svc._addresses_for_user = lambda uid: ["0x" + "22" * 20]

        started = asyncio.Event()
        release = asyncio.Event()

        def slow(addrs):
            import asyncio as _a

            _a.run_coroutine_threadsafe(_signal(), loop).result(timeout=5)
            return SubscriptionTier.PRO

        async def _signal():
            started.set()
            await release.wait()

        loop = asyncio.get_running_loop()
        task = asyncio.create_task(svc.get_onchain_tier(77))
        svc._tier_for_addresses_sync = slow
        await asyncio.wait_for(started.wait(), timeout=5)
        svc.invalidate(77)  # binding changed mid-flight
        release.set()
        result = await asyncio.wait_for(task, timeout=5)

        assert result == SubscriptionTier.PRO  # caller still gets an answer
        assert 77 not in svc._cache, "stale in-flight result was cached over an invalidate"


def test_registering_robinhood_does_not_disturb_other_chains():
    """_load_configured_endpoints is chain-wide. Adding an entry to its extras
    list must be strictly additive — verified by building the endpoint table with
    and without `robinhood` and diffing every chain."""
    import re

    import bot.services.rpc_manager as rm
    from bot.services.rpc_manager import RPCManager

    with_rh = RPCManager()
    with_rh._load_configured_endpoints()
    counts_with = {c: len(v) for c, v in with_rh._endpoints.items()}

    code = (
        open(rm.__file__)
        .read()
        .replace(
            '"tempo", "solana", "tron", "plasma", "robinhood"',
            '"tempo", "solana", "tron", "plasma"',
        )
    )
    ns: dict = {}
    exec(compile(code, rm.__file__, "exec"), ns)
    without = ns["RPCManager"]()
    without._load_configured_endpoints()
    counts_without = {c: len(v) for c, v in without._endpoints.items()}

    assert set(counts_with) - set(counts_without) == {"robinhood"}
    assert not set(counts_without) - set(counts_with), "a chain was dropped"
    for chain in set(counts_with) & set(counts_without):
        assert counts_with[chain] == counts_without[chain], f"{chain} endpoint count changed"
    assert counts_with["robinhood"] >= 1


# ── 7. third-review fixes ─────────────────────────────────────────────────────


def test_watch_only_wallets_are_never_treated_as_ownership():
    """Review BLOCKER: /import creates wallet_provider='watch' rows from pasted
    text with no signature and no key. Including them let any fresh account
    paste a known ENTERPRISE holder's public address and inherit 0.1% fees —
    $900 saved per $100k swap, unlimited accounts, $0 cost. It also defeated the
    whole point of the unique index and the EIP-191 proof."""
    import bot.services.membership_service as mod

    assert "watch" not in mod.KEY_CONTROLLED_PROVIDERS
    assert set(mod.KEY_CONTROLLED_PROVIDERS) == {"local", "turnkey"}
    src = open(mod.__file__).read()
    assert "Wallet.wallet_provider.in_(KEY_CONTROLLED_PROVIDERS)" in src
    assert "Wallet.is_active.is_(True)" in src

    # and /import really does create watch rows, so the filter is load-bearing
    imp = open(os.path.join(REPO, "bot", "handlers", "import_handler.py")).read()
    assert 'wallet_provider="watch"' in imp


@pytest.mark.asyncio
async def test_transport_outage_raises_so_a_paid_tier_survives(monkeypatch):
    """Review BLOCKER 2: contract_errors incremented on EVERY exception, so
    `contract_errors == len(addresses)` was always true when nothing succeeded
    and the outage branch was unreachable. An RPC outage therefore returned None
    and demoted an on-chain-only ENTERPRISE member to FREE — $500 charged vs $50
    owed on a $50k swap, repeating every 15s for the whole outage."""
    import time as _t

    import bot.services.membership_service as mod

    svc = mod.MembershipService()
    monkeypatch.setattr(type(svc), "contract_address", property(lambda self: "0x" + "11" * 20))
    monkeypatch.setattr(svc, "_addresses_for_user", lambda uid: ["0x" + "22" * 20])
    svc._cache[9] = (_t.time() - 1, SubscriptionTier.ENTERPRISE)

    class _Contract:
        class functions:
            @staticmethod
            def tierOf(addr):
                raise ConnectionError("rpc down")

    # a transport failure must NOT be swallowed as "no membership"
    monkeypatch.setattr(svc, "_contract", lambda: (_ for _ in ()).throw(ConnectionError("down")))
    assert await svc.get_onchain_tier(9) == SubscriptionTier.ENTERPRISE

    src = open(mod.__file__).read()
    body = src.split("def _tier_for_addresses_sync")[1]
    assert "if _is_transport_error(e):" in body
    assert "else:\n                    contract_errors += 1" in body


def test_binding_challenge_names_the_claimed_address():
    """Review MED: without the address in the text, an attacker could phish a
    victim into signing the attacker's challenge and bind the victim's wallet —
    permanently, since exclusivity then locks the real owner out."""
    from bot.handlers.bindwallet import _challenge_text

    text = _challenge_text(111, "aa" * 16, "0x" + "AB" * 20)
    assert "address:0x" + "ab" * 20 in text
    assert _challenge_text(111, "aa" * 16, "0x" + "ab" * 20) != _challenge_text(
        111, "aa" * 16, "0x" + "cd" * 20
    )


def test_unbind_exists_so_a_binding_is_not_permanent():
    from bot.handlers.bindwallet import unbindwallet_handler

    assert unbindwallet_handler.commands == frozenset({"unbindwallet"})
    main = open(os.path.join(REPO, "bot", "main.py")).read()
    assert "application.add_handler(unbindwallet_handler)" in main


def test_executor_submissions_are_admission_controlled():
    """Review MED: wait_for cancels the await, not the thread, and the executor
    queue is unbounded — during an RPC hang every timed-out lookup still ran,
    minutes late, growing without bound."""
    import bot.services.membership_service as mod

    assert mod._INFLIGHT._initial_value <= 16
    src = open(mod.__file__).read()
    assert "_INFLIGHT.acquire(blocking=False)" in src
    assert "_INFLIGHT.release()" in src
