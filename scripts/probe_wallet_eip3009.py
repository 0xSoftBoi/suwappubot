#!/usr/bin/env python3
"""Probe whether a wallet will sign the EIP-3009 authorization a mint needs.

The whole USDG mint path rests on one unverified assumption: that Robinhood
Wallet will sign an `eth_signTypedData_v4` ReceiveWithAuthorization request. That
tap needs a human and a phone. This script removes every OTHER variable, so when
someone does tap, a failure is unambiguously the wallet and not our payload.

    # 1. print the exact JSON-RPC payload to hand the wallet
    python3 scripts/probe_wallet_eip3009.py emit --payer 0xYourWalletAddress

    # 2. paste back what the wallet returned
    python3 scripts/probe_wallet_eip3009.py verify --payer 0x... --signature 0x...

`verify` recovers the signer locally and tells you whether USDG would accept it.
"""

import argparse
import json
import sys

from eth_abi import encode
from eth_utils import keccak

# Live mainnet USDG. name()="Global Dollar", version() REVERTS, decimals()=6 —
# all read from chain 4663. The domain below is not a guess: it reproduces the
# on-chain DOMAIN_SEPARATOR exactly (see tests/test_usdg_domain.py).
USDG_MAINNET = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
USDG_DOMAIN_SEPARATOR_4663 = "0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036"
DOMAIN_NAME = "Global Dollar"
DOMAIN_VERSION = "1"

RECEIVE_TYPEHASH = keccak(
    text="ReceiveWithAuthorization(address from,address to,uint256 value,"
    "uint256 validAfter,uint256 validBefore,bytes32 nonce)"
)
DOMAIN_TYPEHASH = keccak(
    text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
)


def domain_separator(chain_id: int, usdg: str) -> bytes:
    return keccak(
        encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                DOMAIN_TYPEHASH,
                keccak(text=DOMAIN_NAME),
                keccak(text=DOMAIN_VERSION),
                chain_id,
                usdg,
            ],
        )
    )


def typed_data(chain_id, usdg, payer, collection, value, valid_after, valid_before, nonce):
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "ReceiveWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "ReceiveWithAuthorization",
        "domain": {
            "name": DOMAIN_NAME,
            "version": DOMAIN_VERSION,
            "chainId": chain_id,
            "verifyingContract": usdg,
        },
        "message": {
            "from": payer,
            "to": collection,
            "value": str(value),
            "validAfter": "0",
            "validBefore": str(valid_before),
            "nonce": "0x" + nonce.hex() if isinstance(nonce, bytes) else nonce,
        },
    }


def _args():
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["emit", "verify"])
    p.add_argument("--payer", required=True)
    p.add_argument("--collection", default="0x" + "11" * 20, help="SuwappuPositions address")
    p.add_argument("--usdg", default=USDG_MAINNET)
    p.add_argument("--chain-id", type=int, default=4663)
    p.add_argument("--cents", type=int, default=2000, help="phase price in USD cents")
    p.add_argument("--quantity", type=int, default=1)
    p.add_argument("--valid-before", type=int, default=4102444800)  # 2100-01-01
    p.add_argument("--signature")
    return p.parse_args()


def main():
    a = _args()
    value = a.cents * a.quantity * 10**4  # USDG is 6dp, so a cent is 1e4
    # A deterministic probe nonce, so emit and verify agree without a state file.
    nonce = keccak(text=f"SUWAPPU_PROBE:{a.payer}:{a.cents}:{a.quantity}")
    td = typed_data(a.chain_id, a.usdg, a.payer, a.collection, value, 0, a.valid_before, nonce)

    if a.chain_id == 4663:
        computed = "0x" + domain_separator(a.chain_id, a.usdg).hex()
        if computed != USDG_DOMAIN_SEPARATOR_4663:
            print(
                f"REFUSING: domain separator {computed} != on-chain "
                f"{USDG_DOMAIN_SEPARATOR_4663}",
                file=sys.stderr,
            )
            return 2

    if a.mode == "emit":
        print("Hand this to the wallet as eth_signTypedData_v4.")
        print(f'Params: ["{a.payer}", <the JSON below, as a STRING>]\n')
        print(json.dumps(td, indent=2))
        print(f"\nValue is {value} USDG base units = ${value / 1e6:.2f}")
        print("Expect: the wallet shows a signing prompt, NOT a transaction.")
        return 0

    if not a.signature:
        print("--signature is required for verify", file=sys.stderr)
        return 2

    from eth_account import Account
    from eth_account.messages import encode_typed_data

    recovered = Account.recover_message(encode_typed_data(full_message=td), signature=a.signature)
    ok = recovered.lower() == a.payer.lower()
    print(f"recovered: {recovered}")
    print(f"expected : {a.payer}")
    print(
        "RESULT   :",
        (
            "PASS — the wallet signs EIP-3009. The mint flow works."
            if ok
            else "FAIL — signature does not recover to the payer."
        ),
    )
    if not ok:
        print(
            "\nIf the wallet REFUSED to sign at all, that is the finding: it "
            "restricts typed data, and the mint needs a different rail."
        )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
