"""The in-memory EVM: what it answers, what it reports it could not read.

Three questions, in order of how much they would cost to get wrong:

* **the miss protocol converges.**  A slot that was never inserted reads as
  zero, and a zero fee, rate or balance is a plausible number -- the quote
  succeeds and is wrong.  `dev/local_evm.py` guards that with an access list
  fetched up front; this guards it by reporting every read it could not
  answer, so the caller fetches exactly those and runs the call again.
* **a revert is not a halt, and neither is an empty return.**  A Curve pool
  that does not implement a function returns empty data rather than reverting,
  which `core/transport.Answer` keeps apart from a revert on purpose.
* **the wasm build agrees with the native one**, so a browser quote is a
  desktop quote.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

erouter_evm = pytest.importorskip("erouter_evm")

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "evm_harness.mjs"
PKG = ROOT / "rust" / "wasm" / "pkg"
NODE = shutil.which("node")

CALLER = "0x" + "11" * 20

#: PUSH1 42; PUSH0; MSTORE; PUSH1 32; PUSH0; RETURN
RETURNS_42 = "602a5f5260205ff3"
#: PUSH1 7; SLOAD; PUSH0; MSTORE; PUSH1 32; PUSH0; RETURN
READS_SLOT_7 = "6007545f5260205ff3"
#: PUSH0; PUSH0; REVERT -- a revert with no reason, which is what a Curve
#: pool that cannot solve its own invariant does.
REVERTS = "5f5ffd"
#: STOP -- succeeds, returns nothing.  The shape `Status.WRONG_ABI` exists for.
RETURNS_NOTHING = "00"
#: PUSH1 1; PUSH1 0; MSTORE ... then INVALID (0xfe): a halt, not a revert.
HALTS = "fe"


def fresh(**kw):
    evm = erouter_evm.Evm(kw.get("spec", "Osaka"), kw.get("chain_id", 1))
    evm.set_block(number=23_900_000, timestamp=1_770_000_000)
    return evm


def test_a_call_returns_what_the_code_returns():
    evm = fresh()
    who = "0x" + "22" * 20
    evm.insert_account(who, code=bytes.fromhex(RETURNS_42))
    out = evm.call(CALLER, who, b"")
    assert out["success"]
    assert int.from_bytes(out["output"], "big") == 42
    assert out["gas_used"] > 21_000


def test_an_unread_slot_reads_as_zero_and_says_so():
    """The whole reason the miss sets exist."""
    evm = fresh()
    who = "0x" + "44" * 20
    evm.insert_account(who, code=bytes.fromhex(READS_SLOT_7))
    evm.take_misses()  # the caller's own account, from funding it
    out = evm.call(CALLER, who, b"")
    assert int.from_bytes(out["output"], "big") == 0, "an absent slot is a zero"
    misses = evm.take_misses()
    assert (who, "0x7") in [(a, s) for a, s in misses["slots"]], misses


def test_the_miss_loop_converges():
    """Fetch what was missed, insert it, run again: no misses the second time.

    Two rounds by construction when the *account* is unknown -- its slots only
    become visible once its code is there to read them.
    """
    evm = fresh()
    who = "0x" + "44" * 20
    chain = {(who, "0x7"): "0x1234"}
    code = {who: bytes.fromhex(READS_SLOT_7)}

    rounds = 0
    while True:
        rounds += 1
        assert rounds < 5, "the miss loop did not converge"
        out = evm.call(CALLER, who, b"")
        misses = evm.take_misses()
        # The caller is nobody and holds nothing; a real session funds it once.
        fetched = False
        for address in misses["accounts"]:
            evm.insert_account(address, code=code.get(address))
            fetched = True
        for address, slot in misses["slots"]:
            evm.insert_storage(address, slot, chain.get((address, slot), "0x0"))
            fetched = True
        if not fetched:
            break
    assert int.from_bytes(out["output"], "big") == 0x1234
    assert rounds >= 2, "an unknown account cannot be resolved in one round"


def test_a_revert_is_not_a_halt_and_neither_is_an_empty_return():
    evm = fresh()
    reverting, silent, halting = ("0x" + c * 20 for c in ("55", "66", "77"))
    evm.insert_account(reverting, code=bytes.fromhex(REVERTS))
    evm.insert_account(silent, code=bytes.fromhex(RETURNS_NOTHING))
    evm.insert_account(halting, code=bytes.fromhex(HALTS))

    bad = evm.call(CALLER, reverting, b"")
    assert not bad["success"] and bad["halt_reason"] is None
    assert bad["revert_reason"] == ""

    quiet = evm.call(CALLER, silent, b"")
    assert quiet["success"] and quiet["output"] == b"", (
        "a pool that does not implement a function succeeds and returns nothing"
    )

    dead = evm.call(CALLER, halting, b"")
    assert not dead["success"] and dead["halt_reason"], dead


def test_a_revert_reason_is_decoded():
    """`Error(string)`, which is what `Answer.message` carries upstream."""
    evm = fresh()
    reason = b"lp token unknown"
    body = (bytes.fromhex("08c379a0")
            + (32).to_bytes(32, "big")
            + len(reason).to_bytes(32, "big")
            + reason.ljust(32, b"\0"))
    # Store the payload in memory and REVERT over it, built as a loop of
    # MSTOREs so the test does not depend on a compiler.
    code = bytearray()
    for k in range(0, len(body), 32):
        code += b"\x7f" + body[k:k + 32].ljust(32, b"\0")   # PUSH32 word
        code += b"\x60" + bytes([k])                        # PUSH1 offset
        code += b"\x52"                                     # MSTORE
    code += b"\x60" + bytes([len(body)]) + b"\x5f\xfd"      # PUSH1 len; PUSH0; REVERT
    who = "0x" + "88" * 20
    evm.insert_account(who, code=bytes(code))
    out = evm.call(CALLER, who, b"")
    assert not out["success"]
    assert out["revert_reason"] == "lp token unknown", out


def test_the_block_environment_reaches_the_code():
    """A zero timestamp is not harmless: 3pool's `A()` underflows there."""
    evm = erouter_evm.Evm("Osaka", 1)
    evm.set_block(number=123, timestamp=456)
    #: TIMESTAMP; PUSH0; MSTORE; PUSH1 32; PUSH0; RETURN
    who = "0x" + "99" * 20
    evm.insert_account(who, code=bytes.fromhex("425f5260205ff3"))
    out = evm.call(CALLER, who, b"")
    assert int.from_bytes(out["output"], "big") == 456


