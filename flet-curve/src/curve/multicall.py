"""Asking a chain several questions in one round trip."""

from __future__ import annotations

from .abi import _address, _bool, _offset, _uint, decode_uint, selector

#: Same address on every chain that has it.
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

#: `aggregate3` rather than `aggregate`: it allows a call to fail without
#: reverting the batch, and half the calls here are expected to fail.
AGGREGATE3 = "aggregate3((address,bool,bytes)[])"


def _bytes_tail(data: str) -> str:
    """A `bytes` value: length in bytes, then the data padded to a word."""
    body = data[2:] if data.startswith("0x") else data
    if len(body) % 2:
        raise ValueError("odd-length calldata")
    padding = (-len(body)) % 64
    return _uint(len(body) // 2) + body + "0" * padding


def encode_aggregate3(
    calls: list[tuple[str, str]], *, allow_failure: bool = True
) -> str:
    """Calldata for `aggregate3`, from `(target, calldata)` pairs."""
    elements = [
        _address(target) + _bool(allow_failure) + _offset(3) + _bytes_tail(data)
        for target, data in calls
    ]
    heads: list[str] = []
    position = len(elements) * 32
    for element in elements:
        heads.append(_uint(position))
        position += len(element) // 2
    return (
        "0x"
        + selector(AGGREGATE3)
        + _offset(1)  # the one argument is dynamic: point past this word
        + _uint(len(elements))
        + "".join(heads)
        + "".join(elements)
    )


def decode_aggregate3(result: str) -> list[str | None]:
    """`(bool success, bytes returnData)[]` -> the data, or None per call."""
    body = (result or "")[2:] if (result or "").startswith("0x") else (result or "")
    words = [body[i : i + 64] for i in range(0, len(body), 64)]
    if len(words) < 2:
        return []
    try:
        array_at = int(words[0], 16) // 32
        count = int(words[array_at], 16)
    except (ValueError, IndexError, OverflowError):
        return []
    if count > len(words):
        return []
    base = array_at + 1
    if count == 0 or len(words) < base + count:
        return []

    answers: list[str | None] = []
    for index in range(count):
        try:
            element = base + int(words[base + index], 16) // 32
            success = int(words[element], 16) == 1
            data_at = element + int(words[element + 1], 16) // 32
            length = int(words[data_at], 16)
        except (ValueError, IndexError):
            answers.append(None)
            continue
        if not success or length == 0:
            answers.append(None)
            continue
        chunk = "".join(words[data_at + 1 :])[: length * 2]
        answers.append("0x" + chunk)
    return answers


def decode_uints(result: str, count: int) -> list[int | None]:
    """The common case: every call returns one `uint256`, or nothing."""
    answers = decode_aggregate3(result)
    if len(answers) != count:
        return [None] * count
    return [decode_uint(answer) if answer else None for answer in answers]
