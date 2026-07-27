"""Compliance screening must cover TRON, not just EVM.

`screen()` previously skipped every non-EVM address, so TRON recipients passed
through unscreened. That matters more than for most chains: USDT-TRC20 is a
primary sanctions-evasion rail, so OFAC SDN listings routinely name TRON
addresses, and Suwappu provisions a TRON wallet for every user at /start.

The subtle part is normalization. EVM hex is case-insensitive and is lowercased;
TRON base58check is CASE-SENSITIVE, so lowercasing one yields a key that can
never match a real address — silently disabling the screen while looking wired
up. These tests pin that distinction in both the service and the OFAC loader.
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
import importlib

cs = importlib.import_module("bot.services.compliance.compliance_service")
from bot.services.compliance.ofac_list import _normalize

# Real-shaped TRON addresses (base58check, 34 chars, leading T). Used as test
# fixtures only — not known sanctioned addresses.
TRON_A = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  # USDT-TRC20 contract, well-known
TRON_B = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL"
EVM_A = "0x" + "ab" * 20


class TestAddressRecognition:
    def test_recognizes_tron(self):
        assert cs._is_tron_address(TRON_A)
        assert cs._is_tron_address(TRON_B)

    def test_rejects_non_tron_shapes(self):
        assert not cs._is_tron_address(EVM_A)
        assert not cs._is_tron_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6")  # 33 chars
        assert not cs._is_tron_address("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tt")  # 35 chars
        assert not cs._is_tron_address("XR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")  # no leading T
        assert not cs._is_tron_address("")
        assert not cs._is_tron_address(None)
        # A well-formed 34-char base58 string starting with T IS accepted — this
        # is a shape check, not a checksum verification.
        assert cs._is_tron_address("T" + "x" * 33)

    def test_rejects_base58_excluded_characters(self):
        # base58 omits 0, O, I and l precisely to avoid visual confusion.
        for bad in ("0", "O", "I", "l"):
            addr = "T" + bad + "R7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6"
            assert len(addr) == 34
            assert not cs._is_tron_address(addr), f"{bad!r} is not in the base58 alphabet"

    def test_screenable_covers_both_families(self):
        assert cs._is_screenable_address(EVM_A)
        assert cs._is_screenable_address(TRON_A)
        # Solana base58 is 32-44 chars and has no 'T' prefix rule — still unsupported.
        assert not cs._is_screenable_address("So11111111111111111111111111111111111111112")


class TestNormalizationIsCaseAware:
    def test_evm_is_lowercased(self):
        assert cs._normalize_address("0x" + "AB" * 20) == "0x" + "ab" * 20

    def test_tron_case_is_preserved(self):
        """The bug this guards: lowercasing a TRON address breaks all matching."""
        assert cs._normalize_address(TRON_A) == TRON_A
        assert cs._normalize_address(TRON_A) != TRON_A.lower()

    def test_ofac_loader_normalization_agrees(self):
        # ofac_list._normalize must stay in step with the service, or an address
        # added to the OFAC file would key differently than the one being screened.
        assert _normalize(TRON_A) == cs._normalize_address(TRON_A)
        assert _normalize("0x" + "AB" * 20) == cs._normalize_address("0x" + "AB" * 20)


class TestCsvParsing:
    def test_accepts_tron_and_evm_together(self):
        parsed = cs._parse_csv_addresses(f"{EVM_A}, {TRON_A} ,{TRON_B}")
        assert parsed == {EVM_A, TRON_A, TRON_B}

    def test_drops_unparseable_entries(self):
        assert cs._parse_csv_addresses("not-an-address, , 0xdeadbeef") == set()


class TestScreeningEnforcesTron:
    def _service(self, monkeypatch, blocklist):
        svc = cs.AddressComplianceService()
        svc._blocklist = set(blocklist)
        svc._ofac = set(blocklist)
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

    def test_allows_an_unlisted_tron_recipient(self, monkeypatch):
        svc = self._service(monkeypatch, {TRON_A})
        assert svc.screen(recipient=TRON_B, chain="tron").allowed is True

    def test_is_sanctioned_covers_tron(self, monkeypatch):
        svc = self._service(monkeypatch, {TRON_A})
        assert svc.is_sanctioned(TRON_A) is True
        assert svc.is_sanctioned(TRON_B) is False

    def test_tron_screening_survives_the_lowercasing_regression(self, monkeypatch):
        """If anything lowercases TRON keys again, this fails."""
        svc = self._service(monkeypatch, {TRON_A.lower()})
        # Blocklist holds the (wrongly) lowercased key, so the real address must
        # NOT match — proving the screen is case-sensitive rather than silently
        # matching everything.
        assert svc.screen(recipient=TRON_A, chain="tron").allowed is True
