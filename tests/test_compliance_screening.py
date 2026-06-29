"""Compliance screening (UBS × Nethermind PoC model).

Covers the allow/block-list address gate used by SwapEngine.execute_swap:
mode switching (disabled/monitor/enforce), policy switching (blocklist /
allowlist), OFAC seed enforcement, non-EVM pass-through, and the OFAC list
file loader.
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.config.settings import settings
from bot.services.compliance import (
    AddressComplianceService,
    ComplianceError,
    ComplianceMode,
    ScreeningPolicy,
)
from bot.services.compliance.ofac_list import (
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


def test_non_evm_addresses_skipped(svc):
    svc.configure(mode="enforce", policy="allowlist_only", allowlist=CLEAN)
    # Solana address isn't 0x-style → not screened → no violation from it.
    result = svc.screen(recipient=SOLANA_ADDR, chain="solana")
    assert result.allowed is True
    assert result.verdicts == []


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
