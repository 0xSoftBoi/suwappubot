#!/usr/bin/env python3
"""
Request testnet ETH from the Coinbase CDP Faucet API (Base Sepolia).

Credentials are read from env (never hardcoded):
    CDP_API_KEY_ID      — UUID key id
    CDP_API_KEY_SECRET  — base64 Ed25519 secret (32-byte seed + 32-byte pubkey)

Usage:
    CDP_API_KEY_ID=... CDP_API_KEY_SECRET=... \
      python3 scripts/cdp_faucet.py <address> [--token eth] [--target 0.006]
"""

import os
import sys
import time
import base64
import argparse
import secrets as pysecrets

import jwt  # PyJWT
import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from web3 import Web3

CDP_HOST = "api.cdp.coinbase.com"
FAUCET_PATH = "/platform/v2/evm/faucet"
RPC_URL = "https://sepolia.base.org"


def build_jwt(key_id: str, key_secret: str, method: str, path: str) -> str:
    """Build a 2-minute Ed25519 Bearer JWT for the CDP API."""
    decoded = base64.b64decode(key_secret)
    seed = decoded[:32]  # Ed25519 private seed
    private_key = Ed25519PrivateKey.from_private_bytes(seed)

    now = int(time.time())
    uri = f"{method} {CDP_HOST}{path}"
    payload = {
        "sub": key_id,
        "iss": "cdp",
        "nbf": now,
        "exp": now + 120,
        "uris": [uri],  # CDP expects an array; omitted only for websockets
    }
    headers = {
        "kid": key_id,
        "nonce": pysecrets.token_hex(8),  # 16 hex chars
        "typ": "JWT",
        "alg": "EdDSA",
    }
    return jwt.encode(payload, private_key, algorithm="EdDSA", headers=headers)


def request_faucet(key_id: str, key_secret: str, address: str, token: str) -> dict:
    """Make a single faucet request. Returns the JSON response."""
    token_jwt = build_jwt(key_id, key_secret, "POST", FAUCET_PATH)
    resp = requests.post(
        f"https://{CDP_HOST}{FAUCET_PATH}",
        headers={
            "Authorization": f"Bearer {token_jwt}",
            "Content-Type": "application/json",
        },
        json={"network": "base-sepolia", "address": address, "token": token},
        timeout=30,
    )
    try:
        body = resp.json() if resp.content else {}
    except Exception:
        body = {"raw": resp.text[:500]}
    return {"status": resp.status_code, "body": body}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("address")
    parser.add_argument("--token", default="eth")
    parser.add_argument("--target", type=float, default=0.006, help="Target ETH balance")
    parser.add_argument("--max-requests", type=int, default=8)
    args = parser.parse_args()

    key_id = os.environ.get("CDP_API_KEY_ID")
    key_secret = os.environ.get("CDP_API_KEY_SECRET")
    if not key_id or not key_secret:
        print("ERROR: set CDP_API_KEY_ID and CDP_API_KEY_SECRET env vars", file=sys.stderr)
        sys.exit(1)

    address = Web3.to_checksum_address(args.address)
    w3 = Web3(Web3.HTTPProvider(RPC_URL))

    def balance_eth() -> float:
        return float(w3.from_wei(w3.eth.get_balance(address), "ether"))

    print(f"Address: {address}")
    print(f"Starting balance: {balance_eth():.6f} ETH")
    print(f"Target: {args.target} ETH\n")

    for i in range(1, args.max_requests + 1):
        bal = balance_eth()
        if bal >= args.target:
            print(f"✓ Target reached: {bal:.6f} ETH")
            return

        print(f"[{i}/{args.max_requests}] Requesting {args.token} from CDP faucet...")
        result = request_faucet(key_id, key_secret, address, args.token)

        if result["status"] == 200:
            tx = result["body"].get("transactionHash", "?")
            print(f"  ✓ Faucet tx: {tx}")
            # Wait for the tx to land
            try:
                w3.eth.wait_for_transaction_receipt(tx, timeout=60)
            except Exception:
                time.sleep(8)  # fallback wait
        elif result["status"] == 429:
            print(f"  Rate limited. Waiting 20s... ({result['body']})")
            time.sleep(20)
        else:
            print(f"  Faucet error {result['status']}: {result['body']}")
            # Some errors are transient; brief pause then retry
            time.sleep(5)

    final = balance_eth()
    print(f"\nFinal balance: {final:.6f} ETH")
    if final < args.target:
        print(f"WARNING: below target {args.target}. May need manual top-up.")
        sys.exit(1)


if __name__ == "__main__":
    main()
