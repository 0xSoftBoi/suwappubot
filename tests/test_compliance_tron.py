"""Compliance screening must cover TRON, not just EVM.

`screen()` previously skipped every non-EVM address, so TRON recipients passed
through unscreened. That matters more than for most chains: USDT-TRC20 is a
primary sanctions-evasion rail, so OFAC SDN listings routinely name TRON
addresses, and Suwappu provisions a TRON wallet for every user at /start.

TRON addresses come in two equivalent forms: base58check (``T…``, 34 chars,
CASE-SENSITIVE) and raw hex (``41…``/``0x41…``, 21 bytes). Both are
canonicalized to the same lowercase 21-byte hex key (`ofac_list._tron_canonical`)
so a blocklist entry supplied in either form matches a recipient supplied in
either form. Canonicalization decodes base58check, which validates the
built-in checksum as a side effect — a malformed/garbled base58 string simply
fails to decode and is treated as not-a-TRON-address, not silently
mismatched. These tests pin that behaviour in both the service and the OFAC
loader.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

# NB: the package __init__ re-exports a singleton named `compliance_service`,
# which SHADOWS the submodule of the same name — so both
# `from bot.services.compliance import compliance_service` and
# `import bot.services.compliance.compliance_service as cs` hand back the
# INSTANCE. Go through importlib to get the actual module.
import importlib  # noqa: E402

import pytest  # noqa: E402

cs = importlib.import_module("bot.services.compliance.compliance_service")
from bot.services.compliance.ofac_list import (  # noqa: E402
    _normalize,
    _tron_canonical,
    load_ofac_addresses,
)  # noqa: E402
from bot.services.hot_wallet import (  # noqa: E402
    ComplianceBlockedError,
    _assert_recipient_compliant,
)  # noqa: E402

# Real-shaped TRON addresses (base58check, 34 chars, leading T). Used as test
# fixtures only — not known sanctioned addresses.
TRON_A = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  # USDT-TRC20 contract, well-known
TRON_B = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL"
TRON_A_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"  # canonical hex of TRON_A
EVM_A = "0x" + "ab" * 20
# Real 32-byte-decoding Solana address (Wrapped SOL mint) — now screenable.
SOLANA_A = "So11111111111111111111111111111111111111112"


class TestAddressRecognition:
    def test_recognizes_tron_base58(self):
        assert cs._is_tron_address(TRON_A)
        assert cs._is_tron_address(TRON_B)

    def test_recognizes_tron_hex_forms(self):
        assert cs._is_tron_address(TRON_A_HEX)
        assert cs._is_tron_address("0x" + TRON_A_HEX)
        assert cs._is_tron_address("0x" + TRON_A_HEX.upper())

    def test_rejects_non_tron_shapes(self):
        assert not cs._is_tron_address(EVM_A)
        assert not cs._is_tron_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6")  # 33 chars
        assert not cs._is_tron_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tt")  # 35 chars
        assert not cs._is_tron_address("XR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")  # no leading T
        assert not cs._is_tron_address("")
        assert not cs._is_tron_address(None)
        # A well-formed-looking 34-char base58 string starting with T but with
        # a garbage/invalid checksum is now REJECTED — base58check decode is
        # part of shape recognition, not just canonicalization.
        assert not cs._is_tron_address("T" + "x" * 33)

    def test_rejects_base58_excluded_characters(self):
        # base58 omits 0, O, I and l precisely to avoid visual confusion.
        for bad in ("0", "O", "I", "l"):
            addr = "T" + bad + "R7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6"
            assert len(addr) == 34
            assert not cs._is_tron_address(addr), f"{bad!r} is not in the base58 alphabet"

    def test_screenable_covers_all_three_families(self):
        assert cs._is_screenable_address(EVM_A)
        assert cs._is_screenable_address(TRON_A)
        assert cs._is_screenable_address(TRON_A_HEX)
        # Solana base58 (32-byte pubkey) is now screenable too.
        assert cs._is_screenable_address(SOLANA_A)


class TestNormalizationCanonicalizesTron:
    def test_evm_is_lowercased(self):
        assert cs._normalize_address("0x" + "AB" * 20) == "0x" + "ab" * 20

    def test_tron_base58_canonicalizes_to_hex21(self):
        """The old bug this guarded against was lowercasing base58 verbatim;
        the fix goes further and canonicalizes to the shared hex21 form so
        base58 and hex representations of the same address always match."""
        assert cs._normalize_address(TRON_A) == TRON_A_HEX
        assert cs._normalize_address(TRON_A) != TRON_A.lower()

    def test_tron_hex_forms_canonicalize_identically(self):
        assert cs._normalize_address(TRON_A_HEX) == TRON_A_HEX
        assert cs._normalize_address("0x" + TRON_A_HEX) == TRON_A_HEX
        assert cs._normalize_address("0x" + TRON_A_HEX.upper()) == TRON_A_HEX

    def test_base58_and_hex_forms_of_the_same_address_match(self):
        assert cs._normalize_address(TRON_A) == cs._normalize_address("0x" + TRON_A_HEX)

    def test_solana_is_kept_verbatim(self):
        assert cs._normalize_address(SOLANA_A) == SOLANA_A

    def test_ofac_loader_normalization_agrees(self):
        # ofac_list._normalize must stay in step with the service, or an address
        # added to the OFAC file would key differently than the one being screened.
        assert _normalize(TRON_A) == cs._normalize_address(TRON_A)
        assert _normalize("0x" + "AB" * 20) == cs._normalize_address("0x" + "AB" * 20)
        assert _tron_canonical(TRON_A) == TRON_A_HEX


class TestCsvParsing:
    def test_accepts_tron_and_evm_together(self):
        parsed = cs._parse_csv_addresses(f"{EVM_A}, {TRON_A} ,{TRON_B}")
        assert parsed == {
            EVM_A,
            cs._normalize_address(TRON_A),
            cs._normalize_address(TRON_B),
        }

    def test_tron_base58_and_hex_dedupe_to_one_entry(self):
        # Same address, two representations — must canonicalize to ONE key.
        parsed = cs._parse_csv_addresses(f"{TRON_A}, 0x{TRON_A_HEX}")
        assert parsed == {TRON_A_HEX}

    def test_drops_unparseable_entries(self):
        # Note: "0xdeadbeef"-style short hex strings are now a valid
        # Starknet address shape (finding 1: 0x + 1-64 hex, len != 42), so
        # this uses genuinely unrecognizable garbage instead.
        assert cs._parse_csv_addresses("not-an-address, , 0xZZZNOTHEX") == set()

    def test_starknet_shaped_entry_is_no_longer_dropped(self):
        """Finding 1: a short 0x-hex string is now a recognized (Starknet)
        family, so it's kept rather than silently dropped."""
        parsed = cs._parse_csv_addresses("0xdeadbeef")
        assert parsed == {"0xdeadbeef"}


