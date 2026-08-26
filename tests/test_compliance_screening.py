"""Compliance screening (UBS × Nethermind PoC model).

Covers the allow/block-list address gate used by SwapEngine.execute_swap:
mode switching (disabled/monitor/enforce), policy switching (blocklist /
allowlist), OFAC seed enforcement, address-family handling (EVM/TRON/Solana
screened, everything else fails closed in ENFORCE), and the OFAC list file
loader. TRON- and Solana-specific cases live in test_compliance_tron.py.
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.config.settings import settings  # noqa: E402
from bot.services.compliance import (  # noqa: E402
    AddressComplianceService,
    ComplianceError,
    ComplianceMode,
    ScreeningPolicy,
)
from bot.services.compliance.ofac_list import (  # noqa: E402
    _parse_address_lines,
    load_ofac_addresses,
    seed_ofac_addresses,
)

# A known OFAC-seeded address (Tornado.Cash router) and an arbitrary clean one.
SANCTIONED = "0x722122df12d4e14e13ac3b6895a86e84145b6967"
CLEAN = "0x1111111111111111111111111111111111111111"
ROUTER = "0x2222222222222222222222222222222222222222"
SOLANA_ADDR = "So11111111111111111111111111111111111111112"


@pytest.fixture()
def svc(monkeypatch):
    """A fresh service with controllable settings, restored after each test."""
    monkeypatch.setattr(settings, "compliance_mode", "disabled", raising=False)
    monkeypatch.setattr(settings, "compliance_policy", "blocklist_only", raising=False)
    monkeypatch.setattr(settings, "compliance_blocklist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_allowlist", "", raising=False)
    monkeypatch.setattr(settings, "compliance_ofac_list_path", "", raising=False)
    service = AddressComplianceService()

    def _set(**kwargs):
        for key, value in kwargs.items():
            monkeypatch.setattr(settings, f"compliance_{key}", value, raising=False)
        service.reload()
        return service

    service.configure = _set  # type: ignore[attr-defined]
    return service


# --- mode -------------------------------------------------------------------


def test_disabled_mode_allows_sanctioned(svc):
    svc.configure(mode="disabled")
    result = svc.screen(recipient=SANCTIONED)
    assert result.allowed is True
    assert result.blocked == []


def test_monitor_mode_allows_but_records(svc):
    svc.configure(mode="monitor")
    result = svc.screen(recipient=SANCTIONED)
    # Monitor: would-block is recorded but the swap is allowed through.
    assert result.allowed is True
    assert len(result.blocked) == 1
    assert result.blocked[0].source == "ofac"


def test_enforce_mode_blocks_sanctioned(svc):
    svc.configure(mode="enforce")
    result = svc.screen(recipient=SANCTIONED)
    assert result.allowed is False
    assert "Compliance check failed" in result.reason
    assert result.blocked[0].role == "recipient"


def test_enforce_allows_clean_addresses(svc):
    svc.configure(mode="enforce")
    result = svc.screen(recipient=CLEAN, router=ROUTER, tokens=[CLEAN])
    assert result.allowed is True
    assert result.blocked == []


# --- blocklist --------------------------------------------------------------


def test_operator_blocklist_enforced(svc):
    svc.configure(mode="enforce", blocklist=ROUTER)
    result = svc.screen(router=ROUTER)
    assert result.allowed is False
    assert result.blocked[0].source == "blocklist"


def test_is_sanctioned_checks_blocklist(svc):
    svc.configure(mode="enforce")
    assert svc.is_sanctioned(SANCTIONED) is True
    assert svc.is_sanctioned(CLEAN) is False
    assert svc.is_sanctioned(None) is False


def test_blocklist_wins_over_allowlist(svc):
    # Even pre-approved, a sanctioned address is still blocked.
    svc.configure(
        mode="enforce",
        policy="allowlist_and_blocklist",
        allowlist=f"{SANCTIONED},{CLEAN}",
    )
    result = svc.screen(recipient=SANCTIONED)
    assert result.allowed is False
    assert result.blocked[0].source == "ofac"


# --- allowlist (UBS "pre-approved addresses") -------------------------------


def test_allowlist_only_blocks_unapproved(svc):
    svc.configure(mode="enforce", policy="allowlist_only", allowlist=CLEAN)
    # CLEAN is approved...
    assert svc.screen(recipient=CLEAN).allowed is True
    # ...ROUTER is not.
    result = svc.screen(router=ROUTER)
    assert result.allowed is False
    assert result.blocked[0].source == "not_allowlisted"


def test_allowlist_only_ignores_blocklist_for_clean_unapproved(svc):
    # In allowlist_only an unsanctioned-but-unapproved address is still blocked,
    # because the policy demands pre-approval.
    svc.configure(mode="enforce", policy="allowlist_only", allowlist=CLEAN)
    result = svc.screen(recipient=ROUTER)
    assert result.allowed is False


# --- address handling -------------------------------------------------------


def test_solana_addresses_are_now_screened(svc):
    """Solana base58 recipients are screenable (see test_compliance_tron.py
    TestSolanaScreening) — unlike a truly unsupported family (Starknet), an
    unlisted-but-not-preapproved Solana recipient is blocked under
    allowlist_only, same as any other screened family."""
    svc.configure(mode="enforce", policy="allowlist_only", allowlist=CLEAN)
    result = svc.screen(recipient=SOLANA_ADDR, chain="solana")
    assert result.allowed is False
    assert result.blocked[0].source == "not_allowlisted"


def test_truly_unscreenable_recipient_fails_closed_in_enforce(svc):
    """A recipient family nothing recognizes at all (not EVM/TRON/Solana/
    Starknet/BTC-bech32) fails CLOSED in ENFORCE mode rather than silently
    passing through unscreened."""
    svc.configure(mode="enforce")
    # Cosmos-style bech32 (no "bc1" prefix) — no known family matches this.
    result = svc.screen(recipient="cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", chain="cosmos")
    assert result.allowed is False
    assert result.blocked[0].source == "unscreenable"


def test_starknet_recipient_is_now_screenable(svc):
    """Finding 1: Starknet (0x + non-EVM-length hex) is a recognized family —
    a clean Starknet recipient passes screening rather than fail-closing."""
    svc.configure(mode="enforce")
    result = svc.screen(recipient="0x" + "1" * 63, chain="starknet")
    assert result.allowed is True
    assert result.blocked == []


def test_starknet_recipient_blocked_when_on_blocklist(svc):
    """A blocklisted Starknet address is screened like any other family."""
    starknet_addr = "0x" + "2" * 41  # 41 hex chars => total len 43, not EVM (EVM is 0x + 40 = 42)
    svc.configure(mode="enforce", blocklist=starknet_addr)
    result = svc.screen(recipient=starknet_addr, chain="starknet")
    assert result.allowed is False
    assert result.blocked[0].source == "blocklist"


def test_btc_bech32_recipient_is_screenable(svc):
    """BTC bech32 (bc1...) recipients are recognized and normalized lowercase
    verbatim."""
    svc.configure(mode="enforce")
    btc_addr = "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"
    result = svc.screen(recipient=btc_addr, chain="bitcoin")
    assert result.allowed is True


def test_null_recipient_fails_closed_in_enforce(svc):
    """Finding 4: an explicitly-passed empty/None recipient must fail closed
    in ENFORCE, not silently sail through as allowed."""
    svc.configure(mode="enforce")
    assert svc.screen(recipient=None).allowed is False
    assert svc.screen(recipient="").allowed is False


def test_null_recipient_allowed_in_monitor(svc):
    svc.configure(mode="monitor")
    result = svc.screen(recipient=None)
    assert result.allowed is True
    assert result.blocked, "MONITOR should still record the would-block verdict"


def test_omitted_recipient_kwarg_still_noops_like_before(svc):
    """Callers that never pass a recipient at all (e.g. address_gate.py's
    token-only screening) must NOT be affected by the null-recipient
    fail-closed fix — omitting the kwarg is different from passing None."""
    svc.configure(mode="enforce")
    result = svc.screen(tokens=[CLEAN])
    assert result.allowed is True
    assert result.blocked == []


def test_degraded_ofac_list_blocks_in_enforce(svc, tmp_path, monkeypatch):
    """Finding 2: if the configured OFAC extra_path failed to load/parse,
    the list provider is degraded, and ENFORCE must fail closed."""
    bad_path = str(tmp_path / "does-not-exist.txt")
    svc.configure(mode="enforce", ofac_list_path=bad_path)
    assert svc._list_degraded is True
    result = svc.screen(recipient=CLEAN)
    assert result.allowed is False
    assert result.blocked[0].source == "degraded_list"


def test_degraded_ofac_list_allowed_in_monitor(svc, tmp_path):
    bad_path = str(tmp_path / "does-not-exist.txt")
    svc.configure(mode="monitor", ofac_list_path=bad_path)
    assert svc._list_degraded is True
    result = svc.screen(recipient=CLEAN)
    assert result.allowed is True
    assert any(v.source == "degraded_list" for v in result.blocked)


def test_healthy_ofac_list_not_degraded(svc):
    svc.configure(mode="enforce")
    assert svc._list_degraded is False


def test_case_insensitive_matching(svc):
    svc.configure(mode="enforce")
    result = svc.screen(recipient=SANCTIONED.upper())
    assert result.allowed is False


def test_multiple_roles_screened(svc):
    svc.configure(mode="enforce")
    result = svc.screen(recipient=CLEAN, router=SANCTIONED, tokens=[CLEAN])
    assert result.allowed is False
    roles = {v.role for v in result.blocked}
    assert roles == {"router"}


# --- assert_compliant -------------------------------------------------------


def test_assert_compliant_raises(svc):
    svc.configure(mode="enforce")
    with pytest.raises(ComplianceError):
        svc.assert_compliant(recipient=SANCTIONED)


def test_assert_compliant_passes(svc):
    svc.configure(mode="enforce")
    result = svc.assert_compliant(recipient=CLEAN)
    assert result.allowed is True


# --- enums / config robustness ---------------------------------------------


def test_unknown_mode_defaults_disabled(svc):
    svc.configure(mode="nonsense")
    assert svc.mode is ComplianceMode.DISABLED
    assert svc.enabled is False


def test_unknown_policy_defaults_blocklist(svc):
    svc.configure(mode="enforce", policy="nonsense")
    assert svc.policy is ScreeningPolicy.BLOCKLIST_ONLY


# --- OFAC list loader -------------------------------------------------------


def test_seed_list_nonempty_and_lowercased():
    seed = seed_ofac_addresses()
    assert SANCTIONED in seed
    assert all(a == a.lower() for a in seed)


def test_load_with_extra_file(tmp_path):
    extra = tmp_path / "ofac.txt"
    extra.write_text(
        "# sanctions\n"
        f"{CLEAN}\n"
        "0xABCDEF0000000000000000000000000000000001, some label\n"
        "not-an-address\n"
        "\n"
    )
    addrs = load_ofac_addresses(str(extra))
    assert CLEAN in addrs
    assert "0xabcdef0000000000000000000000000000000001" in addrs
    assert "not-an-address" not in addrs
    # Seed entries are still present.
    assert SANCTIONED in addrs


def test_load_missing_file_falls_back_to_seed():
    addrs = load_ofac_addresses("/nonexistent/path/ofac.txt")
    assert SANCTIONED in addrs


def test_parse_address_lines_filters_invalid():
    parsed = _parse_address_lines([CLEAN, "# comment", "", "0x123", "garbage"])
    assert parsed == {CLEAN}
