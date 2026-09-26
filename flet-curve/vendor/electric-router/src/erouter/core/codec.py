"""Minimal ABI encoder/decoder -- stdlib only.

`eth-abi` would do all of this, but it pulls compiled dependencies that make a
Pyodide build impractical (docs, decision 0).  The subset the router needs is
small enough to write and pin down with a differential test:
`tests/test_codec.py` checks every case here against `eth_abi`, a dev-only
dependency.

Supported grammar -- deliberately no more than the quoter's ABI needs:

    uint<N> int<N> address bool bytes string bytes<N>
    (T1,T2,...)          tuples, nested
    T[]  T[k]            dynamic and fixed arrays

Selectors are derived from canonical signature strings at the call site
(`selector("get_dy(int128,int128,uint256)")`) rather than loaded from ABI JSON,
which is what makes the two Curve dialects a one-line difference.
"""

from __future__ import annotations

import functools
from typing import Any

from .keccak import keccak256

WORD = 32


# --------------------------------------------------------------------- types

# A parsed type is a tagged tuple; see the module docstring for the grammar.
Type = tuple


def _split_top(text: str) -> list[str]:
    """Split on commas that are not nested inside brackets or parens."""
    out: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(text):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            out.append(text[start:i])
            start = i + 1
    tail = text[start:]
    if tail or out:
        out.append(tail)
    return [t.strip() for t in out if t.strip() or out]


def parse_type(text: str) -> Type:
    text = text.strip()
    if text.endswith("]"):
        open_at = text.rindex("[")
        inner = parse_type(text[:open_at])
        size = text[open_at + 1 : -1]
        return ("array", inner, int(size) if size else None)
    if text.startswith("(") and text.endswith(")"):
        body = text[1:-1].strip()
        return ("tuple", [parse_type(t) for t in _split_top(body)] if body else [])
    if text == "address":
        return ("address",)
    if text == "bool":
        return ("bool",)
    if text in ("bytes", "string"):
        return (text,)
    if text.startswith("uint"):
        return ("uint", int(text[4:] or 256))
    if text.startswith("int"):
        return ("int", int(text[3:] or 256))
    if text.startswith("bytes"):
        return ("fbytes", int(text[5:]))
    raise ValueError(f"unsupported ABI type: {text!r}")


def is_dynamic(t: Type) -> bool:
    kind = t[0]
    if kind in ("bytes", "string"):
        return True
    if kind == "array":
        return t[2] is None or is_dynamic(t[1])
    if kind == "tuple":
        return any(is_dynamic(x) for x in t[1])
    return False


def head_size(t: Type) -> int:
    """Bytes this type occupies in a head region (32 if it is dynamic)."""
    if is_dynamic(t):
        return WORD
    kind = t[0]
    if kind == "tuple":
        return sum(head_size(x) for x in t[1])
    if kind == "array":
        return t[2] * head_size(t[1])
    return WORD


# ------------------------------------------------------------------ encoding


def _word(value: int) -> bytes:
    """Two's-complement 32-byte big-endian word."""
    return (value & ((1 << 256) - 1)).to_bytes(WORD, "big")


def _enc_value(t: Type, v: Any) -> bytes:
    """Full encoding of one value (what would go in a tail region)."""
    kind = t[0]
    if kind == "uint":
        if not 0 <= v < (1 << t[1]):
            raise ValueError(f"uint{t[1]} out of range: {v}")
        return _word(v)
    if kind == "int":
        bits = t[1]
        if not -(1 << (bits - 1)) <= v < (1 << (bits - 1)):
            raise ValueError(f"int{bits} out of range: {v}")
        return _word(v)
    if kind == "address":
        n = v if isinstance(v, int) else int(str(v), 16)
        return _word(n)
    if kind == "bool":
        return _word(1 if v else 0)
    if kind == "fbytes":
        b = bytes(v)
        if len(b) != t[1]:
            raise ValueError(f"bytes{t[1]} got {len(b)} bytes")
        return b + b"\x00" * (WORD - len(b))
    if kind in ("bytes", "string"):
        b = v.encode() if kind == "string" else bytes(v)
        pad = (-len(b)) % WORD
        return _word(len(b)) + b + b"\x00" * pad
    if kind == "array":
        inner, size = t[1], t[2]
        items = list(v)
        if size is not None and len(items) != size:
            raise ValueError(f"fixed array wants {size} items, got {len(items)}")
        body = encode_tuple([inner] * len(items), items)
        return body if size is not None else _word(len(items)) + body
    if kind == "tuple":
        return encode_tuple(t[1], list(v))
    raise ValueError(f"cannot encode {t}")