class TestScreeningEnforcesTron:
    def _service(self, monkeypatch, blocklist):
        svc = cs.AddressComplianceService()
        canon = {cs._normalize_address(a) for a in blocklist}
        svc._blocklist = set(canon)
        svc._ofac = set(canon)
        monkeypatch.setattr(type(svc), "mode", property(lambda self: cs.ComplianceMode.ENFORCE))
        monkeypatch.setattr(
            type(svc), "policy", property(lambda self: cs.ScreeningPolicy.BLOCKLIST_ONLY)
        )
        return svc

    def test_blocks_a_sanctioned_tron_recipient(self, monkeypatch):
        svc = self._service(monkeypatch, {TRON_A})
        result = svc.screen(recipient=TRON_A, chain="tron")
        assert result.allowed is False
        assert result.blocked, "a sanctioned TRON recipient must be blocked"

    def test_blocks_the_hex_form_of_a_base58_listed_address(self, monkeypatch):
        """Same address, different representation on each side — must still match."""
        svc = self._service(monkeypatch, {TRON_A})  # blocklist has base58
        result = svc.screen(recipient="0x" + TRON_A_HEX, chain="tron")  # recipient is hex
        assert result.allowed is False

    def test_allows_an_unlisted_tron_recipient(self, monkeypatch):
        svc = self._service(monkeypatch, {TRON_A})
        assert svc.screen(recipient=TRON_B, chain="tron").allowed is True

    def test_is_sanctioned_covers_tron(self, monkeypatch):
        svc = self._service(monkeypatch, {TRON_A})
        assert svc.is_sanctioned(TRON_A) is True
        assert svc.is_sanctioned(TRON_B) is False

    def test_tron_screening_survives_the_lowercasing_regression(self, monkeypatch):
        """Guards a hypothetical regression where a raw (un-canonicalized,
        wrongly lowercased) base58 string ends up in the blocklist directly —
        e.g. a future refactor that bypasses ``_normalize_address``/
        ``_tron_canonical``. The real address must NOT match it."""
        svc = cs.AddressComplianceService()
        svc._blocklist = {TRON_A.lower()}  # bypasses normalization on purpose
        svc._ofac = {TRON_A.lower()}
        monkeypatch.setattr(type(svc), "mode", property(lambda self: cs.ComplianceMode.ENFORCE))
        monkeypatch.setattr(
            type(svc), "policy", property(lambda self: cs.ScreeningPolicy.BLOCKLIST_ONLY)
        )
        assert svc.screen(recipient=TRON_A, chain="tron").allowed is True


