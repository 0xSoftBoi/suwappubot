"""ERC-20 call encoding, ABI decoding and EIP-55 checksums -- no dependencies."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, localcontext

# -- keccak-256 ------------------------------------------------------------
# Note this is original Keccak padding (0x01), not SHA-3's (0x06);
# hashlib.sha3_256 is a *different* hash and cannot be substituted here.

_MASK = (1 << 64) - 1

_ROUND_CONSTANTS = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)

# _ROTATIONS[x][y] -- rho offsets.
_ROTATIONS = (
    (0, 36, 3, 41, 18),
    (1, 44, 10, 45, 2),
    (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56),
    (27, 20, 39, 8, 14),
)

_RATE = 136  # bytes absorbed per permutation for keccak-256


def _rotl(value: int, shift: int) -> int:
    return ((value << shift) | (value >> (64 - shift))) & _MASK if shift else value


def _keccak_f(a: list[list[int]]) -> None:
    for rc in _ROUND_CONSTANTS:
        c = [a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rotl(c[(x + 1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x][y] ^= d[x]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rotl(a[x][y], _ROTATIONS[x][y])
        for x in range(5):
            for y in range(5):
                a[x][y] = b[x][y] ^ (~b[(x + 1) % 5][y] & _MASK & b[(x + 2) % 5][y])
        a[0][0] ^= rc


def keccak256(data: bytes) -> bytes:
    """Ethereum's keccak-256."""
    state = [[0] * 5 for _ in range(5)]
    padded = bytearray(data)
    padded.append(0x01)
    while len(padded) % _RATE != 0:
        padded.append(0x00)
    padded[-1] |= 0x80

    for offset in range(0, len(padded), _RATE):
        block = padded[offset : offset + _RATE]
        for i in range(_RATE // 8):
            lane = int.from_bytes(block[i * 8 : i * 8 + 8], "little")
            state[i % 5][i // 5] ^= lane
        _keccak_f(state)

    out = bytearray()
    for i in range(4):  # 32 bytes = 4 lanes off the top of the state
        out += state[i % 5][i // 5].to_bytes(8, "little")
    return bytes(out)


# -- addresses -------------------------------------------------------------

ZERO_ADDRESS = "0x" + "00" * 20


def is_address(value: str) -> bool:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) != 42:
        return False
    try:
        int(value, 16)
    except ValueError:
        return False
    return True


def to_checksum_address(value: str) -> str:
    """EIP-55 mixed-case form. Assumes `is_address(value)` already passed."""
    body = value[2:].lower()
    digest = keccak256(body.encode()).hex()
    return "0x" + "".join(
        ch.upper() if ch.isalpha() and int(digest[i], 16) >= 8 else ch
        for i, ch in enumerate(body)
    )


def is_checksum_address(value: str) -> bool:
    """True if the address carries a *valid* EIP-55 checksum."""
    return is_address(value) and value == to_checksum_address(value)


def has_checksum_case(value: str) -> bool:
    body = value[2:]
    return body != body.lower() and body != body.upper()


# -- ABI -------------------------------------------------------------------

# Hard-coded 4-byte selectors: keccak256("transfer(address,uint256)")[:4] etc.
SELECTOR_TRANSFER = "a9059cbb"
SELECTOR_BALANCE_OF = "70a08231"
SELECTOR_DECIMALS = "313ce567"
SELECTOR_SYMBOL = "95d89b41"
SELECTOR_NAME = "06fdde03"


def _encode_address(value: str) -> str:
    return value[2:].lower().rjust(64, "0")


def _encode_uint(value: int) -> str:
    if value < 0 or value >= 1 << 256:
        raise ValueError("uint256 out of range")
    return f"{value:064x}"


def encode_transfer(to: str, amount: int) -> str:
    """calldata for `transfer(address,uint256)`."""
    return "0x" + SELECTOR_TRANSFER + _encode_address(to) + _encode_uint(amount)


def encode_balance_of(owner: str) -> str:
    return "0x" + SELECTOR_BALANCE_OF + _encode_address(owner)


def encode_decimals() -> str:
    return "0x" + SELECTOR_DECIMALS


def encode_symbol() -> str:
    return "0x" + SELECTOR_SYMBOL


def encode_name() -> str:
    return "0x" + SELECTOR_NAME


def decode_uint(data: str) -> int:
    """Decode a single uint256 return value. Empty return data means 0."""
    raw = data[2:] if data.startswith("0x") else data
    return int(raw[:64], 16) if raw else 0


def decode_string(data: str) -> str:
    """Decode a string return value, tolerating the bytes32 variant."""
    raw = data[2:] if data.startswith("0x") else data
    if not raw:
        return ""
    blob = bytes.fromhex(raw)
    if len(blob) == 32:  # bytes32: no offset header could fit
        return blob.rstrip(b"\x00").decode("utf-8", "replace")
    if len(blob) < 64:
        return blob.rstrip(b"\x00").decode("utf-8", "replace")
    offset = int.from_bytes(blob[:32], "big")
    if offset + 32 > len(blob):
        return blob[:32].rstrip(b"\x00").decode("utf-8", "replace")
    length = int.from_bytes(blob[offset : offset + 32], "big")
    body = blob[offset + 32 : offset + 32 + length]
    return body.decode("utf-8", "replace")


# -- amounts ---------------------------------------------------------------


#: A comma that can only be a thousands separator: groups of exactly three,
#: after one to three digits. `1,000` passes and `1,5` does not, which is
#: the point -- stripping every comma turned a European `1,5` into fifteen
#: tokens, silently, on the way to a signature.
_GROUPED = re.compile(r"^\d{1,3}(,\d{3})+$")

#: The largest number of digits worth scaling. `uint256` tops out a little
#: past 1e77, so anything above this cannot be a token amount, and refusing
#: it early keeps `int()` away from a Decimal with a billion digits.
_MAX_DIGITS = 78


def parse_units(value: str, decimals: int) -> int:
    """Human amount ("1.5") -> smallest units. Never touches float."""
    text = (value or "").strip()
    if not text:
        raise ValueError("Enter an amount")
    whole, dot, fraction = text.partition(".")
    if "," in fraction:
        raise ValueError("Use a dot for the decimal point")
    if "," in whole:
        if not _GROUPED.match(whole):
            raise ValueError("Use a dot for the decimal point")
        whole = whole.replace(",", "")
    try:
        amount = Decimal(whole + dot + fraction)
    except (InvalidOperation, ValueError):
        raise ValueError(f"'{value}' is not a number") from None
    # Before the comparison below, not after: `Decimal("nan") < 0` raises
    # `InvalidOperation`, which is not a `ValueError` and so went straight
    # past every caller's guard and killed the task holding the panel.
    if not amount.is_finite():
        raise ValueError(f"'{value}' is not a number")
    if amount < 0:
        raise ValueError("Amount cannot be negative")
    if amount.adjusted() >= _MAX_DIGITS:
        raise ValueError("Amount is too large")
    # A local context, because the default one is 28 significant digits and
    # these are not significant figures, they are wei. A balance of 100
    # billion tokens at 18 decimals is 29 digits, so MAX rounded it *up* by
    # one unit -- past the balance, into a revert.
    with localcontext() as context:
        context.prec = len(amount.as_tuple().digits) + decimals + 10
        scaled = amount * (Decimal(10) ** decimals)
    if scaled != scaled.to_integral_value():
        raise ValueError(f"Too many decimal places (max {decimals})")
    return int(scaled)


def format_units(value: int, decimals: int, precision: int = 6) -> str:
    """Smallest units -> a short human string, trailing zeros trimmed.

    The same local context as `parse_units`, and for the same reason: at
    the default 28 significant digits a balance of 100 billion tokens came
    back as a *larger* round number than it is, so MAX filled the field
    with more than the wallet held.
    """
    if decimals == 0:
        return str(value)
    with localcontext() as context:
        context.prec = len(str(abs(value))) + decimals + 10
        quantised = Decimal(value) / (Decimal(10) ** decimals)
        text = f"{quantised:.{precision}f}"
    return text.rstrip("0").rstrip(".") or "0"
