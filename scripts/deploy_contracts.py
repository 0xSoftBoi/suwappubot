#!/usr/bin/env python3
"""
Deploy Suwappu contracts to Base Sepolia using the bot's own treasury wallet.

Uses the existing hot_wallet_service + web3 infrastructure — no raw private keys needed.
Reads compiled contract artifacts from contracts/out/ (run `forge build` first).

Usage:
    python3 scripts/deploy_contracts.py --network testnet
    python3 scripts/deploy_contracts.py --network mainnet  # when ready

The treasury_vault hot wallet must exist in the DB:
    name = "treasury_vault", chain_type = "evm"
"""

import sys
import json
import argparse
import logging
from pathlib import Path
from decimal import Decimal

# Add project root to path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("deploy")

# ─── Network config ───────────────────────────────────────────────────────────

NETWORKS = {
    "testnet": {
        "name": "Base Sepolia",
        "chain_id": 84532,
        "rpc_url": "https://sepolia.base.org",
        "usdc":    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "usdcx":   "0x8aE68021f6170E5a766bE613cEA0d75236ECCa9a",
        "sf_host": "0x109412E3C84f0539b43d39dB691B08c90f58dC7c",
        "sf_gda":  "0x68aE1b4ba46d276e0FDfB7dCa7E93f5A2B1E6Ed6",
        "uni_pos": "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
        "explorer": "https://sepolia.basescan.org",
    },
    "mainnet": {
        "name": "Base Mainnet",
        "chain_id": 8453,
        "rpc_url": "https://mainnet.base.org",
        "usdc":    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "usdcx":   "0xD04383398dD2426297da660F9CCA3d439AF9ce1b",
        "sf_host": "0x4C073B3baB862572842bFB01F7B1FA40B61D1A06",
        "sf_gda":  "0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08",
        "uni_pos": "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f",
        "explorer": "https://basescan.org",
    },
}

ARTIFACTS = ROOT / "contracts" / "out"
DEPLOY_LOG = ROOT / "scripts" / "deployed_addresses.json"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_artifact(contract_name: str) -> tuple[list, str]:
    """Load ABI and bytecode from forge build output."""
    path = ARTIFACTS / f"{contract_name}.sol" / f"{contract_name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing artifact: {path}\nRun: cd contracts && forge build")
    data = json.loads(path.read_text())
    abi = data["abi"]
    bytecode = data["bytecode"]["object"]
    if not bytecode.startswith("0x"):
        bytecode = "0x" + bytecode
    return abi, bytecode


def deploy_contract(web3, wallet, private_key: str, abi: list, bytecode: str,
                    constructor_args: list, label: str, chain_id: int) -> str:
    """Deploy a contract and return its address."""
    from eth_account import Account
    contract = web3.eth.contract(abi=abi, bytecode=bytecode)
    nonce = web3.eth.get_transaction_count(web3.to_checksum_address(wallet.address))
    gas_price = web3.eth.gas_price

    tx = contract.constructor(*constructor_args).build_transaction({
        "from": web3.to_checksum_address(wallet.address),
        "nonce": nonce,
        "gasPrice": gas_price,
        "chainId": chain_id,
    })
    tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.2)  # 20% buffer

    if not private_key.startswith("0x"):
        private_key = "0x" + private_key
    signed = Account.sign_transaction(tx, private_key)
    tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)

    logger.info(f"  Deploying {label}... tx={tx_hash.hex()[:20]}...")
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt.status != 1:
        raise RuntimeError(f"{label} deployment failed (tx={tx_hash.hex()})")

    address = receipt.contractAddress
    logger.info(f"  ✓ {label}: {address}")
    return address


