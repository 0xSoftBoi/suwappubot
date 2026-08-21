"""Internal wallets must be inert.

We provision wallets for testing, deploys and experiments. The danger is not
creating them — it is that something OPERATIONAL picks one up and moves real
money through it. Two ways that can happen, and both are covered here:

  1. by ROLE — get_deposit_wallet / get_gas_payer_wallet select on
     is_deposit_wallet / is_gas_payer, so an internal wallet must carry neither.
  2. by NAME — swap_engine (Tempo fee sponsor), tempo_keychain and
     treasury_vault_service each select a wallet by EXACT NAME. An internal
     wallet called "tempo-sponsor" would be used to pay real gas.

The `internal/` prefix is what makes (2) impossible rather than unlikely.
"""

import inspect
import re

import pytest

from bot.services.hot_wallet import HotWalletService


def test_internal_wallets_are_namespaced():
    assert HotWalletService.INTERNAL_PREFIX == "internal/"


@pytest.mark.parametrize("bad", ["", "   ", "/", "has/slash", "x" * 49])
def test_bad_labels_are_rejected(bad):
    import asyncio

    svc = HotWalletService()
    with pytest.raises(ValueError):
        asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
            svc.provision_internal_wallet(bad)
        )


def test_provisioning_forces_both_operational_roles_off():
    """The whole safety property, asserted against the source: an internal
    wallet must be created with is_deposit_wallet=False AND is_gas_payer=False.
    Defaults are not enough — create_hot_wallet defaults is_deposit_wallet=True.
    """
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "is_deposit_wallet=False" in src
    assert "is_gas_payer=False" in src
    # and it must not be reachable with a caller-supplied role
    assert "is_deposit_wallet=is_" not in src and "is_gas_payer=is_" not in src


def test_operational_name_lookups_cannot_match_an_internal_wallet():
    """Every by-name lookup over HotWallet, checked against the namespace.

    If someone adds a new name-selected operational wallet whose name starts
    with `internal/`, this fails — which is the point.
    """
    import pathlib

    repo = pathlib.Path(__file__).resolve().parent.parent
    sources = [
        repo / "bot" / "services" / "swap_engine.py",
        repo / "bot" / "services" / "tempo_keychain.py",
        repo / "bot" / "services" / "treasury_vault_service.py",
    ]
    for f in sources:
        text = f.read_text()
        # any string literal compared against HotWallet.name
        for lit in re.findall(r"HotWallet\.name\s*==\s*([A-Za-z_][\w.]*|\"[^\"]*\")", text):
            assert not lit.strip('"').startswith(
                "internal/"
            ), f"{f.name} selects an operational wallet inside the internal namespace: {lit}"


def test_the_admin_command_is_documented_where_it_is_used():
    """A provisioning command nobody can find is not a capability."""
    import pathlib

    repo = pathlib.Path(__file__).resolve().parent.parent
    handler = (repo / "bot" / "handlers" / "admin_custodial.py").read_text()
    assert "/hw new <label>" in handler
    # and the full address must be shown — a truncated one cannot be funded
    assert "{wallet.address}" in handler


# ── Lifecycle ───────────────────────────────────────────────────────────────
#
# Spinning wallets UP safely was the first half. The second half is spinning
# them DOWN: retiring a wallet that still holds a balance strands it, because
# Turnkey keeps the key but nothing in our DB points at the wallet any more.


def test_retire_refuses_a_funded_wallet_unless_forced():
    """The core spin-down safety property, asserted against the source.

    A retirement path that flips is_active without first checking balances is
    how testnet float silently becomes lost float.
    """
    src = inspect.getsource(HotWalletService.retire_internal_wallet)
    assert "check_internal_wallet_funds" in src, "retire must check balances first"
    assert (
        "if (funded or errored) and not force" in src
    ), "retire must refuse when funds are found or a chain was unreachable"
    # The refusal must return, not raise-and-continue into the is_active flip.
    refusal = src.index("if (funded or errored) and not force")
    flip = src.index("row.is_active = False")
    assert refusal < flip, "the balance guard must sit before the retirement write"


def test_unreachable_chain_is_not_treated_as_empty():
    """'We could not check' and 'it is empty' must never look the same.

    A dead RPC returning a silent zero would let retire() sail past a funded
    wallet, which is precisely the failure the balance guard exists to stop.
    """
    src = inspect.getsource(HotWalletService.check_internal_wallet_funds)
    assert "unreachable[chain] = err" in src, "a failed balance call must be recorded, not zeroed"
    assert "elif held is not None" in src, "a failed chain must not fall through to the zero path"

    retire_src = inspect.getsource(HotWalletService.retire_internal_wallet)
    assert 'errored = funds["unreachable"]' in retire_src
    assert "funded or errored" in retire_src, "unreachable chains must block retirement too"


