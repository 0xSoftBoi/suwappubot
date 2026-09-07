"""What counts as an access list, and what only looks like one.

`eth_createAccessList` is the cheap way to learn which slots a call touches,
and the expensive failure is not an endpoint that refuses -- it is one that
answers.  A refusal falls back to `debug_traceCall`; a plausible empty answer
does not, and the local EVM then runs the pool against state it never loaded,
which reads as a pool holding zero rather than as an error.

These pin the three shapes seen in the wild.  The middle one is tac's, verbatim.
"""

from erouter.dev.local_evm import _access_list_error, _access_list_failed


def test_a_real_list_is_accepted():
    answer = {"accessList": [{"address": "0xaad4", "storageKeys": ["0x0", "0x1"]}],
              "gasUsed": "0x1e240"}
    assert _access_list_error(answer) == ""
    assert not _access_list_failed(answer)


def test_empty_list_with_gas_burned_is_a_failure():
    # tac, verbatim: a `get_dy` that supposedly used a million gas and touched
    # no storage.  Nothing in the answer says it failed, and believing it cost
    # the whole chain -- three pools loaded with code and none of their state.
    assert _access_list_failed({"accessList": [], "gasUsed": "0xf4240"})


def test_execution_error_inside_a_successful_result_is_a_failure():
    # geth reports a failed simulation in the result body, not as a JSON-RPC
    # error, so the transport hands it back as an ordinary dict.
    assert _access_list_failed({"accessList": [], "error": "out of gas"})
    assert "out of gas" in _access_list_error({"accessList": [], "error": "out of gas"})


def test_transport_errors_and_junk_are_failures():
    assert _access_list_failed(RuntimeError("header not found"))
    assert "header not found" in _access_list_error(RuntimeError("header not found"))
    assert _access_list_failed(None)
    assert _access_list_failed("0x")