def test_a_quote_does_not_depend_on_who_asks():
    """`eth_call` semantics: no balance, no nonce, no fee, no gas cap.

    Every one of those would refuse a call a node answers, and the caller is
    an account that holds nothing by construction.
    """
    evm = fresh()
    who = "0x" + "22" * 20
    evm.insert_account(who, code=bytes.fromhex(RETURNS_42))
    # A gas limit far above EIP-7825's 16.7M transaction cap: a probe batch is
    # hundreds of sub-calls in one `eth_call`, which a node answers.
    out = evm.call(CALLER, who, b"", gas_limit=3_000_000_000)
    assert out["success"], out


def test_known_slots_reports_what_was_inserted():
    evm = fresh()
    who = "0x" + "44" * 20
    evm.insert_account(who, code=bytes.fromhex(READS_SLOT_7))
    evm.insert_storage_many([(who, "0x1", "0xa"), (who, "0x2", "0xb")])
    assert evm.slot_count == 2
    assert sorted(evm.known_slots()) == [(who, "0x1"), (who, "0x2")]


# ------------------------------------------------------ against pyrevm


pyrevm = pytest.importorskip("pyrevm")


def test_the_same_state_gives_pyrevm_the_same_answer():
    """The wrapper against the wheel `dev/local_evm.py` uses today.

    Same code, same slots, same header -- so any difference is this wrapper's
    configuration rather than the EVM underneath.
    """
    who = "0x" + "44" * 20
    code = bytes.fromhex(READS_SLOT_7)

    mine = fresh()
    mine.insert_account(who, code=code)
    mine.insert_storage(who, "0x7", "0xdeadbeef")
    ours = mine.call(CALLER, who, b"")

    theirs = pyrevm.EVM(tracing=False, spec_id="CANCUN")
    theirs.set_block_env(pyrevm.BlockEnv(number=23_900_000, timestamp=1_770_000_000))
    theirs.set_balance(CALLER, 10 ** 24)
    theirs.insert_account_info(who, pyrevm.AccountInfo(nonce=1, code=code))
    theirs.insert_account_storage(who, 7, 0xDEADBEEF)
    got = bytes(theirs.message_call(caller=CALLER, to=who, calldata=b""))

    assert ours["output"] == got
    assert int.from_bytes(got, "big") == 0xDEADBEEF


