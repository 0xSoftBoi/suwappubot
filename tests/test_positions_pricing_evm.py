"""SuwappuPositions — USDG pricing and mint lifecycle, on a real EVM.

Payment is EIP-3009: the buyer signs a USDG authorization and a relayer submits
it, so minting costs the buyer no ETH. Eight tests that guarded the previous
ETH-conversion subsystem (feed bands, stale/last-good pricing, decimals reverts,
overpayment refunds, underpayment) were DELETED rather than ported — they
guarded code that no longer exists.

Original header follows.

SuwappuPositions — USD pricing, refunds and mint lifecycle, on a real EVM.

Modelled on what a collection that actually minted out gets right: the mint is
quoted in dollars and converted at purchase time, overpayment is refunded rather
than reverted, the feed is sanity-banded with a bounded fallback, and the end of
the mint is a promise the contract keeps.
"""

import json
import os

import pytest

from positions_helpers import authorized_mint, signer_for, wire_payments

web3 = pytest.importorskip("web3")
pytest.importorskip("eth_tester")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(REPO, "contracts", "test", "artifacts.json")

PUBLIC = 3
CENTS = 2000  # $20.00 a card
ETH_USD = 2000_00000000  # $2,000, 8dp
NO_PROOF: list = []
ZERO_ROOT = b"\x00" * 32


@pytest.fixture()
def env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = json.load(open(ARTIFACTS))["artifacts"]
    owner, alice = w3.eth.accounts[0], w3.eth.accounts[1]

    def deploy(name, *a):
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        r = w3.eth.wait_for_transaction_receipt(c.constructor(*a).transact({"from": owner}))
        return w3.eth.contract(address=r.contractAddress, abi=art[name]["abi"])

    args = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))
    pos = deploy("SuwappuPositions", args["caps"], args["tokens"], "https://x/", owner)
    feed = deploy("MockEthUsdFeed", ETH_USD)
    pos.functions.sealRegistry().transact({"from": owner})
    usdg = wire_payments(w3, art, pos, owner, owner, alice, deploy)
    now = w3.eth.get_block("latest").timestamp
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 50, 0, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, feed, owner, alice, usdg


def test_mint_end_is_a_promise_the_contract_keeps(env):
    w3, pos, feed, owner, alice, usdg = env
    now = w3.eth.get_block("latest").timestamp
    pos.functions.announceEnd(now + 100).transact({"from": owner})
    with pytest.raises(Exception):  # cannot be extended
        pos.functions.announceEnd(now + 100000).transact({"from": owner})
    w3.provider.ethereum_tester.time_travel(now + 200)
    w3.provider.ethereum_tester.mine_block()
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": 10**17}
        )


def test_close_forever_stops_the_owner_too(env):
    """'4,444 max' is a claim; a one-way close is proof."""
    w3, pos, feed, owner, alice, usdg = env
    pos.functions.closeMintingForever().transact({"from": owner})
    assert pos.functions.mintingClosedForever().call() is True
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, NO_PROOF, True).transact(
            {"from": alice, "value": 10**17}
        )
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})


def test_pause_and_royalties(env):
    w3, pos, feed, owner, alice, usdg = env
    pos.functions.setPaused(True).transact({"from": owner})
    assert (
        authorized_mint(w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, 1, submitter=owner).status
        == 0
    ), "a paused collection still minted"
    pos.functions.setPaused(False).transact({"from": owner})
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, 1, submitter=owner)

    pos.functions.setDefaultRoyalty(owner, 500).transact({"from": owner})  # 5%
    receiver, amount = pos.functions.royaltyInfo(1, 10**18).call()
    assert receiver == owner and amount == 5 * 10**16
    assert pos.functions.supportsInterface(bytes.fromhex("2a55205a")).call() is True  # ERC2981


def test_ownership_transfer_is_two_step(env):
    """A typo'd single-step transferOwnership bricks the contract permanently."""
    w3, pos, feed, owner, alice, usdg = env
    pos.functions.transferOwnership(alice).transact({"from": owner})
    assert pos.functions.owner().call() == owner  # not yet
    assert pos.functions.pendingOwner().call() == alice
    pos.functions.acceptOwnership().transact({"from": alice})
    assert pos.functions.owner().call() == alice


