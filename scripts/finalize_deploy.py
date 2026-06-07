#!/usr/bin/env python3
"""Finalize Suwappu deploy: grant MINTER_ROLE to Staking+Bonds, mint test SUWP.
Sends each tx sequentially, waiting for confirmation before the next (avoids nonce races)."""
import os, sys, time, json
from pathlib import Path
from web3 import Web3
from eth_account import Account

ROOT = Path(__file__).parent.parent
RPC = os.environ["BASE_SEPOLIA_RPC_URL"]
CHAIN_ID = 84532

SUWP = "0xFd3053F4D2fE884eE23ff3C4aBAe50D1f6f3cDa2"
STAKING = "0x5d46653d49242a26A314a0597c0A79E5Af6a6b4d"
BONDS = "0x8450Aa469fC6c6aA64AA8e3fCF9a6D9d329F4d84"

w3 = Web3(Web3.HTTPProvider(RPC))
pk = (ROOT / "scripts" / ".deployer_key").read_text().strip()
acct = Account.from_key(pk)
addr = acct.address

ABI = [
 {"name":"grantRole","type":"function","stateMutability":"nonpayable","inputs":[{"name":"role","type":"bytes32"},{"name":"account","type":"address"}],"outputs":[]},
 {"name":"mint","type":"function","stateMutability":"nonpayable","inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"},{"name":"reason","type":"string"}],"outputs":[]},
 {"name":"hasRole","type":"function","stateMutability":"view","inputs":[{"name":"role","type":"bytes32"},{"name":"account","type":"address"}],"outputs":[{"name":"","type":"bool"}]},
]
suwp = w3.eth.contract(address=Web3.to_checksum_address(SUWP), abi=ABI)
MINTER = w3.keccak(text="MINTER_ROLE")

def send(fn, label):
    nonce = w3.eth.get_transaction_count(addr, "pending")
    tx = fn.build_transaction({"from": addr, "nonce": nonce,
                               "gasPrice": int(w3.eth.gas_price * 1.2), "chainId": CHAIN_ID})
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.3)
    signed = Account.sign_transaction(tx, pk)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    h = w3.eth.send_raw_transaction(raw)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    ok = "✓" if r.status == 1 else "✗ REVERTED"
    print(f"  {ok} {label}  tx={h.hex()}")
    time.sleep(2)  # let nonce propagate
    return r.status == 1

print("Finalizing deploy...")
if not suwp.functions.hasRole(MINTER, Web3.to_checksum_address(STAKING)).call():
    send(suwp.functions.grantRole(MINTER, Web3.to_checksum_address(STAKING)), "grantRole MINTER -> Staking")
else:
    print("  · Staking already has MINTER_ROLE")
if not suwp.functions.hasRole(MINTER, Web3.to_checksum_address(BONDS)).call():
    send(suwp.functions.grantRole(MINTER, Web3.to_checksum_address(BONDS)), "grantRole MINTER -> Bonds")
else:
    print("  · Bonds already has MINTER_ROLE")
send(suwp.functions.mint(addr, 1_000_000 * 10**18, "testnet_initial"), "mint 1M SUWP -> deployer")

addrs = {"network": "testnet", "chain_id": CHAIN_ID, "deployer": addr,
         "SUWP": SUWP, "SuwppuStaking": STAKING, "SuwppuBonds": BONDS,
         "USDCx": "0xC821107bE6E8eD189F3fe05AD06C496243b53B55",
         "USDC": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"}
(ROOT / "scripts" / "deployed_addresses.json").write_text(json.dumps(addrs, indent=2))
print("\nSaved scripts/deployed_addresses.json")
print(json.dumps(addrs, indent=2))
