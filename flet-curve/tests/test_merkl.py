"""Merkl: two campaigns per pool, and one of them Curve does not report."""

from __future__ import annotations

from curve.merkl import (
    MERKL_APP,
    MerklRewards,
    MerklToken,
    by_identifier,
    parse_opportunities,
    parse_tokens,
    split,
    underlying_ids,
    with_underlying,
)

POOL = "0xd50492DE3541d75E61eDC34D1Aa79C7dC2d20da9"
GAUGE = "0xF7F4b8bFb6dE08435adc37eaAd626a22ED730A92"
POINTS_POOL = "0xF4d0CF32908b2C7f1021339c43Df0F77f06896d7"
PIKU = "0x2E4039E8E31475d65DC00293C366FDBfBBC02DC3"
ORBITAL = "0x10710501778b7FAf9e478f36FaE0B286C028eDE8"


#: The wrapper case, from the pyUSD/crvUSD pool.
YBW_ID = "16745282869799121720"
CRVUSD_ID = "18369832616504291492"
CRVUSD = "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E"
YBWCRVUSD = "0x5D29949F8e64fA2f9cB2B1Fa190244b9413bc3Ea"


def opportunity(
    identifier: str,
    name: str,
    apr: float,
    token: dict,
    *,
    status: str = "LIVE",
    ident: str = "1",
) -> dict:
    """One entry, with the fields this app reads and the ones it must not."""
    return {
        "chainId": 1,
        "type": "ERC20LOGPROCESSOR",
        "identifier": identifier,
        "name": name,
        "status": status,
        "action": "POOL",
        "apr": apr,
        "id": ident,
        "tokens": [
            {"symbol": "USDC", "address": "0xA0b8", "type": "TOKEN", "price": 1.0}
        ],
        "rewardsRecord": {"breakdowns": [{"token": token, "amount": "1"}]},
    }


PIKU_TOKEN = {
    "name": "Piku",
    "symbol": "PIKU",
    "address": PIKU,
    "decimals": 18,
    "type": "PRETGE",
    "price": 0.16,
}
ORBITAL_TOKEN = {
    "name": "Orbital Points",
    "symbol": "Orbital Points",
    "address": ORBITAL,
    "decimals": 18,
    "type": "POINT",
}

PAYLOAD = [
    opportunity(POOL, "Provide liquidity to Curve frxUSD-USP", 325.1121, PIKU_TOKEN, ident="a"),
    opportunity(GAUGE, "Stake into the Curve frxUSP gauge", 325.0632, PIKU_TOKEN, ident="b"),
    opportunity(POINTS_POOL, "Provide liquidity to Curve USDC-USDat", 0.0, ORBITAL_TOKEN, ident="c"),
    opportunity("0xdead", "Ended last month", 900.0, PIKU_TOKEN, status="PAST", ident="d"),
]


def rewards_for(pool: str = "", lp_token: str = "", gauge: str = "") -> MerklRewards:
    return split(
        by_identifier(parse_opportunities(PAYLOAD)),
        pool=pool,
        lp_token=lp_token,
        gauge=gauge,
    )


def test_past_campaigns_are_not_live() -> None:
    assert [c.name for c in parse_opportunities(PAYLOAD)] == [
        "Provide liquidity to Curve frxUSD-USP",
        "Stake into the Curve frxUSP gauge",
        "Provide liquidity to Curve USDC-USDat",
    ]


def test_rewards_come_from_the_breakdowns_not_the_token_list() -> None:
    campaign = parse_opportunities(PAYLOAD)[0]
    assert campaign.tokens == (MerklToken("PIKU", PIKU, points=False),)


def test_a_pre_tge_token_is_a_token() -> None:
    assert not parse_opportunities(PAYLOAD)[0].tokens[0].points


def test_points_are_not_a_rate() -> None:
    rewards = rewards_for(pool=POINTS_POOL)
    assert rewards.points == (MerklToken("Orbital Points", ORBITAL, points=True),)
    assert rewards.apr == 0.0
    assert rewards.all[0].points_only


def test_both_sides_of_a_campaign_are_found_and_kept_apart() -> None:
    rewards = rewards_for(pool=POOL, gauge=GAUGE)
    assert [c.identifier for c in rewards.unstaked] == [POOL]
    assert [c.identifier for c in rewards.staked] == [GAUGE]


def test_the_apr_is_the_better_side_not_the_sum() -> None:
    assert rewards_for(pool=POOL, gauge=GAUGE).apr == 325.1121


def test_a_campaign_watching_the_lp_token_is_found() -> None:
    rewards = rewards_for(pool="0xnothing", lp_token=POOL)
    assert [c.identifier for c in rewards.unstaked] == [POOL]


def test_a_pool_that_is_its_own_lp_token_is_counted_once() -> None:
    rewards = rewards_for(pool=POOL, lp_token=POOL, gauge=GAUGE)
    assert len(rewards.unstaked) == 1
    assert rewards.apr == 325.1121


def test_addresses_match_whatever_their_case() -> None:
    rewards = rewards_for(pool=POOL.lower(), gauge=GAUGE.upper())
    assert len(rewards.all) == 2


def test_nothing_found_is_falsy_and_costs_nothing() -> None:
    rewards = rewards_for(pool="0xsomewhere-else")
    assert not rewards
    assert rewards.apr == 0.0
    assert rewards.tokens == ()