class TestOfacLoaderParsesTron:
    """Finding 1 (CRITICAL): the loader used to gate on
    ``startswith("0x") and len == 42``, silently discarding every TRON line
    in a COMPLIANCE_OFAC_LIST_PATH file. A file mixing TRON and EVM entries
    must yield BOTH in the parsed set."""

    def test_file_with_tron_and_evm_lines_yields_both(self, tmp_path):
        extra = tmp_path / "ofac.txt"
        extra.write_text("# sanctions\n" f"{TRON_A}\n" f"{EVM_A}\n" "\n")
        addrs = load_ofac_addresses(str(extra))
        assert TRON_A_HEX in addrs, "TRON line must survive the loader, canonicalized"
        assert EVM_A in addrs, "EVM line must still be present"

    def test_file_with_tron_hex_line_matches_base58_canonical_form(self, tmp_path):
        extra = tmp_path / "ofac.txt"
        extra.write_text(f"0x{TRON_A_HEX}\n")
        addrs = load_ofac_addresses(str(extra))
        assert TRON_A_HEX in addrs


class TestSolanaScreening:
    """Finding 2 (HIGH): Solana base58 recipients must be screenable
    (exact-match, no canonicalization), and in ENFORCE mode an unscreenable
    recipient family must be rejected (fail closed) rather than passed
    through."""

    def _enforce_svc(self, monkeypatch, blocklist=frozenset()):
        svc = cs.AddressComplianceService()
        svc._blocklist = set(blocklist)
        svc._ofac = set(blocklist)
        monkeypatch.setattr(type(svc), "mode", property(lambda self: cs.ComplianceMode.ENFORCE))
        monkeypatch.setattr(
            type(svc), "policy", property(lambda self: cs.ScreeningPolicy.BLOCKLIST_ONLY)
        )
        return svc

    def _monitor_svc(self, monkeypatch, blocklist=frozenset()):
        svc = cs.AddressComplianceService()
        svc._blocklist = set(blocklist)
        svc._ofac = set(blocklist)
        monkeypatch.setattr(type(svc), "mode", property(lambda self: cs.ComplianceMode.MONITOR))
        monkeypatch.setattr(
            type(svc), "policy", property(lambda self: cs.ScreeningPolicy.BLOCKLIST_ONLY)
        )
        return svc

    def test_solana_recognized_as_screenable(self):
        assert cs._is_screenable_address(SOLANA_A)

    def test_blocks_a_blocklisted_solana_recipient_in_enforce(self, monkeypatch):
        svc = self._enforce_svc(monkeypatch, {SOLANA_A})
        result = svc.screen(recipient=SOLANA_A, chain="solana")
        assert result.allowed is False
        assert result.blocked[0].source in ("ofac", "blocklist")

    def test_allows_a_clean_solana_recipient_in_enforce(self, monkeypatch):
        svc = self._enforce_svc(monkeypatch, {SOLANA_A})
        other_solana = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"  # arbitrary 32-byte pubkey
        assert cs._is_screenable_address(other_solana)
        result = svc.screen(recipient=other_solana, chain="solana")
        assert result.allowed is True

    def test_unscreenable_recipient_rejected_in_enforce(self, monkeypatch):
        """A recipient family the screener can't recognize at all (not
        EVM/TRON/Solana/Starknet/BTC-bech32) must fail CLOSED in ENFORCE
        mode."""
        svc = self._enforce_svc(monkeypatch)
        result = svc.screen(
            recipient="cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", chain="cosmos"
        )  # not EVM/TRON/Solana/Starknet/BTC shape
        assert result.allowed is False

    def test_unscreenable_recipient_allowed_in_monitor(self, monkeypatch):
        """Same unscreenable recipient in MONITOR mode: logged, not blocked."""
        svc = self._monitor_svc(monkeypatch)
        result = svc.screen(
            recipient="cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", chain="cosmos"
        )
        assert result.allowed is True
        assert result.blocked, "MONITOR should still record the would-block verdict"

    def test_starknet_recipient_now_recognized_in_enforce(self, monkeypatch):
        """Finding 1: Starknet (0x + non-EVM-length hex) is now a recognized,
        screenable family — a clean Starknet recipient is allowed rather
        than fail-closing."""
        svc = self._enforce_svc(monkeypatch)
        result = svc.screen(recipient="0x" + "1" * 63, chain="starknet")
        assert result.allowed is True

    def test_btc_bech32_recipient_now_recognized_in_enforce(self, monkeypatch):
        """Finding 1: BTC bech32 recipients are also recognized/screenable."""
        svc = self._enforce_svc(monkeypatch)
        result = svc.screen(recipient="bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", chain="bitcoin")
        assert result.allowed is True