def send_tx(web3, wallet, private_key: str, contract_fn, label: str, chain_id: int):
    """Send a state-changing transaction."""
    from eth_account import Account
    nonce = web3.eth.get_transaction_count(web3.to_checksum_address(wallet.address))
    gas_price = web3.eth.gas_price
    tx = contract_fn.build_transaction({
        "from": web3.to_checksum_address(wallet.address),
        "nonce": nonce,
        "gasPrice": gas_price,
        "chainId": chain_id,
    })
    tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.2)
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key
    signed = Account.sign_transaction(tx, private_key)
    tx_hash = web3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
    if receipt.status != 1:
        raise RuntimeError(f"{label} failed (tx={tx_hash.hex()})")
    logger.info(f"  ✓ {label}")
    return tx_hash.hex()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Deploy Suwappu contracts")
    parser.add_argument("--network", choices=["testnet", "mainnet"], default="testnet")
    parser.add_argument("--wallet-name", default="treasury_vault",
                        help="HotWallet.name to use as deployer")
    parser.add_argument("--dry-run", action="store_true",
                        help="Load wallet and check balance without deploying")
    args = parser.parse_args()

    net = NETWORKS[args.network]
    logger.info(f"Deploying to {net['name']} (chain {net['chain_id']})")

    # Init DB (needs DATABASE_URL in env or settings)
    from database.db import init_db
    from bot.config.settings import settings
    if not init_db(settings.database_url):
        logger.error("DB init failed. Is DATABASE_URL set?")
        sys.exit(1)

    # Load treasury wallet via existing bot infrastructure
    from web3 import Web3
    from bot.models.custodial import HotWallet
    from database.db import get_session
    from bot.services.hot_wallet import hot_wallet_service

    web3 = Web3(Web3.HTTPProvider(net["rpc_url"]))
    if not web3.is_connected():
        logger.error(f"Cannot connect to {net['rpc_url']}")
        sys.exit(1)

    with get_session() as session:
        wallet = session.query(HotWallet).filter(
            HotWallet.name == args.wallet_name
        ).first()
        if not wallet:
            logger.error(
                f"Hot wallet '{args.wallet_name}' not found in DB.\n"
                "Create it via the admin panel or bot /admin → wallets."
            )
            sys.exit(1)
        deployer_address = Web3.to_checksum_address(wallet.address)
        private_key = hot_wallet_service.get_private_key(wallet)

    balance = web3.eth.get_balance(deployer_address)
    eth_balance = web3.from_wei(balance, "ether")
    logger.info(f"Deployer: {deployer_address}")
    logger.info(f"Balance:  {eth_balance:.6f} ETH")

    if eth_balance < Decimal("0.005"):
        logger.error(
            f"Insufficient ETH for gas (have {eth_balance:.6f}, need ~0.005).\n"
            f"Fund {deployer_address} on Base Sepolia:\n"
            f"  https://www.alchemy.com/faucets/base-sepolia"
        )
        sys.exit(1)

    if args.dry_run:
        logger.info("--dry-run: stopping before deployment.")
        return

    # Load artifacts
    logger.info("Loading compiled artifacts...")
    suwp_abi, suwp_bytecode             = load_artifact("SUWP")
    staking_abi, staking_bytecode        = load_artifact("SuwppuStaking")
    bonds_abi, bonds_bytecode            = load_artifact("SuwppuBonds")

    chain_id = net["chain_id"]

    # ── 1. Deploy SUWP token ──────────────────────────────────────────────────
    logger.info("\n[1/5] Deploying SUWP token...")
    suwp_address = deploy_contract(
        web3, wallet, private_key,
        suwp_abi, suwp_bytecode,
        [deployer_address],  # admin
        "SUWP", chain_id,
    )

    # ── 2. Deploy SuwppuStaking ───────────────────────────────────────────────
    logger.info("\n[2/5] Deploying SuwppuStaking...")
    staking_address = deploy_contract(
        web3, wallet, private_key,
        staking_abi, staking_bytecode,
        [
            Web3.to_checksum_address(suwp_address),
            Web3.to_checksum_address(net["usdc"]),
            Web3.to_checksum_address(net["usdcx"]),
            Web3.to_checksum_address(net["sf_host"]),
            Web3.to_checksum_address(net["sf_gda"]),
            deployer_address,
        ],
        "SuwppuStaking", chain_id,
    )

    # ── 3. Deploy SuwppuBonds ─────────────────────────────────────────────────
    logger.info("\n[3/5] Deploying SuwppuBonds...")
    bonds_address = deploy_contract(
        web3, wallet, private_key,
        bonds_abi, bonds_bytecode,
        [
            Web3.to_checksum_address(suwp_address),
            Web3.to_checksum_address(net["usdc"]),
            Web3.to_checksum_address(net["uni_pos"]),
            deployer_address,
        ],
        "SuwppuBonds", chain_id,
    )

    # ── 4. Grant MINTER_ROLE to Staking + Bonds ───────────────────────────────
    logger.info("\n[4/5] Granting MINTER_ROLE...")
    suwp_contract = web3.eth.contract(
        address=Web3.to_checksum_address(suwp_address), abi=suwp_abi
    )
    MINTER_ROLE = web3.keccak(text="MINTER_ROLE")
    send_tx(web3, wallet, private_key,
            suwp_contract.functions.grantRole(MINTER_ROLE, Web3.to_checksum_address(staking_address)),
            "grantRole(MINTER_ROLE → Staking)", chain_id)
    send_tx(web3, wallet, private_key,
            suwp_contract.functions.grantRole(MINTER_ROLE, Web3.to_checksum_address(bonds_address)),
            "grantRole(MINTER_ROLE → Bonds)", chain_id)

    # ── 5. Mint test SUWP ─────────────────────────────────────────────────────
    logger.info("\n[5/5] Minting 1M SUWP to deployer for testing...")
    send_tx(web3, wallet, private_key,
            suwp_contract.functions.mint(deployer_address, 1_000_000 * 10**18, "testnet_initial"),
            "mint 1M SUWP", chain_id)

    # ── Save addresses ────────────────────────────────────────────────────────
    deployed = {
        "network": args.network,
        "chain_id": chain_id,
        "deployer": deployer_address,
        "SUWP": suwp_address,
        "SuwppuStaking": staking_address,
        "SuwppuBonds": bonds_address,
    }
    DEPLOY_LOG.write_text(json.dumps(deployed, indent=2))
    logger.info(f"\nAddresses saved to {DEPLOY_LOG}")

    # ── Print summary ─────────────────────────────────────────────────────────
    explorer = net["explorer"]
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           DEPLOYMENT COMPLETE — {net['name']:<27} ║
╠══════════════════════════════════════════════════════════════╣
║ SUWP:           {suwp_address}  ║
║ SuwppuStaking:  {staking_address}  ║
║ SuwppuBonds:    {bonds_address}  ║
╠══════════════════════════════════════════════════════════════╣
║ Add to Railway env:                                          ║
║   SUWP_CONTRACT_ADDRESS={suwp_address[:20]}...  ║
║   STAKING_CONTRACT_ADDRESS={staking_address[:17]}...  ║
║   BONDS_CONTRACT_ADDRESS={bonds_address[:18]}...  ║
╠══════════════════════════════════════════════════════════════╣
║ View on explorer:                                            ║
║   {explorer}/address/{suwp_address}  ║
╚══════════════════════════════════════════════════════════════╝
""")


if __name__ == "__main__":
    main()