def encode_tuple(types: list[Type], values: list[Any]) -> bytes:
    if len(types) != len(values):
        raise ValueError(f"arity mismatch: {len(types)} types, {len(values)} values")
    offset = sum(head_size(t) for t in types)
    heads: list[bytes] = []
    tails: list[bytes] = []
    for t, v in zip(types, values, strict=True):
        if is_dynamic(t):
            tail = _enc_value(t, v)
            heads.append(_word(offset))
            tails.append(tail)
            offset += len(tail)
        else:
            heads.append(_enc_value(t, v))
    return b"".join(heads) + b"".join(tails)


def encode(types: list[str], values: list[Any]) -> bytes:
    return encode_tuple([parse_type(t) for t in types], values)


# ------------------------------------------------------------------ decoding


def _dec_value(t: Type, data: bytes, pos: int) -> Any:
    """Decode one value whose encoding starts at `pos`."""
    kind = t[0]
    if kind == "uint":
        return int.from_bytes(data[pos : pos + WORD], "big")
    if kind == "int":
        n = int.from_bytes(data[pos : pos + WORD], "big")
        return n - (1 << 256) if n >> 255 else n
    if kind == "address":
        return "0x" + data[pos + 12 : pos + WORD].hex()
    if kind == "bool":
        return bool(int.from_bytes(data[pos : pos + WORD], "big"))
    if kind == "fbytes":
        return data[pos : pos + t[1]]
    if kind in ("bytes", "string"):
        n = int.from_bytes(data[pos : pos + WORD], "big")
        raw = data[pos + WORD : pos + WORD + n]
        return raw.decode() if kind == "string" else raw
    if kind == "array":
        inner, size = t[1], t[2]
        if size is None:
            n = int.from_bytes(data[pos : pos + WORD], "big")
            return decode_tuple([inner] * n, data, pos + WORD)
        return decode_tuple([inner] * size, data, pos)
    if kind == "tuple":
        return decode_tuple(t[1], data, pos)
    raise ValueError(f"cannot decode {t}")


def decode_tuple(types: list[Type], data: bytes, base: int = 0) -> list[Any]:
    out: list[Any] = []
    pos = base
    for t in types:
        if is_dynamic(t):
            offset = int.from_bytes(data[pos : pos + WORD], "big")
            out.append(_dec_value(t, data, base + offset))
        else:
            out.append(_dec_value(t, data, pos))
        pos += head_size(t)
    return out


def decode(types: list[str], data: bytes) -> list[Any]:
    return decode_tuple([parse_type(t) for t in types], data, 0)


# ----------------------------------------------------------------- signatures


@functools.cache
def selector(signature: str) -> bytes:
    """First 4 bytes of keccak256 of a canonical signature.

    Cached, because a selector is a property of the signature and `keccak.py` is
    pure Python by design (so `core` imports under Pyodide with nothing but
    numpy) -- one call is ~430 us.  Reading every pool's balances asked for the
    same handful of signatures 2,403 times and spent 1.04 s hashing them, which
    is what made "reading storage" look like it cost a second.
    """
    return keccak256(signature.encode())[:4]


@functools.cache
def _signature_types(signature: str) -> tuple[str, ...]:
    """Parsed once per signature, for the same reason `selector` is cached."""
    body = signature[signature.index("(") + 1 : signature.rindex(")")]
    return tuple(_split_top(body)) if body.strip() else ()


def signature_types(signature: str) -> list[str]:
    """The argument types.  A list, because callers mutate what they get."""
    return list(_signature_types(signature))


def encode_call(signature: str, *values: Any) -> bytes:
    return selector(signature) + encode(signature_types(signature), list(values))


def decode_result(types: list[str], data: bytes) -> list[Any]:
    return decode(types, data)


def decode_uint(data: bytes) -> int:
    """Decode a single uint256 return value.

    Raises on empty data rather than returning 0.  A Curve pool that does not
    implement a function returns *empty* data instead of reverting, and
    `int.from_bytes(b"", "big") == 0` would silently quote every swap at zero.
    """
    if len(data) < WORD:
        raise ValueError(f"expected a 32-byte word, got {len(data)} bytes")
    return int.from_bytes(data[:WORD], "big")
