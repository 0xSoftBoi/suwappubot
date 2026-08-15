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