def test_mint_state_is_one_call(env):
    """Parity item: their eligibilityOf returns 13 values in a single call, so
    the whole mint page loads in one round-trip. Ours previously needed six or
    seven reads."""
    w3, pos, feed, owner, alice, usdg = env
    st = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    (
        live,
        requires_proof,
        price_cents,
        price_usdg,
        starts_at,
        ends_at,
        wallet_cap,
        allocation,
        phase_minted,
        wallet_minted,
        wallet_remaining,
        ticker_remaining,
        minted,
        supply_remaining,
        is_paused,
        ended,
        closed,
    ) = st

    assert live is True and requires_proof is False
    assert price_cents == CENTS
    assert price_usdg == pos.functions.quote(PUBLIC, 1).call()
    assert wallet_cap == 50 and wallet_minted == 0 and wallet_remaining == 50
    assert ticker_remaining > 0 and minted == 0 and supply_remaining == 4_444
    assert (is_paused, ended, closed) == (False, False, False)

    # it tracks reality after a mint
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, 2, submitter=owner)
    st2 = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    # Indices shifted down by one when `pricedByFeed` left the struct with the
    # ETH feed it described.
    assert st2[9] == 2 and st2[10] == 48  # walletMinted / walletRemaining
    assert st2[12] == 2 and st2[13] == 4_442  # minted / supplyRemaining
    assert st2[11] == ticker_remaining - 2

    # and reflects lifecycle without extra calls
    pos.functions.setPaused(True).transact({"from": owner})
    st3 = pos.functions.mintState(alice, PUBLIC, 0, 0).call()
    assert st3[14] is True and st3[0] is False  # isPaused, live


def test_a_phase_cannot_be_configured_free_by_omission(env):
    """M3: price is the 3rd of 7 positional args. At 0 the phase minted its whole
    allocation for nothing, with no burn, no claw-back, and mintState.priceUsdg
    reading 0 so the UI showed nothing wrong."""
    w3, pos, feed, owner, alice, usdg = env
    now = w3.eth.get_block("latest").timestamp
    with pytest.raises(Exception):
        pos.functions.configurePhase(PUBLIC, ZERO_ROOT, 0, 50, 0, now - 1, 0).transact(
            {"from": owner}
        )


def test_ownership_cannot_be_renounced(env):
    """M4: Ownable.renounceOwnership is one unguarded call. This contract holds
    every wei of mint revenue (withdraw is onlyOwner) and owns the only levers
    that pause the mint or repoint a broken feed."""
    w3, pos, feed, owner, alice, usdg = env
    with pytest.raises(Exception):
        pos.functions.renounceOwnership().transact({"from": owner})
    assert pos.functions.owner().call() == owner


def test_owner_mint_honours_the_announced_end_and_the_pause(env):
    """M5: ownerMint checked only mintingClosedForever, so after the announced
    end the owner could still airdrop 200 reserve cards — which is not what
    "minting ends on X" means."""
    w3, pos, feed, owner, alice, usdg = env

    pos.functions.setPaused(True).transact({"from": owner})
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})
    pos.functions.setPaused(False).transact({"from": owner})
    pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})  # sanity

    end = w3.eth.get_block("latest").timestamp + 60
    pos.functions.announceEnd(end).transact({"from": owner})
    w3.provider.ethereum_tester.time_travel(end + 60)
    with pytest.raises(Exception):
        pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})


def test_max_per_wallet_is_actually_enforced(env):
    """It was declared as a public constant and never read by mint(), so the
    contract documented a limit it did not have — and walletCap == 0 means "no
    cap", so a misconfigured phase was unbounded per wallet."""
    w3, pos, feed, owner, alice, usdg = env
    now = w3.eth.get_block("latest").timestamp
    # a phase with NO wallet cap and no allowlist: previously unbounded
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 0, 0, now - 1, 0).transact(
        {"from": owner}
    )
    cap = pos.functions.MAX_PER_WALLET().call()

    def mint(qty):
        try:
            return authorized_mint(
                w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, qty, submitter=owner
            ).status
        except Exception:
            return 0

    assert mint(cap) == 1, "the cap itself must be reachable"
    assert mint(1) == 0, f"minted past MAX_PER_WALLET ({cap})"


