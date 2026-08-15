#!/usr/bin/env python3
"""
Create a USDCx Super Token wrapper for the test USDC on Base Sepolia via
Superfluid's SuperTokenFactory. Prints the new super token address.

Uses the same standalone deployer keystore as deploy_contracts.py.
"""
import os, sys, json
from pathlib import Path
from web3 import Web3
from eth_account import Account

ROOT = Path(__file__).parent.parent
KEYSTORE = ROOT / "scripts" / ".deployer_key"

RPC = os.environ.get("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
HOST = "0x109412E3C84f0539b43d39dB691B08c90f58dC7c"
TEST_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
CHAIN_ID = 84532

HOST_ABI = [{"name": "getSuperTokenFactory", "type": "function", "stateMutability": "view",
             "inputs": [], "outputs": [{"name": "", "type": "address"}]}]

FACTORY_ABI = [
    # createERC20Wrapper(IERC20Metadata, Upgradability, string, string) -> ISuperToken
    {"name": "createERC20Wrapper", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
        {"name": "underlyingToken", "type": "address"},
        {"name": "upgradability", "type": "uint8"},
        {"name": "name", "type": "string"},
        {"name": "symbol", "type": "string"},
     ],
     "outputs": [{"name": "superToken", "type": "address"}]},
    {"anonymous": False, "name": "SuperTokenCreated", "type": "event",
     "inputs": [{"indexed": True, "name": "token", "type": "address"}]},
]


def main():
    w3 = Web3(Web3.HTTPProvider(RPC))
    pk = KEYSTORE.read_text().strip()
    acct = Account.from_key(pk)
    addr = acct.address
    print(f"Deployer: {addr}", file=sys.stderr)

    host = w3.eth.contract(address=Web3.to_checksum_address(HOST), abi=HOST_ABI)
    factory_addr = host.functions.getSuperTokenFactory().call()
    print(f"SuperTokenFactory: {factory_addr}", file=sys.stderr)

    factory = w3.eth.contract(address=Web3.to_checksum_address(factory_addr), abi=FACTORY_ABI)

    fn = factory.functions.createERC20Wrapper(
        Web3.to_checksum_address(TEST_USDC),
        1,                       # Upgradability.SEMI_UPGRADABLE
        "Super Test USDC",
        "USDCx",
    )
    nonce = w3.eth.get_transaction_count(addr)
    tx = fn.build_transaction({
        "from": addr, "nonce": nonce, "gasPrice": w3.eth.gas_price, "chainId": CHAIN_ID,
    })
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.3)
    signed = Account.sign_transaction(tx, pk)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    txh = w3.eth.send_raw_transaction(raw)
    print(f"createERC20Wrapper tx: {txh.hex()}", file=sys.stderr)
    rcpt = w3.eth.wait_for_transaction_receipt(txh, timeout=120)
    if rcpt.status != 1:
        print("FAILED", file=sys.stderr); sys.exit(1)

    # Parse SuperTokenCreated event for the new super token address
    logs = factory.events.SuperTokenCreated().process_receipt(rcpt)
    if logs:
        usdcx = logs[0]["args"]["token"]
        print(f"USDCx created: {usdcx}", file=sys.stderr)
        print(usdcx)  # stdout = just the address (for capture)
    else:
        print("No SuperTokenCreated event found", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