def test_retirement_does_not_delete_the_turnkey_key():
    """Retirement is a DB operation. Deleting the upstream key is irreversible
    and removes the only means of recovering a balance found later.
    """
    src = inspect.getsource(HotWalletService.retire_internal_wallet)
    for forbidden in ("delete_wallet", "DELETE_WALLET", "delete_private_key"):
        assert forbidden not in src, f"retire must not call {forbidden}"


def test_retired_names_are_not_revived():
    """A retired wallet keeps its name so the audit trail stays readable, and a
    new wallet must not silently inherit it — that would resurrect an identity
    someone deliberately decommissioned.
    """
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "retired" in src and "was retired" in src
    assert "retired keys are not revived" in src


def test_provisioning_is_capped():
    """The cap is the mechanism that keeps the roster small. Without it,
    get-or-create is just unlimited minting with extra steps.
    """
    assert isinstance(HotWalletService.INTERNAL_WALLET_CAP, int)
    assert 0 < HotWalletService.INTERNAL_WALLET_CAP <= 25
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "INTERNAL_WALLET_CAP" in src
    # The cap must be counted over LIVE wallets only, or retiring would never
    # free headroom.
    assert "HotWallet.is_active == True" in src


def test_reprovisioning_returns_the_same_wallet_rather_than_a_duplicate():
    """Get-or-create, not create-or-explode. A caller forced to catch
    'already exists' is a caller that will eventually append '-2'.
    """
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "return self.get_hot_wallet_by_id(wallet_id), False" in src


def test_retirement_requires_a_reason():
    src = inspect.getsource(HotWalletService.retire_internal_wallet)
    assert "a reason is required" in src


# ── Coverage of the balance guard ───────────────────────────────────────────
#
# The guard is only worth what it actually checks. These lock in the specific
# blind spots found by auditing the first cut of the lifecycle.


def test_sweep_chains_include_robinhood():
    """The wallet that motivated this feature is a Robinhood Chain deployer.

    The first version of the sweep list omitted `robinhood` entirely, so the
    balance guard would have reported "empty" for the one chain the wallet
    exists to be funded on, and retired it with the funds still there.
    """
    assert "robinhood" in HotWalletService.INTERNAL_SWEEP_CHAINS


def test_networks_outside_the_chain_registry_are_still_probed():
    """ROBINHOOD_TESTNET is deliberately NOT in CHAINS (tooling only), so
    rpc_manager cannot serve it and get_hot_wallet_balance is blind to it in
    principle — not merely missing a list entry. It needs a direct probe.
    """
    probes = HotWalletService._internal_probe_networks()
    assert "robinhood_testnet" in probes
    assert probes["robinhood_testnet"]["chain_id"] == 46630
    assert probes["robinhood_testnet"]["rpc_url"].startswith("https://")

    src = inspect.getsource(HotWalletService.check_internal_wallet_funds)
    assert "_internal_probe_networks" in src, "probe networks must be consulted"


def test_funds_check_reports_where_it_looked():
    """ "No funds found" is only as good as the coverage behind it. The result
    must carry the chains consulted so a refusal can never be read as proof of
    emptiness.
    """
    src = inspect.getsource(HotWalletService.check_internal_wallet_funds)
    assert '"checked"' in src and '"unreachable"' in src and '"balances"' in src

    retire_src = inspect.getsource(HotWalletService.retire_internal_wallet)
    assert '"checked": checked' in retire_src, "retire must surface its coverage"


def test_a_sweep_exists_so_force_is_not_the_only_exit():
    """retire refuses while funded and tells the operator to sweep first. If no
    sweep exists, the only usable exit is --force, which abandons the money — a
    guard whose sole escape hatch is the lossy one is not a guard.
    """
    assert hasattr(HotWalletService, "sweep_internal_wallet")
    src = inspect.getsource(HotWalletService.sweep_internal_wallet)
    # Must leave gas behind, or the sweep reverts for funds and the wallet stays
    # un-retirable anyway.
    assert "reserve_wei" in src and "21000" in src
    assert "send_wei <= 0" in src, "must refuse when the balance cannot cover gas"
    # Must never invent a destination.
    assert "a destination is required" in src


def test_null_retired_at_does_not_crash_the_name_collision_message():
    """A wallet deactivated by some other path has retired_at NULL. Formatting
    None with a date spec raises TypeError, turning a helpful message into a 500.
    """
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "if retired.retired_at else" in src, "date format must be guarded against NULL"

    with pytest.raises(TypeError):
        # The bug this guards against, demonstrated.
        f"{None:%Y-%m-%d}"


def test_reuse_does_not_silently_clear_an_existing_expiry():
    """Re-provisioning without a ttl_days must not strip the lease off a live
    wallet — that would quietly make an expiring wallet immortal.
    """
    src = inspect.getsource(HotWalletService.provision_internal_wallet)
    assert "if expires_at is not None:" in src


def test_balance_checks_are_concurrent():
    """An audit over a full roster is otherwise dozens of sequential RPC round
    trips inside a chat handler.
    """
    src = inspect.getsource(HotWalletService.check_internal_wallet_funds)
    assert "asyncio.gather" in src