def test_near_identical_rates_are_one_row() -> None:
    rewards = rewards_for(pool=POOL, gauge=GAUGE)
    token = rewards.tokens[0]
    assert rewards.sides_for(token) == (("", 325.1121),)


def test_rates_that_really_differ_get_a_row_each() -> None:
    payload = [
        opportunity(POOL, "LP", 40.0, PIKU_TOKEN, ident="a"),
        opportunity(GAUGE, "Gauge", 12.0, PIKU_TOKEN, ident="b"),
    ]
    rewards = split(
        by_identifier(parse_opportunities(payload)), pool=POOL, gauge=GAUGE
    )
    assert rewards.sides_for(rewards.tokens[0]) == (
        ("unstaked LP", 40.0),
        ("staked", 12.0),
    )


def test_one_sided_campaigns_say_which_side() -> None:
    rewards = rewards_for(pool=POOL)
    assert rewards.sides_for(rewards.tokens[0]) == (("unstaked LP only", 325.1121),)

    staked = rewards_for(gauge=GAUGE)
    assert staked.sides_for(staked.tokens[0]) == (("staked only", 325.0632),)


def test_the_link_is_to_the_opportunity_id() -> None:
    campaign = rewards_for(pool=POOL).all[0]
    assert campaign.url == f"{MERKL_APP}/opportunities/a"


def test_a_campaign_with_no_id_still_links_somewhere() -> None:
    payload = [dict(opportunity(POOL, "Nameless", 1.0, PIKU_TOKEN), id=None)]
    campaign = parse_opportunities(payload)[0]
    assert campaign.url == f"{MERKL_APP}/protocols/curve"


def test_a_broken_payload_is_no_campaigns_rather_than_a_crash() -> None:
    assert parse_opportunities({"detail": "nope"}) == []
    assert parse_opportunities(None) == []
    assert parse_opportunities([{"status": "LIVE"}]) == []  # no identifier


# -- wrappers ---------------------------------------------------------------
# A Merkl wrapper is an ERC-20 with an `onClaim` hook: the campaign is
# denominated in the wrapper and the claimer receives the underlying.

YBW_TOKEN = {
    "id": YBW_ID,
    "name": "Yield Basis crvUSD (Merkl wrapper)",
    "symbol": "ybwcrvUSD",
    "address": YBWCRVUSD,
    "decimals": 18,
    "type": "TOKEN",
    "price": 0.999,
    "underlyingTokenId": CRVUSD_ID,
}
CRVUSD_TOKEN = {
    "id": CRVUSD_ID,
    "name": "Curve.Fi USD Stablecoin",
    "symbol": "crvUSD",
    "address": CRVUSD,
    "decimals": 18,
    "type": "TOKEN",
    "price": 0.999,
}


def wrapped_campaigns() -> list:
    return parse_opportunities(
        [opportunity(POOL, "Provide liquidity to Curve PYUSD-crvUSD", 0.2, YBW_TOKEN)]
    )


def test_a_wrapper_is_noticed_before_anything_is_fetched() -> None:
    token = wrapped_campaigns()[0].tokens[0]
    assert token.underlying_id == CRVUSD_ID
    assert not token.wrapped
    assert token.paid_symbol == "ybwcrvUSD"
    assert token.paid_address == YBWCRVUSD


def test_resolving_a_wrapper_names_what_actually_arrives() -> None:
    campaigns = wrapped_campaigns()
    assert underlying_ids(campaigns) == {CRVUSD_ID}

    resolved = with_underlying(campaigns, parse_tokens([CRVUSD_TOKEN]))
    token = resolved[0].tokens[0]
    assert token.wrapped
    assert token.paid_symbol == "crvUSD"
    assert token.paid_address == CRVUSD
    assert token.symbol == "ybwcrvUSD"


def test_a_token_pointing_at_itself_is_not_a_wrapper() -> None:
    itself = {**YBW_TOKEN, "id": YBW_ID, "underlyingTokenId": YBW_ID}
    token = parse_opportunities([opportunity(POOL, "x", 1.0, itself)])[0].tokens[0]
    assert token.underlying_id == ""
    assert underlying_ids([parse_opportunities([opportunity(POOL, "x", 1.0, itself)])[0]]) == set()


def test_an_unresolved_wrapper_is_left_as_it_was() -> None:
    resolved = with_underlying(wrapped_campaigns(), {})
    assert resolved[0].tokens[0].paid_symbol == "ybwcrvUSD"


def test_a_wrapped_reward_still_carries_its_rate() -> None:
    index = by_identifier(with_underlying(wrapped_campaigns(), parse_tokens([CRVUSD_TOKEN])))
    rewards = split(index, pool=POOL)
    assert rewards.apr == 0.2
    assert rewards.sides_for(rewards.tokens[0]) == (("unstaked LP only", 0.2),)


def test_a_reward_type_nobody_has_seen_is_treated_as_points() -> None:
    exotic = {"symbol": "???", "address": "0x1", "type": "SOMETHING_NEW"}
    campaign = parse_opportunities([opportunity(POOL, "New", 5.0, exotic)])[0]
    assert campaign.tokens[0].points
    assert campaign.points_only
