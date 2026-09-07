"""An access list may name an account and no slots -- as `null`, not `[]`.

Both spellings are valid, and which one arrives depends on the backend.  The
parse assumed a list, so `null` raised `'NoneType' object is not iterable` and
took the whole warm with it -- surfacing as a warm that failed once and
succeeded on retry, which reads like a flaky endpoint and is not.

An account with no storage keys is not an empty answer: its *code* and balance
still have to be loaded, which is exactly what a token or vault needs.
"""

from __future__ import annotations

from erouter.dev.local_evm import LocalEvm


def _touched(answers):
    """The account -> slots map `_warm_by_proof` builds from access lists."""
    touched: dict[str, set[int]] = {}
    for answer in answers:
        for entry in answer.get("accessList") or []:
            touched.setdefault(entry["address"].lower(), set()).update(
                int(k, 16) for k in entry.get("storageKeys") or ())
    return touched


def test_null_storage_keys_names_the_account_with_no_slots():
    got = _touched([{"accessList": [{"address": "0xAA", "storageKeys": None}]}])
    assert got == {"0xaa": set()}, "the account must still be loaded"


def test_an_empty_list_means_the_same_thing():
    got = _touched([{"accessList": [{"address": "0xAA", "storageKeys": []}]}])
    assert got == {"0xaa": set()}


def test_a_null_access_list_is_not_an_error():
    assert _touched([{"accessList": None}]) == {}


def test_slots_still_arrive_when_they_are_there():
    got = _touched([{"accessList": [
        {"address": "0xAA", "storageKeys": ["0x02", "0x05"]},
        {"address": "0xBB", "storageKeys": None},
    ]}])
    assert got == {"0xaa": {2, 5}, "0xbb": set()}


def test_the_parse_matches_what_the_warm_does():
    """Pin the shape, so the two cannot drift apart."""
    import inspect

    source = inspect.getsource(LocalEvm._warm_by_proof)
    assert 'entry.get("storageKeys") or ()' in source
    assert 'answer.get("accessList") or []' in source
