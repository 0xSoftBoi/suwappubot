"""The log-reading half of the fork fixture's account finder."""

from __future__ import annotations

from tools.find_claimants import TRANSFER_TOPIC, addresses_in, describe

ALICE = "0x1111111111111111111111111111111111111111"
BOB = "0x2222222222222222222222222222222222222222"
ZERO = "0x" + "0" * 40


def topic(address: str) -> str:
    return "0x" + address[2:].rjust(64, "0")


def transfer(sender: str, recipient: str) -> dict:
    return {"topics": [TRANSFER_TOPIC, topic(sender), topic(recipient)]}


def test_the_topic_is_the_erc20_transfer_signature() -> None:
    assert TRANSFER_TOPIC == (
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    )


def test_both_sides_of_a_transfer_are_counterparties() -> None:
    assert addresses_in([transfer(ALICE, BOB)]) == [ALICE, BOB]


def test_the_zero_address_is_not_a_counterparty() -> None:
    assert addresses_in([transfer(ZERO, ALICE)]) == [ALICE]
    assert addresses_in([transfer(ALICE, ZERO)]) == [ALICE]


def test_each_address_appears_once_in_first_seen_order() -> None:
    logs = [transfer(ZERO, BOB), transfer(BOB, ALICE), transfer(ALICE, BOB)]
    assert addresses_in(logs) == [BOB, ALICE]


def test_a_log_without_topics_is_skipped_rather_than_fatal() -> None:
    assert addresses_in([{"topics": []}, {}, transfer(ZERO, ALICE)]) == [ALICE]


def test_a_reward_is_shown_in_its_own_units() -> None:
    hit = {
        "staked": 42 * 10**18,
        "crv": 3 * 10**18,
        "extras": [("USDC", 2_500_000, 6)],
    }
    line = describe(hit)
    assert "2.5 USDC" in line
    assert "3 CRV" in line
    assert "staked 42 LP" in line


def test_no_crv_owed_is_left_out_rather_than_shown_as_zero() -> None:
    hit = {"staked": 10**18, "crv": 0, "extras": [("ARB", 5 * 10**18, 18)]}
    line = describe(hit)
    assert "CRV" not in line
    assert "5 ARB" in line
