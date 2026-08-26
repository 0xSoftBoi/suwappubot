"""SuwappuPositions — Founders' Gold, on a real EVM.

Money-path HIGH from the Founders' Gold review: parse/boot/CI prove the code
loads, not that Gold behaves correctly on-chain. These tests exercise the real
mint -> transfer -> discountFor chain and the royalty-follows-treasury fix,
the same way tests/test_positions_pricing_evm.py exercises the payment
lifecycle.

Same rig as the rest of the EVM suite: `pytest.importorskip` means these
SKIP wherever `web3` / `eth_tester` are not installed (this sandbox included)
and only actually run where the extras are present — CI. See
tests/positions_helpers.py for the shared mint rig this file reuses.
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
GOLD = 4
CENTS = 2000  # $20.00 a card, PUBLIC
GOLD_CENTS = 11900  # $119.00 a card, GOLD
ETH_USD = 2000_00000000  # $2,000, 8dp
NO_PROOF: list = []
ZERO_ROOT = b"\x00" * 32


@pytest.fixture()
def env():
    from web3 import EthereumTesterProvider, Web3

    w3 = Web3(EthereumTesterProvider())
    art = json.load(open(ARTIFACTS))["artifacts"]
    owner, alice, treasury = w3.eth.accounts[0], w3.eth.accounts[1], w3.eth.accounts[2]

    def deploy(name, *a):
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        r = w3.eth.wait_for_transaction_receipt(c.constructor(*a).transact({"from": owner}))
        return w3.eth.contract(address=r.contractAddress, abi=art[name]["abi"])

    args = json.load(open(os.path.join(REPO, "nft", "position-cards", "deploy_args.json")))
    pos = deploy("SuwappuPositions", args["caps"], args["tokens"], "https://x/", owner)
    feed = deploy("MockEthUsdFeed", ETH_USD)
    pos.functions.sealRegistry().transact({"from": owner})
    usdg = wire_payments(w3, art, pos, owner, treasury, alice, deploy)
    now = w3.eth.get_block("latest").timestamp
    # PUBLIC: bounded, open (no allowlist). allocation must be nonzero — see
    # OpenPhaseUnbounded in configurePhase.
    pos.functions.configurePhase(PUBLIC, ZERO_ROOT, CENTS, 50, 4_444, now - 1, 0).transact(
        {"from": owner}
    )
    # GOLD: same shape, priced at the premium tier.
    pos.functions.configurePhase(GOLD, ZERO_ROOT, GOLD_CENTS, 50, 4_444, now - 1, 0).transact(
        {"from": owner}
    )
    return w3, pos, feed, owner, alice, treasury, usdg


def test_gold_mint_stamps_isgold_and_the_premium_discount(env):
    """(a) A mint through Phase.Gold must read isGold true, goldBalance 1, and
    discountFor the Gold rate — not the base rate."""
    w3, pos, feed, owner, alice, treasury, usdg = env
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), GOLD, 0, 1, submitter=owner)

    token_id = 1
    assert pos.functions.isGold(token_id).call() is True
    assert pos.functions.goldBalance(alice).call() == 1
    assert pos.functions.discountFor(alice).call() == pos.functions.goldDiscountFractionBps().call()
    assert pos.functions.discountFor(alice).call() == 5500


def test_gold_transfer_moves_the_perk_with_the_card(env):
    """(b) Transferring the Gold card away must drop the sender to the base
    rate (if they still hold a standard card) and hand the Gold rate to the
    receiver — the perk follows the token, not the original minter."""
    w3, pos, feed, owner, alice, treasury, usdg = env
    bob = w3.eth.accounts[3]

    # alice holds one standard card AND one Gold card
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, 1, submitter=owner)
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), GOLD, 0, 1, submitter=owner)
    gold_token_id = 2  # minted second
    assert pos.functions.isGold(gold_token_id).call() is True
    assert pos.functions.discountFor(alice).call() == 5500

    pos.functions.transferFrom(alice, bob, gold_token_id).transact({"from": alice})

    # alice still holds the standard card -> falls to base rate, not zero
    assert pos.functions.goldBalance(alice).call() == 0
    assert pos.functions.balanceOf(alice).call() == 1
    assert pos.functions.discountFor(alice).call() == pos.functions.holdDiscountFractionBps().call()
    assert pos.functions.discountFor(alice).call() == 4000

    # bob now holds the Gold card and reads the Gold rate
    assert pos.functions.goldBalance(bob).call() == 1
    assert pos.functions.discountFor(bob).call() == 5500
    assert pos.functions.isGold(gold_token_id).call() is True, "isGold is per-token, immutable"


def test_owner_mint_never_stamps_gold(env):
    """(c) The team reserve is never Gold — Gold is earned only by paying into
    Phase.Gold, never handed out from `ownerMint`."""
    w3, pos, feed, owner, alice, treasury, usdg = env
    pos.functions.ownerMint(alice, 0, 1).transact({"from": owner})
    assert pos.functions.isGold(1).call() is False
    assert pos.functions.goldBalance(alice).call() == 0


def test_public_phase_mint_reads_the_base_discount(env):
    """(d) A mint through Phase.Public (non-Gold) must read discountFor ==
    4000 (the base rate), never the Gold rate."""
    w3, pos, feed, owner, alice, treasury, usdg = env
    authorized_mint(w3, pos, usdg, signer_for(w3, alice), PUBLIC, 0, 1, submitter=owner)
    assert pos.functions.isGold(1).call() is False
    assert pos.functions.discountFor(alice).call() == 4000


def test_royalty_receiver_follows_treasury(env):
    """(e) Behavioural pin for the money-path HIGH: after `setTreasury(t)`,
    `royaltyInfo` must report `t` as the receiver — Ownable2Step's ownership
    transfer alone does NOT move the ERC-2981 receiver, and before this fix
    every secondary sale kept paying the deploy key regardless of where
    treasury moved. See the source-text pin in
    tests/test_position_cards.py::test_royalty_receiver_follows_treasury."""
    w3, pos, feed, owner, alice, treasury, usdg = env
    # constructor default: initialOwner (the deploy key), NOT treasury
    receiver, _amount = pos.functions.royaltyInfo(1, 10**18).call()
    assert receiver == owner

    new_treasury = w3.eth.accounts[4]
    pos.functions.setTreasury(new_treasury).transact({"from": owner})
    receiver2, amount2 = pos.functions.royaltyInfo(1, 10**18).call()
    assert receiver2 == new_treasury, "royalty receiver did not follow treasury"
    assert amount2 == 2 * 10**16  # unchanged 200 bps (2%) rate

    # a later setDefaultRoyalty retune must survive the NEXT setTreasury call
    pos.functions.setDefaultRoyalty(owner, 500).transact({"from": owner})  # 5%
    pos.functions.setTreasury(alice).transact({"from": owner})
    receiver3, amount3 = pos.functions.royaltyInfo(1, 10**18).call()
    assert receiver3 == alice
    assert amount3 == 5 * 10**16, "setTreasury reverted the retuned rate back to 200 bps"
