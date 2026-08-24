"""Regression test: admin checks must fail CLOSED when no admin IDs are configured.

Both admin_fees.is_admin and admin_custodial.is_admin previously returned
`user_id in ADMIN_IDS or len(ADMIN_IDS) == 0` with `ADMIN_IDS = []` hardcoded —
so EVERY user was admin. They now load ADMIN_IDS from settings and fail closed.

Loads each handler module in isolation (importlib + qrcode/PIL stubs) to avoid
running bot.handlers.__init__, which imports siblings using 3.10 `str | None`
syntax invalid on the local 3.9. CI (3.11) is unaffected.
"""

import importlib.util
import os
import pathlib
import sys
import types

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")


_inserted_stub_names = []


def _install_stub(name):
    if name in sys.modules:
        return

    class _Stub(types.ModuleType):
        def __getattr__(self, item):
            s = type(item, (), {})
            setattr(self, item, s)
            return s

    m = _Stub(name)
    m.__path__ = []
    sys.modules[name] = m
    _inserted_stub_names.append(name)


for _n in (
    "qrcode",
    "qrcode.constants",
    "qrcode.image",
    "qrcode.image.styledpil",
    "qrcode.image.styles",
    "qrcode.image.styles.moduledrawers",
    "qrcode.image.styles.colormasks",
    "PIL",
    "PIL.Image",
):
    _install_stub(_n)


def _load(relpath, modname):
    path = pathlib.Path(__file__).resolve().parents[1] / relpath
    spec = importlib.util.spec_from_file_location(modname, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


admin_fees = _load("bot/handlers/admin_fees.py", "admin_fees_under_test")
admin_custodial = _load("bot/handlers/admin_custodial.py", "admin_custodial_under_test")

# These stubs are only needed for the exec_module() calls above. Leaving them
# in sys.modules leaks a fake "PIL"/"PIL.Image" into every other test file
# collected in the same pytest process (e.g. tests/test_chart_render.py,
# which needs the real Pillow Image.new) — pop them back out now.
for _n in _inserted_stub_names:
    sys.modules.pop(_n, None)


import pytest


@pytest.mark.parametrize("mod", [admin_fees, admin_custodial])
def test_fail_closed_when_no_admins_configured(mod):
    mod.ADMIN_IDS = []
    assert mod.is_admin(123456789) is False
    assert mod.is_admin(0) is False


@pytest.mark.parametrize("mod", [admin_fees, admin_custodial])
def test_allows_only_listed_admins(mod):
    mod.ADMIN_IDS = [111]
    assert mod.is_admin(111) is True
    assert mod.is_admin(222) is False
