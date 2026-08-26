#!/usr/bin/env python3
"""One-shot Railway job: deploy Suwappu Positions to Robinhood testnet (46630)
signed by a COMPANY Turnkey wallet — no raw key ever leaves the enclave.

Runs where TURNKEY_API_PRIVATE_KEY / _PUBLIC_KEY / ORGANIZATION_ID already live
(a Railway service with references to python-api's vars), per the guidance in
scripts/deploy_robinhood_chain.py: run it next to the secrets, don't copy them.

Flow:
  1. List the org's Turnkey wallets and every EVM account's balance on 46630.
  2. Pick the signer: DEPLOY_FROM_ADDRESS env if set, else the first account
     holding >= MIN_WEI. If none is funded, print the addresses to fund at
     https://faucet.testnet.chain.robinhood.com and poll for up to
     RUNNER_WAIT_MINUTES (default 120) so a faucet drip mid-run is picked up.
  3. Deploy MockUSDG + RobinhoodChainlinkOracle + SuwappuPositions via
     scripts/deploy_robinhood_chain.py --signer turnkey.
  4. Wire: setUsdg(mock), setTreasury(signer), setOracle, sealRegistry, then
     configurePhase for the open phases (Public $19 / Gold $119). Founder and
     Allowlist need merkle roots from build_allowlist.py (DB snapshot) and are
     left unconfigured on testnet — expected.
  5. Verify getters and print an explorer link per contract.

Exit 0 with a clear log either way — this is a job, not a daemon.

Railway note: this service's watchPatterns must cover scripts/ and bot/, or a
pushed fix is SKIPPED rather than built (it defaulted to a manual-deploy-only
sentinel and silently ignored a real fix once).
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RPC = os.environ.get("RH_TESTNET_RPC_URL", "https://rpc.testnet.chain.robinhood.com")
EXPLORER = "https://explorer.testnet.chain.robinhood.com"
CHAIN_ID = 46630
MIN_WEI = 300_000_000_000_000  # 0.0003 ETH — ~4x the dry-run estimate
WAIT_MIN = int(os.environ.get("RUNNER_WAIT_MINUTES", "120"))

PHASE_PUBLIC, PHASE_GOLD = 3, 4
ZERO_ROOT = b"\x00" * 32


_LOOP = None


def run_async(coro):
    """One long-lived loop for the whole job — see deploy_robinhood_chain._run.
    The Turnkey client's aiohttp session is bound to the loop that made it, so
    asyncio.run() per wiring step would close it out from under the next one."""
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


def w3conn():
    from web3 import Web3

    w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
    if not w3.is_connected() or w3.eth.chain_id != CHAIN_ID:
        sys.exit(f"cannot reach {RPC} as chain {CHAIN_ID}")
    return w3


async def evm_accounts():
    """Every EVM address in the org's Turnkey wallets, [(wallet_name, address)]."""
    from bot.services.turnkey_client import get_turnkey_client

    tk = get_turnkey_client()
    out = []
    for w in await tk.list_wallets():
        wid = w.get("walletId")
        name = w.get("walletName", wid)
        # list_wallets carries no addresses; the accounts query does.
        res = await tk._request(
            "POST",
            "/public/v1/query/list_wallet_accounts",
            {"organizationId": tk._org_id, "walletId": wid},
        )
        for a in res.get("accounts", []):
            addr = a.get("address", "")
            if addr.startswith("0x") and len(addr) == 42:
                out.append((name, addr))
    return out


def pick_signer(w3, accounts):
    forced = os.environ.get("DEPLOY_FROM_ADDRESS")
    print(f"\nTurnkey EVM accounts on chain {CHAIN_ID}:")
    funded = []
    for name, addr in accounts:
        bal = w3.eth.get_balance(w3.to_checksum_address(addr))
        print(f"  {addr}  {bal / 1e18:.6f} ETH   ({name})")
        if bal >= MIN_WEI:
            funded.append(addr)
    if forced:
        print(f"DEPLOY_FROM_ADDRESS forces signer {forced}")
        return w3.to_checksum_address(forced)
    return w3.to_checksum_address(funded[0]) if funded else None


