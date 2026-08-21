"""Pin the USDG EIP-712 domain the mint's payment path depends on.

Everything about the gasless mint rests on signing against the RIGHT domain. Get
one field wrong and USDG rejects every authorization, and it fails as an opaque
revert rather than as anything that names the cause.

The constant below was read from live chain 4663 (`DOMAIN_SEPARATOR()` on USDG at
0x5fc5...d168). The token's `name()` returns "Global Dollar" and `version()`
REVERTS, so the version cannot be read and has to be inferred — this test is what
turns that inference into a checked fact. No network: it recomputes the separator
from our assumed parameters and asserts it reproduces what the chain returned.
"""

from eth_abi import encode
from eth_utils import keccak

USDG_4663 = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
ONCHAIN_DOMAIN_SEPARATOR = bytes.fromhex(
    "7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036"
)
DOMAIN_TYPEHASH = keccak(
    text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)


def _separator(name: str, version: str, chain_id: int, verifying: str) -> bytes:
    return keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [DOMAIN_TYPEHASH, keccak(text=name), keccak(text=version), chain_id, verifying],
        )
    )


def test_assumed_domain_reproduces_the_onchain_separator():
    assert _separator("Global Dollar", "1", 4663, USDG_4663) == ONCHAIN_DOMAIN_SEPARATOR


def test_a_wrong_version_does_not_accidentally_match():
    """Guards against the assertion above passing for the wrong reason."""
    for bad in ("2", "1.0", "", "01"):
        assert _separator("Global Dollar", bad, 4663, USDG_4663) != ONCHAIN_DOMAIN_SEPARATOR


def test_the_helper_and_the_probe_agree_on_the_domain():
    """tests/positions_helpers.py signs mints and scripts/probe_wallet_eip3009.py
    is what a human hands to a real wallet. If they disagree, a green suite would
    coexist with a wallet that cannot pay."""
    import importlib.util
    import os

    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    spec = importlib.util.spec_from_file_location(
        "probe", os.path.join(repo, "scripts", "probe_wallet_eip3009.py")
    )
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)

    assert probe.DOMAIN_NAME == "Global Dollar"
    assert probe.DOMAIN_VERSION == "1"
    assert probe.domain_separator(4663, USDG_4663) == ONCHAIN_DOMAIN_SEPARATOR

    helper = open(os.path.join(repo, "tests", "positions_helpers.py")).read()
    assert '"name": "Global Dollar"' in helper
    assert '"version": "1"' in helper
