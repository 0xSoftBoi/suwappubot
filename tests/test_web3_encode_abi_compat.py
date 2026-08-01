"""Regression guard: `encode_abi()` must not use the removed `fn_name=` kwarg.

web3.py v7 (pinned: requirements.txt `web3==7.16.0`) renamed
`BaseContract.encode_abi`'s first parameter from `fn_name` to
`abi_element_identifier`, so any call passing `fn_name=` raises

    TypeError: BaseContract.encode_abi() got an unexpected keyword argument 'fn_name'

This is not caught by import-time checks or by tests that mock at a higher
level — it only blows up when the transaction is actually built, i.e. in the
money path. It shipped once already: nine call sites (ERC20 `approve` in the
non-custodial `POST /webapp/swap/build` path, CCTP `depositForBurn`, Across
`depositV3`, CoW `approve`, Wormhole `transferTokens`/`completeTransfer`)
were all broken on the pinned version.

Repo convention is the positional form: `encode_abi("approve", args=[...])`.
"""

import re
from pathlib import Path

import pytest
from web3 import Web3

REPO_ROOT = Path(__file__).resolve().parent.parent
SCANNED_DIRS = ("bot", "api", "database")

# Matches `fn_name=` appearing as a keyword argument.
FN_NAME_KWARG = re.compile(r"\bfn_name\s*=")

ERC20_APPROVE_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


def _python_files():
    for directory in SCANNED_DIRS:
        root = REPO_ROOT / directory
        if not root.is_dir():
            continue
        for path in root.rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            yield path


def test_no_fn_name_kwarg_anywhere():
    """No source file may pass `fn_name=` — it raises on the pinned web3."""
    offenders = []
    for path in _python_files():
        for lineno, line in enumerate(path.read_text().splitlines(), start=1):
            if FN_NAME_KWARG.search(line):
                rel = path.relative_to(REPO_ROOT)
                offenders.append(f"{rel}:{lineno}: {line.strip()}")

    assert not offenders, (
        "encode_abi(fn_name=...) raises TypeError on the pinned web3 7.x. "
        'Use the positional form instead: encode_abi("fnName", args=[...]).\n'
        + "\n".join(offenders)
    )


def test_fn_name_kwarg_really_does_raise():
    """Pin the underlying behaviour, so this guard can't rot into a no-op.

    If a future web3 upgrade restores `fn_name=`, this test fails and tells us
    the guard above is now over-strict — rather than silently protecting
    against nothing.
    """
    contract = Web3().eth.contract(address="0x" + "11" * 20, abi=ERC20_APPROVE_ABI)

    with pytest.raises(TypeError, match="fn_name"):
        contract.encode_abi(fn_name="approve", args=["0x" + "22" * 20, 1])


def test_positional_form_is_correct():
    """The replacement form must produce the right selector (0x095ea7b3)."""
    contract = Web3().eth.contract(address="0x" + "11" * 20, abi=ERC20_APPROVE_ABI)

    data = contract.encode_abi("approve", args=["0x" + "22" * 20, 1])

    assert data.startswith("0x095ea7b3"), data
