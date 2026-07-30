#!/usr/bin/env python3.12
"""Verify hardcoded cross-chain constants against the actual chains.

Contract addresses, CCTP domain IDs and LayerZero EIDs are copied from docs
into source, and a wrong one moves user funds to the wrong place. Unit tests
cannot catch that — they assert against the same constants. This script is the
only thing that checks them against reality.

It is read-only: `eth_getCode`, `eth_call` on view functions, and one fetch of
LayerZero's public metadata. No keys, no transactions, no writes.

    python3.12 scripts/verify_onchain_constants.py            # all checks
    python3.12 scripts/verify_onchain_constants.py --cctp     # CCTP only
    python3.12 scripts/verify_onchain_constants.py --usdt0    # USDT0 only

Exit code is non-zero if any constant disagrees with the chain, so this can
gate a release.

Note on RPC choice: endpoints are public and free, so they rate-limit and
occasionally fail a method outright. cloudflare-eth.com, for example, returns
an internal error for `eth_getCode` on *every* address — which reads exactly
like "contract not deployed" and nearly produced a false bug report. Hence
`_probe_liveness()`: each endpoint must prove it can answer before any
"ABSENT" verdict is trusted.
"""

import argparse
import json
import sys
import urllib.request

from web3 import Web3

TIMEOUT = 25
HEADERS = {"Content-Type": "application/json", "User-Agent": "curl/8.5.0"}

# --- CCTP v2 (Circle) -------------------------------------------------------
# Same address on every EVM domain; asserted below rather than assumed.
TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d"
MESSAGE_TRANSMITTER_V2 = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64"

# chain -> (rpc, expected CCTP domain id)
CCTP_CHAINS = {
    "ethereum": ("https://ethereum-rpc.publicnode.com", 0),
    "avalanche": ("https://avalanche-c-chain-rpc.publicnode.com", 1),
    "optimism": ("https://optimism-rpc.publicnode.com", 2),
    "arbitrum": ("https://arbitrum-one-rpc.publicnode.com", 3),
    "base": ("https://base-rpc.publicnode.com", 6),
    "polygon": ("https://polygon-bor-rpc.publicnode.com", 7),
    # cctp_hypercore.py's HYPEREVM_CCTP_DOMAIN.
    "hyperevm": ("https://rpc.hyperliquid.xyz/evm", 19),
}

# --- USDT0 (LayerZero OFT canonical USDT) ----------------------------------
# chain -> (rpc, token, oft, layerzero eid, approvalRequired)
# `oft` is the send/quoteSend target. The token is a plain ERC-20 and does NOT
# expose send/quoteSend — calling it would fail. approvalRequired distinguishes
# the satellite mint/burn OFTs (0, no ERC20 approve) from Ethereum's lockbox
# (1, approve required because it locks real Tether USDT).
USDT0_CHAINS = {
    "arbitrum": (
        "https://arbitrum-one-rpc.publicnode.com",
        "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92",
        30110,
        0,
    ),
    "plasma": (
        "https://rpc.plasma.to",
        "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
        "0x02ca37966753bDdDf11216B73B16C1dE756A7CF9",
        30383,
        0,
    ),
    "hyperevm": (
        "https://rpc.hyperliquid.xyz/evm",
        "0xB8CE59FC3717ada4c02eaDF9682a9e934F625ebb",
        "0x904861a24F30EC96ea7CFC3bE9EA4B476d237e98",
        30367,
        0,
    ),
    "ink": (
        "https://rpc-gel.inkonchain.com",
        "0x0200C29006150606B650577BBE7B6248F58470c1",
        "0x1cB6De532588fCA4a21B7209DE7C456AF8434A65",
        30339,
        0,
    ),
    "unichain": (
        "https://mainnet.unichain.org",
        "0x9151434b16b9763660705744891fA906F660EcC5",
        "0xc07bE8994D035631c36fb4a89C918CeFB2f03EC3",
        30320,
        0,
    ),
    "berachain": (
        "https://rpc.berachain.com",
        "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
        "0x3Dc96399109df5ceb2C226664A086140bD0379cB",
        30362,
        0,
    ),
    "flare": (
        "https://flare-api.flare.network/ext/C/rpc",
        "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
        "0x567287d2A9829215a37e3B88843d32f9221E7588",
        30295,
        0,
    ),
    # Lockbox: locks canonical Tether USDT rather than minting.
    "ethereum": (
        "https://ethereum-rpc.publicnode.com",
        "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee",
        30101,
        1,
    ),
}