def test_a_free_phase_needs_the_door_marked_free(env):
    """The Founder phase is free by design, but price == 0 must stay impossible
    to reach by ACCIDENT — price is the 3rd of 7 positional args. configurePhase
    refuses a 0; configureFreePhase makes the giveaway explicit in the call the
    owner signs."""
    w3, pos, feed, owner, alice, usdg = env
    now = w3.eth.get_block("latest").timestamp

    with pytest.raises(Exception):  # a dropped argument stays loud
        pos.functions.configurePhase(1, ZERO_ROOT, 0, 3, 1500, now - 1, 0).transact({"from": owner})

    # an unbounded free phase is an open faucet for the whole allocation
    with pytest.raises(Exception):
        pos.functions.configureFreePhase(1, ZERO_ROOT, 0, 1500, now - 1, 0).transact(
            {"from": owner}
        )

    # bounded by a wallet cap: allowed, and it really does mint for nothing
    pos.functions.configureFreePhase(1, ZERO_ROOT, 3, 1500, now - 1, 0).transact({"from": owner})
    assert pos.functions.quote(1, 1).call() == 0
    rcpt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction(
            {
                "from": alice,
                "to": pos.address,
                "value": 0,
                "gas": 900_000,
                "data": pos.encode_abi("mint", args=[1, 0, 3, 0, [], True]),
            }
        )
    )
    assert rcpt.status == 1
    assert pos.functions.minted(alice).call() == 3


def test_config_prices_are_in_the_unit_the_contract_charges(env):
    """config.json said price_eth 0.004/0.008. The contract prices in USD CENTS
    and converts to wei at mint through the ETH/USD feed — fed to
    configurePhase() those values truncate to 0 cents, which now reverts."""
    cfg = json.load(open(os.path.join(REPO, "nft", "position-cards", "config.json")))
    for name, phase in cfg["mint"]["phases"].items():
        assert "price_eth" not in phase, f"{name} still priced in the wrong unit"
        cents = phase["price_usd_cents"]
        assert isinstance(cents, int), f"{name} price must be whole cents"
        assert phase["free"] == (cents == 0)


def test_price_is_exact_in_usdg_with_no_conversion(env):
    """The reason to charge in a dollar stablecoin: $20 is 20_000000 USDG, full
    stop. No feed, no staleness, no band, no refund — the whole ETH conversion
    subsystem the deleted tests guarded is gone."""
    w3, pos, feed, owner, alice, usdg = env
    assert pos.functions.quote(PUBLIC, 1).call() == CENTS * 10**4
    assert pos.functions.quote(PUBLIC, 3).call() == 3 * CENTS * 10**4
    assert pos.functions.usdgCost(2000, 1).call() == 20 * 10**6  # $20.00


def test_the_payer_needs_no_eth_and_the_relayer_gets_no_card(env):
    """The point of the port. A payer with ZERO ETH mints, and the card lands on
    the signer — never on the relayer who paid the gas."""
    from eth_account import Account

    w3, pos, feed, owner, alice, usdg = env
    payer = Account.create()
    assert w3.eth.get_balance(payer.address) == 0
    usdg.functions.mint(payer.address, 100 * 10**6).transact({"from": owner})

    authorized_mint(w3, pos, usdg, payer, PUBLIC, 0, 1, submitter=owner)

    assert w3.eth.get_balance(payer.address) == 0, "payer spent ETH"
    assert pos.functions.balanceOf(payer.address).call() == 1
    assert pos.functions.balanceOf(owner).call() == 0, "relayer received the card"


def test_an_authorization_cannot_be_repurposed(env):
    """The nonce binds phase, ticker, quantity and a per-payer sequence, so a
    signature for one order cannot be settled as a different one, or twice."""
    from eth_account import Account

    w3, pos, feed, owner, alice, usdg = env
    payer = Account.create()
    usdg.functions.mint(payer.address, 1000 * 10**6).transact({"from": owner})

    seq = pos.functions.mintSeq(payer.address).call()
    n1 = pos.functions.mintNonce(payer.address, PUBLIC, 0, 1, seq).call()
    assert pos.functions.mintNonce(payer.address, PUBLIC, 0, 5, seq).call() != n1
    assert pos.functions.mintNonce(payer.address, PUBLIC, 1, 1, seq).call() != n1

    authorized_mint(w3, pos, usdg, payer, PUBLIC, 0, 1, submitter=owner)
    assert pos.functions.mintSeq(payer.address).call() == seq + 1
    assert pos.functions.mintNonce(payer.address, PUBLIC, 0, 1, seq + 1).call() != n1


def test_a_priced_phase_cannot_be_minted_through_the_free_door(env):
    """mint() is free-phases-only. If it took a priced phase, payment would be
    optional."""
    w3, pos, feed, owner, alice, usdg = env
    with pytest.raises(Exception):
        pos.functions.mint(PUBLIC, 0, 1, 0, [], True).transact({"from": alice})
