"""`ROUTER_ADDRESS` is where this source deploys, on every chain.

The router went out through the canonical CREATE2 proxy, so its address is
`keccak(proxy, salt, initcode)` and does not depend on the chain, the deployer
or a nonce.  It does depend on the source: Vyper embeds a hash of it in the
*initcode*, which the runtime never sees.

That is the trap.  Editing a comment leaves the deployed bytecode
byte-identical while moving where the source says it lives -- so nothing looks
wrong, and `ROUTER_ADDRESS` quietly points at a contract the repo can no longer
reproduce.  Caught once already on the quoter, by an `@author` line.
"""

from __future__ import annotations

import pytest

from erouter.core.keccak import keccak256
from erouter.core.schema import ROUTER_ADDRESS

boa = pytest.importorskip("boa", reason="deriving the address needs the compiler")

CONTRACT = "contracts/ElectricRouter.vy"
SALT_PHRASE = b"erouter.ElectricRouter.v2"


def test_the_source_still_deploys_to_the_recorded_address():
    from erouter.dev.deploy import create2_address

    initcode = boa.load_partial(CONTRACT).compiler_data.bytecode
    assert create2_address(keccak256(SALT_PHRASE), initcode).lower() == \
        ROUTER_ADDRESS.lower(), (
        "ElectricRouter.vy no longer compiles to ROUTER_ADDRESS.  The deployed "
        "runtime may still match byte for byte -- the source hash lives in the "
        "initcode -- but this source is not what is on chain.  Either revert "
        "the edit, or redeploy under a new salt and update both."
    )


def test_the_salt_matches_the_deploy_script():
    """So bumping one and not the other cannot pass.

    Read rather than imported: `scripts/` is not a package, and the module
    rewrites `sys.path` at import time.
    """
    import pathlib
    import re

    source = pathlib.Path("scripts/deploy_router.py").read_text()
    found = re.search(r'^SALT_PHRASE = "([^"]+)"', source, re.M)
    assert found, "deploy_router.py should define SALT_PHRASE"
    assert found.group(1).encode() == SALT_PHRASE