LZ_METADATA_URL = "https://metadata.layerzero-api.com/v1/metadata"


def _selector(signature: str) -> str:
    return "0x" + Web3.keccak(text=signature)[:4].hex()


SEL = {
    name: _selector(f"{name}()")
    for name in (
        "localMessageTransmitter",
        "localDomain",
        "token",
        "decimals",
        "approvalRequired",
    )
}


class RpcError(RuntimeError):
    pass


def rpc(url: str, method: str, params: list):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    request = urllib.request.Request(url, data=payload.encode(), headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        body = json.loads(response.read())
    if body.get("error"):
        raise RpcError(body["error"].get("message", "unknown rpc error"))
    return body.get("result")


def _probe_liveness(url: str) -> None:
    """Prove the endpoint answers eth_getCode before trusting any ABSENT verdict.

    Probes a known-deployed address (the CCTP transmitter). An endpoint that
    errors here is broken for our purposes, which is different from — and must
    not be reported as — a missing contract.
    """
    code = rpc(url, "eth_getCode", [MESSAGE_TRANSMITTER_V2, "latest"])
    if not isinstance(code, str):
        raise RpcError("eth_getCode returned a non-string; endpoint unusable")


def _has_code(url: str, address: str) -> bool:
    code = rpc(url, "eth_getCode", [address, "latest"])
    return bool(code) and code != "0x"


def _call_address(url: str, address: str, selector: str) -> str | None:
    result = rpc(url, "eth_call", [{"to": address, "data": selector}, "latest"])
    if not result or len(result) < 42:
        return None
    return "0x" + result[-40:]


def _call_int(url: str, address: str, selector: str) -> int | None:
    result = rpc(url, "eth_call", [{"to": address, "data": selector}, "latest"])
    if not result or result == "0x":
        return None
    return int(result, 16)


def verify_cctp() -> list[str]:
    """TokenMessengerV2/MessageTransmitterV2 deployment + domain ids."""
    failures: list[str] = []
    print("== CCTP v2 ==")
    for chain, (url, expected_domain) in CCTP_CHAINS.items():
        try:
            _probe_liveness(url)

            if not _has_code(url, TOKEN_MESSENGER_V2):
                failures.append(f"cctp/{chain}: TokenMessengerV2 has no code")
                print(f"  {chain:10} FAIL TokenMessengerV2 absent")
                continue
            if not _has_code(url, MESSAGE_TRANSMITTER_V2):
                failures.append(f"cctp/{chain}: MessageTransmitterV2 has no code")
                print(f"  {chain:10} FAIL MessageTransmitterV2 absent")
                continue

            # Strongest cross-check: the messenger names its own transmitter.
            linked = _call_address(url, TOKEN_MESSENGER_V2, SEL["localMessageTransmitter"])
            if not linked or linked.lower() != MESSAGE_TRANSMITTER_V2.lower():
                failures.append(
                    f"cctp/{chain}: localMessageTransmitter()={linked} "
                    f"expected {MESSAGE_TRANSMITTER_V2}"
                )
                print(f"  {chain:10} FAIL transmitter link {linked}")
                continue

            domain = _call_int(url, MESSAGE_TRANSMITTER_V2, SEL["localDomain"])
            if domain != expected_domain:
                failures.append(f"cctp/{chain}: localDomain()={domain} expected {expected_domain}")
                print(f"  {chain:10} FAIL domain {domain} != {expected_domain}")
                continue

            print(f"  {chain:10} OK   domain={domain} transmitter linked")
        except Exception as exc:  # noqa: BLE001 - report, never abort the sweep
            failures.append(f"cctp/{chain}: {type(exc).__name__}: {exc}")
            print(f"  {chain:10} ERROR {type(exc).__name__}: {str(exc)[:60]}")
    return failures


def verify_usdt0() -> list[str]:
    """USDT0 token/OFT pairing, decimals, and the approve asymmetry."""
    failures: list[str] = []
    print("== USDT0 (LayerZero OFT) ==")
    for chain, (url, token, oft, _eid, expected_approval) in USDT0_CHAINS.items():
        try:
            rpc(url, "eth_chainId", [])

            if not _has_code(url, oft):
                failures.append(f"usdt0/{chain}: OFT has no code")
                print(f"  {chain:10} FAIL OFT absent")
                continue

            # The pairing check that matters: the OFT must name this token.
            # Without it we could be pointing send() at an unrelated contract.
            linked = _call_address(url, oft, SEL["token"])
            if not linked or linked.lower() != token.lower():
                failures.append(f"usdt0/{chain}: OFT.token()={linked} expected {token}")
                print(f"  {chain:10} FAIL OFT.token() {linked}")
                continue

            decimals = _call_int(url, token, SEL["decimals"])
            if decimals != 6:
                failures.append(f"usdt0/{chain}: decimals={decimals} expected 6")
                print(f"  {chain:10} FAIL decimals {decimals}")
                continue

            approval = _call_int(url, oft, SEL["approvalRequired"])
            if approval != expected_approval:
                failures.append(
                    f"usdt0/{chain}: approvalRequired()={approval} " f"expected {expected_approval}"
                )
                print(f"  {chain:10} FAIL approvalRequired {approval}")
                continue

            kind = "lockbox (approve required)" if approval else "native OFT"
            print(f"  {chain:10} OK   decimals=6 {kind}")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"usdt0/{chain}: {type(exc).__name__}: {exc}")
            print(f"  {chain:10} ERROR {type(exc).__name__}: {str(exc)[:60]}")
    return failures