async def send_via_turnkey(w3, fn, signer, nonce, gas_price):
    """Sign one contract call in Turnkey's enclave and broadcast it."""
    import rlp
    from eth_account._utils.legacy_transactions import (
        serializable_unsigned_transaction_from_dict,
    )
    from eth_utils import to_hex

    from bot.services.turnkey_client import get_turnkey_client

    tx = fn.build_transaction(
        {"from": signer, "chainId": CHAIN_ID, "nonce": nonce, "gasPrice": gas_price, "gas": 0}
    )
    tx["gas"] = int(w3.eth.estimate_gas({k: tx[k] for k in ("from", "to", "data")}) * 1.3)
    unsigned = serializable_unsigned_transaction_from_dict(
        {k: v for k, v in tx.items() if k != "from"}
    )
    # rlp.encode(unsigned): the EIP-155 preimage, matching wallet.py's proven path
    signed = await get_turnkey_client().sign_transaction(
        unsigned_transaction=to_hex(rlp.encode(unsigned)),
        sign_with=signer,
        transaction_type="TRANSACTION_TYPE_ETHEREUM",
        organization_id=None,
    )
    raw = signed if signed.startswith("0x") else "0x" + signed
    h = w3.eth.send_raw_transaction(raw)
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=300)
    if rcpt.status != 1:
        raise RuntimeError(f"wiring tx REVERTED: {h.hex()}")
    return h.hex()


def main():
    w3 = w3conn()
    accounts = run_async(evm_accounts())
    if not accounts:
        print("Turnkey org has no EVM accounts — create one with /hw new <label> evm")
        return 0

    signer = pick_signer(w3, accounts)
    deadline = time.time() + WAIT_MIN * 60
    while signer is None and time.time() < deadline:
        print(
            f"no funded account — send >=0.0003 testnet ETH to one of the above via "
            f"https://faucet.testnet.chain.robinhood.com (rechecking 60s, "
            f"{int((deadline - time.time()) / 60)}m left)"
        )
        time.sleep(60)
        signer = pick_signer(w3, accounts)
    if signer is None:
        print("TIMEOUT: no Turnkey account was funded — rerun after funding")
        return 0
    print(f"\nsigner: {signer} (Turnkey-held key)")

    # ── deploy the three contracts via the existing script ──────────────────
    proc = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "deploy_robinhood_chain.py"),
            "--network",
            "testnet",
            "--signer",
            "turnkey",
            "--from",
            signer,
        ],
        capture_output=True,
        text=True,
    )
    print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr[-2000:])
        sys.exit("deploy step failed")

    deployed = dict(re.findall(r"^\s+(\w+)\s+->\s+(0x[a-fA-F0-9]{40})", proc.stdout, re.M))
    for need in ("MockUSDG", "RobinhoodChainlinkOracle", "SuwappuPositions"):
        if need not in deployed:
            sys.exit(f"could not parse {need} address from deploy output")

    art = json.loads((ROOT / "contracts" / "test" / "artifacts.json").read_text())["artifacts"]
    pos = w3.eth.contract(address=deployed["SuwappuPositions"], abi=art["SuwappuPositions"]["abi"])
    cfg = json.loads((ROOT / "nft" / "position-cards" / "config.json").read_text())
    phases = cfg["mint"]["phases"]
    gas_price = w3.eth.gas_price
    nonce = w3.eth.get_transaction_count(signer)
    now = int(time.time())

    # ── wiring, in the order the deploy script prescribes ───────────────────
    steps = [
        ("setUsdg", pos.functions.setUsdg(deployed["MockUSDG"])),
        ("setTreasury", pos.functions.setTreasury(signer)),
        ("setOracle", pos.functions.setOracle(deployed["RobinhoodChainlinkOracle"])),
        ("sealRegistry", pos.functions.sealRegistry()),
        (
            "configurePhase(Public)",
            pos.functions.configurePhase(
                PHASE_PUBLIC,
                ZERO_ROOT,
                phases["Public"]["price_usd_cents"],
                phases["Public"]["wallet_cap"],
                phases["Public"]["allocation"],
                now - 1,
                0,
            ),
        ),
        (
            "configurePhase(Gold)",
            pos.functions.configurePhase(
                PHASE_GOLD,
                ZERO_ROOT,
                phases["Gold"]["price_usd_cents"],
                phases["Gold"]["wallet_cap"],
                phases["Gold"]["allocation"],
                now - 1,
                0,
            ),
        ),
    ]
    for label, fn in steps:
        h = run_async(send_via_turnkey(w3, fn, signer, nonce, gas_price))
        print(f"  {label:24} {h}")
        nonce += 1

    # ── verify state ────────────────────────────────────────────────────────
    assert pos.functions.MAX_SUPPLY().call() == 4444
    assert pos.functions.treasury().call() == signer
    assert pos.functions.goldDiscountFractionBps().call() == 5500
    recv, amt = pos.functions.royaltyInfo(1, 10**18).call()
    assert recv == signer and amt == 2 * 10**16, "royalty must be 2% to treasury"

    print("\nDEPLOYED + WIRED on Robinhood testnet 46630:")
    for k, v in deployed.items():
        print(f"  {k:26} {v}  {EXPLORER}/address/{v}")
    print("  (Founder/Allowlist phases need merkle roots from build_allowlist.py — later)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