class TestScreenerErrorFailsClosedInEnforce:
    """Finding 3 (HIGH): screener errors must fail OPEN in MONITOR/other
    modes (an outage must not become a withdrawal outage) but fail CLOSED in
    ENFORCE (we cannot prove the recipient is clean, so we must not let the
    withdrawal through)."""

    class _BoomEnforce:
        enabled = True
        mode = cs.ComplianceMode.ENFORCE

        def screen(self, **kwargs):
            raise RuntimeError("screener exploded")

    class _BoomMonitor:
        enabled = True
        mode = cs.ComplianceMode.MONITOR

        def screen(self, **kwargs):
            raise RuntimeError("screener exploded")

    def _install(self, monkeypatch, svc):
        import bot.services.compliance as pkg

        monkeypatch.setattr(pkg, "compliance_service", svc, raising=False)

    def test_enforce_mode_raises_on_screener_error(self, monkeypatch):
        self._install(monkeypatch, self._BoomEnforce())
        with pytest.raises(ComplianceBlockedError):
            _assert_recipient_compliant("0x" + "ab" * 20, "ethereum")

    def test_monitor_mode_does_not_raise_on_screener_error(self, monkeypatch):
        self._install(monkeypatch, self._BoomMonitor())
        _assert_recipient_compliant("0x" + "ab" * 20, "ethereum")  # must not raise
