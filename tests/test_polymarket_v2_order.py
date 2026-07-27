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

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from bot.services.polymarket_v2_order import (
    CTF_EXCHANGE,
    DEPRECATED_EXCHANGE,
    DEPRECATED_NEG_RISK_EXCHANGE,
    NEG_RISK_CTF_EXCHANGE,
    ORDER_TYPE,
    SIDE_BUY,
    SIDE_SELL,
    build_order,
    build_typed_data,
    compute_amounts,
    domain_for,
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
