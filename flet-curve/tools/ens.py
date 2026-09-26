"""What a name points at, read from Ethereum rather than from a gateway.

A gateway will happily serve the CID it resolved some minutes ago, so
"has the name moved?" cannot be answered by asking one. The registry can
answer it: `curve.eth` -> resolver -> `contenthash` -> the CID itself.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from wallet.erc20 import keccak256

#: The ENS registry. One address, every network it is deployed on.
REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"

#: `resolver(bytes32)` and `contenthash(bytes32)`.
RESOLVER_SELECTOR = "0x0178b8bf"
CONTENTHASH_SELECTOR = "0xbc1c58d1"

#: Public Ethereum endpoints, tried in order. One eth_call each, twice per
#: run: no key, no account, nothing worth a dependency.
ETH_RPCS = (
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
)

RPC_TIMEOUT = 20.0

#: `ipfs-ns`, as a varint, which is what a contenthash starts with before
#: the CID itself.
IPFS_NS = b"\xe3\x01"


class EnsError(Exception):
    """The name could not be read."""


def namehash(name: str) -> bytes:
    """EIP-137: the recursive hash a registry is keyed by.

    On `wallet.erc20.keccak256`, which the app carries in pure Python
    because Pyodide has no wheel for one.
    """
    node = b"\x00" * 32
    if name:
        for label in reversed(name.split(".")):
            node = keccak256(node + keccak256(label.encode()))
    return node


def cid_from_contenthash(raw: bytes) -> str:
    """The base32 CIDv1 inside an `ipfs-ns` contenthash.

    Empty for anything else -- an IPNS name, a Swarm hash, or a name with
    no contenthash set at all, none of which this can warm.
    """
    if not raw.startswith(IPFS_NS):
        return ""
    cid = raw[len(IPFS_NS) :]
    if not cid:
        return ""
    return "b" + base64.b32encode(cid).decode().rstrip("=").lower()


def _call(client, rpc: str, to: str, data: str) -> str:
    """One `eth_call`, returning the hex result."""
    response = client.post(
        rpc,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": to, "data": data}, "latest"],
        },
        timeout=RPC_TIMEOUT,
        headers={"content-type": "application/json"},
    )
    payload = response.json()
    if "error" in payload:
        raise EnsError(str(payload["error"].get("message") or payload["error"]))
    result = payload.get("result")
    if not isinstance(result, str) or not result.startswith("0x"):
        raise EnsError(f"{rpc} answered {json.dumps(payload)[:120]}")
    return result


def _address(word: str) -> str:
    """The address in an ABI word."""
    return "0x" + word[-40:]


def _bytes(result: str) -> bytes:
    """The `bytes` return value of a call, out of its ABI encoding."""
    body = bytes.fromhex(result[2:])
    if len(body) < 64:
        return b""
    length = int.from_bytes(body[32:64], "big")
    return body[64 : 64 + length]


def contenthash(name: str, *, client=None, rpcs: tuple[str, ...] = ETH_RPCS) -> str:
    """The CID `name` points at, straight from the registry.

    Every endpoint failing raises; one answering with an empty resolver or
    an empty contenthash returns "", which is a name that has never been
    pointed at anything rather than a network problem.
    """
    import httpx

    owned = client is None
    client = client or httpx.Client(follow_redirects=True)
    node = namehash(name).hex()
    failures: list[str] = []
    try:
        for rpc in rpcs:
            try:
                resolver = _address(_call(client, rpc, REGISTRY, RESOLVER_SELECTOR + node))
                if int(resolver, 16) == 0:
                    return ""
                raw = _bytes(_call(client, rpc, resolver, CONTENTHASH_SELECTOR + node))
                return cid_from_contenthash(raw)
            except (EnsError, httpx.HTTPError) as exc:
                failures.append(f"{rpc}: {exc}")
    finally:
        if owned:
            client.close()
    raise EnsError("no Ethereum endpoint answered:\n  " + "\n  ".join(failures))


def name_behind(host: str) -> str:
    """`https://curve.eth.limo` -> `curve.eth`. Empty for anything that is
    not an ENS gateway, which is then nothing to look up.
    """
    host = host.rsplit("//", maxsplit=1)[-1].split("/", maxsplit=1)[0].lower()
    for suffix in (".limo", ".link", ".sucks"):
        if host.endswith(".eth" + suffix):
            return host[: -len(suffix)]
    return ""
