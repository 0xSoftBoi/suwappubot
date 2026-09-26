"""Polymarket CLOB V2 order building + EIP-712 signing (Python side).

py-clob-client 0.34.6 (newest on PyPI, Feb 2026) signs against the exchange
Polymarket deprecated in the 2026-04-28 CLOB V2 migration, so bot order
placement is bound to a dead contract. bot/services/polymarket_v2_order.py
replaces the signing half.

The load-bearing assertion is that our type string hashes to the ORDER_TYPEHASH
constant published in Polymarket's own contract source — that proves the schema
offline, without needing an accepted order.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402
from eth_account import Account  # noqa: E402
from eth_account.messages import encode_typed_data  # noqa: E402
from web3 import Web3  # noqa: E402

from bot.services.polymarket_v2_order import (  # noqa: E402
    CTF_EXCHANGE,
    DEPRECATED_EXCHANGE,
    DEPRECATED_NEG_RISK_EXCHANGE,
    NEG_RISK_CTF_EXCHANGE,
    ORDER_TYPE,
    SIDE_BUY,
    SIDE_SELL,
    TICK_ROUNDING,
    build_hmac_signature,
    build_order,
    build_typed_data,
    compute_amounts,
    domain_for,
    round_price_to_tick,
    sign_order,
)

# Throwaway key — test vector only, never used anywhere real.
TEST_KEY = "0x" + "11" * 32
MAKER = Account.from_key(TEST_KEY).address


def _type_string() -> str:
    return "Order(" + ",".join(f"{f['type']} {f['name']}" for f in ORDER_TYPE) + ")"


class TestSchemaMatchesOnChain:
    def test_order_typehash_matches_contract_constant(self):
        """The whole schema is proven by this one hash.

        ORDER_TYPEHASH in Polymarket/ctf-exchange-v2
        src/exchange/libraries/Structs.sol. If a field is renamed, retyped or
        reordered, this hash changes and the exchange rejects our signatures.
        """
        got = Web3.keccak(text=_type_string()).hex()
        expected = "bb86318a2138f5fa8ae32fbe8e659f8fcf13cc6ae4014a707893055433818589"
        assert got.replace("0x", "") == expected

    def test_v1_fields_are_gone(self):
        names = {f["name"] for f in ORDER_TYPE}
        for dropped in ("taker", "expiration", "nonce", "feeRateBps"):
            assert dropped not in names
        for added in ("timestamp", "metadata", "builder"):
            assert added in names


class TestExchangeSelection:
    def test_addresses_match_polymarket_docs(self):
        assert CTF_EXCHANGE == "0xE111180000d2663C0091e4f400237545B87B996B"
        assert NEG_RISK_CTF_EXCHANGE == "0xe2222d279d744050d28e00520010520000310F59"

    def test_never_the_deprecated_usdce_era_contracts(self):
        """These are what py-clob-client still ships — the bug being fixed."""
        assert CTF_EXCHANGE != DEPRECATED_EXCHANGE
        assert NEG_RISK_CTF_EXCHANGE != DEPRECATED_NEG_RISK_EXCHANGE

    def test_neg_risk_selects_the_other_exchange(self):
        assert domain_for(False)["verifyingContract"] == CTF_EXCHANGE
        assert domain_for(True)["verifyingContract"] == NEG_RISK_CTF_EXCHANGE

    def test_only_verifying_contract_differs(self):
        a, b = domain_for(False), domain_for(True)
        assert a["name"] == b["name"] == "Polymarket CTF Exchange"
        assert a["version"] == b["version"] == "2"
        assert a["chainId"] == b["chainId"] == 137
        assert a["verifyingContract"] != b["verifyingContract"]


class TestAmountMath:
    def test_buy_gives_pusd_and_receives_shares(self):
        # 100 shares @ 0.42 -> pay 42 pUSD, receive 100 shares (both 6dp)
        maker, taker = compute_amounts("BUY", 100, 0.42)
        assert (maker, taker) == (42_000_000, 100_000_000)

    def test_sell_flips_the_legs(self):
        maker, taker = compute_amounts("SELL", 100, 0.42)
        assert (maker, taker) == (100_000_000, 42_000_000)

    def test_rounds_rather_than_truncates(self):
        # 0.1*3 float error must not drop a base unit.
        maker, _ = compute_amounts("BUY", 3, 0.1)
        assert maker == 300_000


class TestOrderValidation:
    def test_rejects_price_outside_probability_range(self):
        for bad in (0, 1, 1.5, -0.2):
            with pytest.raises(ValueError):
                build_order(token_id="1", side="BUY", size=1, price=bad, maker=MAKER)

    def test_rejects_bad_side_and_size(self):
        with pytest.raises(ValueError):
            build_order(token_id="1", side="HOLD", size=1, price=0.5, maker=MAKER)
        with pytest.raises(ValueError):
            build_order(token_id="1", side="BUY", size=0, price=0.5, maker=MAKER)

    def test_side_encoded_as_uint8(self):
        buy = build_order(token_id="1", side="BUY", size=1, price=0.5, maker=MAKER)
        sell = build_order(token_id="1", side="SELL", size=1, price=0.5, maker=MAKER)
        assert buy["side"] == SIDE_BUY == 0
        assert sell["side"] == SIDE_SELL == 1

    def test_rejects_price_that_rounds_to_a_zero_value_leg(self):
        """Review case: SELL 1000 @ 0.004 with tick 0.01 must RAISE, not silently
        produce takerAmount=0 (giving 1000 shares away for free).
        """
        with pytest.raises(ValueError):
            build_order(
                token_id="1", side="SELL", size=1000, price=0.004, maker=MAKER, tick_size="0.01"
            )

    def test_rejects_price_within_one_tick_of_one(self):
        """Review case: BUY @ 0.997 with tick 0.01 must RAISE — 0.997 is above
        the tradable upper bound (1 - tick = 0.99).
        """
        with pytest.raises(ValueError):
            build_order(
                token_id="1", side="BUY", size=1, price=0.997, maker=MAKER, tick_size="0.01"
            )

    def test_compute_amounts_rejects_a_price_that_rounds_to_zero_directly(self):
        """Same guard at the lower-level compute_amounts, for callers that
        bypass build_order's tick bounds check entirely.
        """
        with pytest.raises(ValueError):
            compute_amounts("SELL", 1000, 0.004, tick_size="0.01")


class TestSigning:
    def _order(self):
        return build_order(
            token_id="123",
            side="BUY",
            size=100,
            price=0.42,
            maker=MAKER,
            salt=1,
            timestamp_ms=1718000000000,
        )

    def test_signature_recovers_to_the_maker(self):
        order = self._order()
        signed = sign_order(order, TEST_KEY, neg_risk=False)
        typed = build_typed_data(order, neg_risk=False)
        recovered = Account.recover_message(
            encode_typed_data(full_message=typed), signature=signed.signature
        )
        assert recovered == MAKER

    def test_signature_is_0x_prefixed_65_byte_hex(self):
        """hexbytes>=1.0's bare .hex() drops the "0x" prefix it used to emit.

        The CLOB rejects (or worse, silently mis-parses) a signature string
        that isn't 0x-prefixed, so this is pinned explicitly rather than just
        checked implicitly via recovery.
        """
        order = self._order()
        signed = sign_order(order, TEST_KEY, neg_risk=False)
        assert signed.signature.startswith("0x")
        assert len(signed.signature) == 132  # "0x" + 130 hex chars (65 bytes)

    def test_neg_risk_signature_differs_for_an_identical_order(self):
        """Same bytes, different exchange binding — the core of the neg-risk bug."""
        order = self._order()
        assert (
            sign_order(order, TEST_KEY, neg_risk=False).signature
            != sign_order(order, TEST_KEY, neg_risk=True).signature
        )

    def test_neg_risk_signature_does_not_verify_under_the_other_domain(self):
        order = self._order()
        signed = sign_order(order, TEST_KEY, neg_risk=True)
        wrong_domain = build_typed_data(order, neg_risk=False)
        recovered = Account.recover_message(
            encode_typed_data(full_message=wrong_domain), signature=signed.signature
        )
        assert recovered != MAKER, "must not verify against the standard exchange"


class TestRequestBody:
    def test_body_serializes_exactly_the_signed_struct(self):
        order = build_order(
            token_id="123",
            side="BUY",
            size=100,
            price=0.42,
            maker=MAKER,
            salt=1,
            timestamp_ms=1718000000000,
        )
        signed = sign_order(order, TEST_KEY, neg_risk=False)
        body = signed.to_request_body(owner="api-key-abc")

        assert set(body["order"].keys()) == {
            "salt",
            "maker",
            "signer",
            "tokenId",
            "makerAmount",
            "takerAmount",
            "side",
            "signatureType",
            "timestamp",
            "metadata",
            "builder",
            "signature",
        }
        # v1 fields must never be sent — they are not in the digest.
        for dropped in ("taker", "expiration", "nonce", "feeRateBps"):
            assert dropped not in body["order"]

        assert body["order"]["side"] == "BUY"
        assert body["order"]["makerAmount"] == "42000000"
        assert body["order"]["takerAmount"] == "100000000"
        assert body["owner"] == "api-key-abc"
        assert body["orderType"] == "GTC"

    def test_numeric_fields_are_strings(self):
        order = build_order(token_id="123", side="SELL", size=5, price=0.5, maker=MAKER)
        body = sign_order(order, TEST_KEY, neg_risk=False).to_request_body(owner="o")
        for key in ("salt", "tokenId", "makerAmount", "takerAmount", "timestamp"):
            assert isinstance(body["order"][key], str), f"{key} must serialize as a string"


class TestTickSizeAmounts:
    """Cases flagged in review: without tick-size handling, a market with a
    coarser tick than the 0.01 default gets a price that isn't on-tick, which
    the exchange either rejects outright or (worse) silently accepts as a
    different implied price than what was quoted.
    """

    CASES = [(5, 0.37), (1, 0.43), (25, 0.61)]

    @pytest.mark.parametrize("size,price", CASES)
    @pytest.mark.parametrize("tick", sorted(TICK_ROUNDING))
    def test_implied_price_matches_the_quote_at_tick_precision(self, size, price, tick):
        """maker/taker ratio must reconstruct to exactly the tick-rounded price."""
        price_dp, _size_dp, _amount_dp = TICK_ROUNDING[tick]
        expected_price = round(price, price_dp)

        maker, taker = compute_amounts("BUY", size, price, tick_size=tick)
        implied_price = maker / taker
        assert implied_price == pytest.approx(expected_price, abs=10 ** (-price_dp) / 2)

    # Review cases: place_order used to derive `size = amount / raw_price`
    # (the UNROUNDED quote), then compute_amounts rounds the price to tick
    # internally when computing makerAmount. That mismatch between the price
    # used to SIZE the order and the price used to CHARGE for it let
    # floor(size) * rounded_price exceed the requested notional — the maker
    # paid more pUSD than they asked to spend.
    AMOUNT_CASES = [(10, 0.535, "0.01"), (10, 0.025, "0.01"), (10, 0.155, "0.1")]

    @pytest.mark.parametrize("amount,price,tick", AMOUNT_CASES)
    def test_buy_never_overcharges_the_maker(self, amount, price, tick):
        """The BUY maker leg (what the user pays) must never exceed the
        REQUESTED notional. This exercises the fixed flow (mirrors
        PolymarketClient.place_order): size is derived from the
        TICK-ROUNDED price via round_price_to_tick, not the raw quote.
        """
        rounded_price = round_price_to_tick(price, tick)
        assert rounded_price > 0
        size = float(amount) / float(rounded_price)

        maker, _taker = compute_amounts("BUY", size, price, tick_size=tick)

        requested_notional_base = amount * _SCALE_FOR_TEST
        assert maker <= requested_notional_base

    def test_default_tick_matches_the_untouched_legacy_math(self):
        """0.01 is the CLOB's default tick; behavior here must be unchanged from
        before tick-awareness was added.
        """
        maker, taker = compute_amounts("BUY", 100, 0.42, tick_size="0.01")
        assert (maker, taker) == (42_000_000, 100_000_000)

    def test_rejects_unknown_tick_size(self):
        with pytest.raises(ValueError):
            compute_amounts("BUY", 1, 0.5, tick_size="0.5")

    def test_sell_flips_legs_with_tick_awareness(self):
        maker, taker = compute_amounts("SELL", 25, 0.61, tick_size="0.001")
        assert maker == 25_000_000  # shares given
        assert taker == 15_250_000  # pUSD received: 25 * 0.61


_SCALE_FOR_TEST = 1_000_000


class TestHmacSignatureLocalBuild:
    """Fixture vectors generated by running Polymarket's OWN reference code
    (py_clob_client.signing.hmac.build_hmac_signature) — see
    api-ts/src/__tests__/polymarketClobAuth.test.ts for the matching TS-side
    vectors and provenance note. Both language implementations must byte-match
    these, independent of each other.
    """

    SECRET = "TXlTdXBlclNlY3JldEtleUZvclRlc3RpbmcxMjM0NTY3ODk="

    def test_post_with_body(self):
        sig = build_hmac_signature(self.SECRET, "1718000000", "POST", "/order", '{"a":1}')
        assert sig == "scRg4XkClA6l95Pd9hxFOpiDfhP4ce6_rUWQo0WRQL8="

    def test_get_with_no_body(self):
        sig = build_hmac_signature(self.SECRET, "1718000000", "GET", "/orders")
        assert sig == "pQJGuWoe_gXxbU66Jky5vUSHtI2l2BUOYi-QWbcEDDI="

    def test_output_is_base64url(self):
        sig = build_hmac_signature(self.SECRET, "1718000000", "GET", "/orders")
        assert "+" not in sig and "/" not in sig

    def test_quote_characters_in_body_are_not_rewritten(self):
        """The bug this guards: py-clob-client's helper does
        ``str(body).replace("'", '"')`` on the message, which would corrupt an
        already-correct JSON payload if any field value contained a literal
        apostrophe. Our local build must sign the literal string, unmodified.
        """
        body_with_quote = '{"question":"a\'b"}'
        signed = build_hmac_signature(self.SECRET, "1718000000", "POST", "/order", body_with_quote)

        import base64 as _b64
        import hashlib as _hashlib
        import hmac as _hmac

        expected_message = "1718000000" + "POST" + "/order" + body_with_quote
        mac = _hmac.new(
            _b64.urlsafe_b64decode(self.SECRET), expected_message.encode(), _hashlib.sha256
        )
        assert signed == _b64.urlsafe_b64encode(mac.digest()).decode()