def verify_layerzero_eids() -> list[str]:
    """LayerZero endpoint ids, against LayerZero's own metadata."""
    failures: list[str] = []
    print("== LayerZero EIDs ==")
    try:
        request = urllib.request.Request(LZ_METADATA_URL, headers={"User-Agent": "curl/8.5.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            metadata = json.loads(response.read())
    except Exception as exc:  # noqa: BLE001
        print(f"  metadata fetch failed: {type(exc).__name__}: {str(exc)[:60]}")
        return [f"layerzero: metadata unreachable ({type(exc).__name__})"]

    by_eid: dict[int, set[str]] = {}
    for key, entry in metadata.items():
        for deployment in (entry or {}).get("deployments") or []:
            eid = deployment.get("eid")
            if eid is not None:
                by_eid.setdefault(int(eid), set()).add(key)

    for chain, (_url, _token, _oft, eid, _approval) in USDT0_CHAINS.items():
        keys = by_eid.get(eid)
        if not keys:
            failures.append(f"layerzero/{chain}: eid {eid} not present in metadata")
            print(f"  {chain:10} FAIL eid={eid} unknown to LayerZero")
            continue
        print(f"  {chain:10} OK   eid={eid} -> {sorted(keys)[0]}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cctp", action="store_true", help="verify CCTP constants only")
    parser.add_argument("--usdt0", action="store_true", help="verify USDT0 constants only")
    args = parser.parse_args()

    run_all = not (args.cctp or args.usdt0)
    failures: list[str] = []

    if run_all or args.cctp:
        failures += verify_cctp()
        print()
    if run_all or args.usdt0:
        failures += verify_usdt0()
        print()
        failures += verify_layerzero_eids()
        print()

    if failures:
        print(f"FAILED ({len(failures)}):")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("All on-chain constants verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