def test_pyrevm_agrees_on_a_revert():
    who = "0x" + "55" * 20
    code = bytes.fromhex(REVERTS)

    mine = fresh()
    mine.insert_account(who, code=code)
    ours = mine.call(CALLER, who, b"")
    assert not ours["success"]

    theirs = pyrevm.EVM(tracing=False, spec_id="CANCUN")
    theirs.set_block_env(pyrevm.BlockEnv(number=23_900_000, timestamp=1_770_000_000))
    theirs.set_balance(CALLER, 10 ** 24)
    theirs.insert_account_info(who, pyrevm.AccountInfo(nonce=1, code=code))
    # pyrevm raises a bare `RuntimeError` on a revert -- the wrapper's whole
    # point is that this is a *value* to read, not an exception to catch.
    with pytest.raises(RuntimeError):
        theirs.message_call(caller=CALLER, to=who, calldata=b"")


# -------------------------------------------------------- against wasm


wasm = pytest.mark.skipif(
    NODE is None or not (PKG / "erouter_wasm_bg.wasm").exists(),
    reason="node, and scripts/build_wasm.sh",
)


def through_wasm(job: dict) -> dict:
    done = subprocess.run(
        [NODE, str(HARNESS), str(PKG)],
        input=json.dumps(job), capture_output=True, text=True, timeout=120,
    )
    if done.returncode != 0:
        raise AssertionError(f"harness failed:\n{done.stderr}")
    return json.loads(done.stdout)


@wasm
def test_the_browser_evm_is_the_desktop_evm():
    who, reverting, silent = ("0x" + c * 20 for c in ("44", "55", "66"))
    job = {
        "spec": "Osaka",
        "chain_id": 1,
        "block": {"number": 23_900_000, "timestamp": 1_770_000_000},
        "accounts": [
            {"address": who, "code": READS_SLOT_7},
            {"address": reverting, "code": REVERTS},
            {"address": silent, "code": RETURNS_NOTHING},
        ],
        "storage": [[who, "0x7", "0xdeadbeef"]],
        "calls": [
            {"caller": CALLER, "to": who, "data": ""},
            {"caller": CALLER, "to": reverting, "data": ""},
            {"caller": CALLER, "to": silent, "data": ""},
            # An account nobody inserted: the miss the loop is built on.
            {"caller": CALLER, "to": "0x" + "ab" * 20, "data": "01020304"},
        ],
    }
    theirs = through_wasm(job)

    mine = fresh()
    for account in job["accounts"]:
        mine.insert_account(account["address"], code=bytes.fromhex(account["code"]))
    for address, slot, value in job["storage"]:
        mine.insert_storage(address, slot, value)
    ours = [mine.call(c["caller"], c["to"], bytes.fromhex(c["data"]))
            for c in job["calls"]]

    for k, (a, b) in enumerate(zip(ours, theirs["results"], strict=True)):
        assert a["success"] == b["success"], f"call {k}: success"
        assert a["output"].hex() == b["output"], f"call {k}: output"
        assert a["gas_used"] == b["gasUsed"], f"call {k}: gas"
        assert a["revert_reason"] == b["revertReason"], f"call {k}: revert"
        assert a["halt_reason"] == b["haltReason"], f"call {k}: halt"

    misses = mine.take_misses()
    assert misses["accounts"] == theirs["misses"]["accounts"]
    flat = [v for pair in misses["slots"] for v in pair]
    assert flat == theirs["misses"]["slots"]
