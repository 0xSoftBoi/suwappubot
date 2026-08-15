#!/usr/bin/env python3
"""Deploy the Positions collection to Robinhood Chain (4663 / testnet 46630).

scripts/deploy_contracts.py targets BASE and deploys SUWP/bonds — it has no
Robinhood Chain path and never deployed this collection. This is that path.

    python3 scripts/deploy_robinhood_chain.py --network testnet --dry-run
    DEPLOYER_PRIVATE_KEY=0x... python3 scripts/deploy_robinhood_chain.py --network testnet

--dry-run needs no key: it reports what would be deployed, the gas each contract
costs, and the ETH balance required, so the funding step can be done once with a
known number instead of guessed at.

Deployment on Robinhood Chain is permissionless — their docs describe plain
forge/hardhat deploys with no allowlist. The only gate is ETH for gas, and
Robinhood publishes no testnet faucet, so testnet ETH has to be bridged or
requested.
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "contracts" / "test" / "artifacts.json"

NETWORKS = {
    "testnet": {
        "name": "Robinhood Chain Testnet",
        "chain_id": 46630,
        "rpc_url": os.environ.get("RH_TESTNET_RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
        "explorer": "https://explorer.testnet.chain.robinhood.com",
        # USDG is NOT deployed on testnet at its mainnet address (verified: eth_getCode
        # returns 0x), so the testnet run deploys MockUSDG and points the collection at it.
        "usdg": None,
    },
    "mainnet": {
        "name": "Robinhood Chain",
        "chain_id": 4663,
        "rpc_url": os.environ.get("RH_MAINNET_RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
        "explorer": "https://robinhoodchain.blockscout.com",
        "usdg": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    },
}

# Deployed in this order; later entries may depend on earlier addresses.
PLAN = ["MockUSDG", "RobinhoodChainlinkOracle", "SuwappuPositions"]


def _w3(rpc):
    from web3 import Web3

    return Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))


def _artifacts():
    if not ARTIFACTS.exists():
        sys.exit("artifacts missing — run: node scripts/build_contract_test_artifacts.js")
    return json.loads(ARTIFACTS.read_text())["artifacts"]


def _ctor_args(name, owner, usdg):
    args = json.loads((ROOT / "nft" / "position-cards" / "deploy_args.json").read_text())
    return {
        "MockUSDG": [],
        "RobinhoodChainlinkOracle": [owner],
        "SuwappuPositions": [args["caps"], args["tokens"], "https://suwappu.bot/positions/", owner],
    }[name]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--network", choices=["testnet", "mainnet"], default="testnet")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--owner", help="owner/treasury; defaults to the deployer")
    ap.add_argument(
        "--signer",
        choices=["key", "turnkey"],
        default="key",
        help="key: DEPLOYER_PRIVATE_KEY. turnkey: sign in Turnkey's enclave, no raw key anywhere.",
    )
    ap.add_argument(
        "--from", dest="from_address", help="signer address, required for --signer turnkey"
    )
    a = ap.parse_args()

    net = NETWORKS[a.network]
    w3 = _w3(net["rpc_url"])
    if not w3.is_connected():
        sys.exit(f"cannot reach {net['rpc_url']}")
    live = w3.eth.chain_id
    if live != net["chain_id"]:
        sys.exit(f"RPC reports chain {live}, expected {net['chain_id']} — refusing")
    print(f"{net['name']} · chain {live} · {net['rpc_url']}")

    art = _artifacts()
    deployer = None
    if a.signer == "turnkey":
        # Turnkey holds the key in its enclave; nothing is exported and there is
        # no private key on disk or in env. This is the path for a wallet made
        # with `/hw new <label> evm`, which is why that command exists.
        #
        # It still needs TURNKEY_API_PRIVATE_KEY / _PUBLIC_KEY / ORGANIZATION_ID
        # in the environment it runs in — the enclave authenticates the caller.
        # Run it somewhere those already live rather than copying them around.
        deployer = a.from_address
        if not deployer:
            sys.exit("--signer turnkey requires --from <address>")
        print(f"deployer: {deployer} (Turnkey-held key, nothing exported)")
    else:
        key = os.environ.get("DEPLOYER_PRIVATE_KEY")
        if key:
            from eth_account import Account

            deployer = Account.from_key(key).address
            print(f"deployer: {deployer}")
        elif not a.dry_run:
            sys.exit("DEPLOYER_PRIVATE_KEY is required, or use --signer turnkey --from <address>")

    owner = a.owner or deployer or "0x" + "11" * 20
    plan = [c for c in PLAN if not (c == "MockUSDG" and net["usdg"])]

    gas_price = w3.eth.gas_price
    total_gas = 0
    print(f"\ngas price: {gas_price / 1e9:.4f} gwei\n")
    for name in plan:
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        tx = c.constructor(*_ctor_args(name, owner, net["usdg"])).build_transaction(
            {"from": deployer or "0x" + "11" * 20, "chainId": live, "gas": 30_000_000}
        )
        try:
            est = w3.eth.estimate_gas({k: tx[k] for k in ("from", "data", "chainId")})
        except Exception as e:  # unfunded accounts still estimate on most nodes
            est = 0
            print(f"  {name:26} estimate unavailable ({str(e)[:60]})")
        if est:
            total_gas += est
            print(f"  {name:26} {est:>10,} gas   ~{est * gas_price / 1e18:.6f} ETH")

    if total_gas:
        need = total_gas * gas_price
        print(f"\n  {'TOTAL':26} {total_gas:>10,} gas   ~{need / 1e18:.6f} ETH")
        if deployer:
            bal = w3.eth.get_balance(deployer)
            print(f"  deployer balance: {bal / 1e18:.6f} ETH")
            print("  FUNDED" if bal >= need else f"  UNDERFUNDED by {(need - bal) / 1e18:.6f} ETH")

    if a.dry_run:
        print("\ndry run — nothing deployed.")
        print("After deploying, wire it up: setUsdg, setTreasury, setOracle, sealRegistry,")
        print("then configurePhase. sealRegistry is irreversible — check the ticker order first.")
        return 0

    return _broadcast(w3, art, plan, a, net, deployer, owner, gas_price)


async def _turnkey_sign(unsigned_hex: str, address: str) -> str:
    from bot.services.turnkey_client import get_turnkey_client

    return await get_turnkey_client().sign_transaction(
        unsigned_transaction=unsigned_hex,
        sign_with=address,
        transaction_type="TRANSACTION_TYPE_ETHEREUM",
        organization_id=None,  # main org, same as hot wallets
    )


def _broadcast(w3, art, plan, a, net, deployer, owner, gas_price):
    """Deploy each contract in order, then print the wiring rather than doing it."""
    import asyncio

    from eth_account import Account
    from eth_utils import to_hex

    deployed = {}
    nonce = w3.eth.get_transaction_count(deployer)

    for name in plan:
        c = w3.eth.contract(abi=art[name]["abi"], bytecode=art[name]["bytecode"])
        tx = c.constructor(*_ctor_args(name, owner, net["usdg"])).build_transaction(
            {
                "from": deployer,
                "chainId": net["chain_id"],
                "nonce": nonce,
                "gasPrice": gas_price,
                "gas": 30_000_000,
            }
        )
        tx["gas"] = int(w3.eth.estimate_gas({k: tx[k] for k in ("from", "data")}) * 1.2)

        if a.signer == "turnkey":
            from eth_account._utils.legacy_transactions import (
                serializable_unsigned_transaction_from_dict,
            )

            unsigned = serializable_unsigned_transaction_from_dict(
                {k: v for k, v in tx.items() if k != "from"}
            )
            signed_hex = asyncio.run(_turnkey_sign(to_hex(unsigned.encode()), deployer))
            raw = signed_hex if signed_hex.startswith("0x") else "0x" + signed_hex
            tx_hash = w3.eth.send_raw_transaction(raw)
        else:
            acct = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"])
            tx_hash = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)

        print(f"  {name:26} tx {tx_hash.hex()}")
        rcpt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        if rcpt.status != 1:
            sys.exit(f"{name} deployment REVERTED — stopping before anything else is deployed")
        deployed[name] = rcpt.contractAddress
        print(
            f"  {name:26} -> {rcpt.contractAddress}  ({net['explorer']}/address/{rcpt.contractAddress})"
        )
        nonce += 1

    print("\nDeployed:")
    for k, v in deployed.items():
        print(f"  {k:26} {v}")
    usdg = net["usdg"] or deployed.get("MockUSDG")
    pos = deployed.get("SuwappuPositions")
    print("\nNOT DONE — wire it up yourself, in this order:")
    print(f"  setUsdg({usdg})")
    print(f"  setTreasury(<treasury>)")
    print(f"  setOracle({deployed.get('RobinhoodChainlinkOracle')})")
    print(f"  sealRegistry()          # IRREVERSIBLE — check the ticker order first")
    print(f"  configurePhase(...)     # a 0 price is rejected; see UnpricedAtMint")
    print(f"\n  collection: {pos}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
