#!/usr/bin/env python3
"""Live Tempo testnet smoke test for the enshrined-DEX + TIP-20 integration.

Exercises the SAME client code the bot uses (bot/services/tempo_dex_api.py and
bot/services/tempo_tip20.py) against a real Tempo testnet, so a green run here
proves the corrected ABIs actually work on-chain — not just in unit tests.

What it does:
  1. Connects to a Tempo testnet (default: Moderato, chain 42431).
  2. Funds the account with the four testnet stablecoins via the Tempo-specific
     `tempo_fundAddress` RPC (1M of each; testnet-only, free).
  3. Reads TIP-20 balances (pathUSD / AlphaUSD / BetaUSD / ThetaUSD).
  4. Quotes pathUSD -> AlphaUSD on the enshrined Stablecoin DEX.
  5. approve(DEX) then swapExactAmountIn(tokenIn, tokenOut, amountIn, minOut)
     — the corrected 4-arg signature, no recipient — and confirms the output
     balance increased.
  6. (Optional) sends a TIP-20 transferWithMemo (bytes32 memo) to self.

This is NOT run in CI: it needs network egress to the testnet RPC and is gated
behind explicit invocation. Gas on Tempo is paid in stablecoins, so a freshly
funded account can pay its own fees — no native-token top-up needed.

Usage:
    python3 scripts/tempo_testnet_smoke.py                 # fresh random key
    TEMPO_TESTNET_PRIVKEY=0x... python3 scripts/tempo_testnet_smoke.py
    python3 scripts/tempo_testnet_smoke.py --rpc https://rpc.moderato.tempo.xyz
    python3 scripts/tempo_testnet_smoke.py --testnet andantino --amount 1.0
"""

import argparse
import sys
import time

from eth_account import Account
from web3 import Web3

# Import the REAL bot client code + canonical addresses so this validates them.
from bot.config.chains import TEMPO_TESTNETS
from bot.config.tokens import get_token_address, get_token_decimals
from bot.services.tempo_dex_api import TEMPO_DEX_ADDRESS, TEMPO_DEX_ABI
from bot.services.tempo_tip20 import TIP20_ABI, TempoTIP20

TOKENS = ["PATHUSD", "ALPHAUSD", "BETAUSD", "THETAUSD"]


def _log(msg: str) -> None:
    print(msg, flush=True)


def _balances(w3: Web3, address: str) -> dict:
    out = {}
    for sym in TOKENS:
        addr = get_token_address(sym, "tempo")
        c = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=TIP20_ABI)
        out[sym] = c.functions.balanceOf(Web3.to_checksum_address(address)).call()
    return out


def _send(w3: Web3, acct, tx: dict, chain_id: int, gas: int) -> dict:
    """Sign + broadcast a legacy-gas tx and wait for the receipt.

    Tempo accepts standard legacy/EIP-1559 txs; gas is auto-charged in a
    stablecoin (no native gas token), so no `value`/native balance is needed.
    """
    tx = dict(tx)
    tx.update(
        {
            "from": acct.address,
            "value": tx.get("value", 0),
            "gas": gas,
            "gasPrice": w3.eth.gas_price,
            "nonce": w3.eth.get_transaction_count(acct.address),
            "chainId": chain_id,
        }
    )
    signed = acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    return rcpt


def main() -> int:
    p = argparse.ArgumentParser(description="Tempo testnet smoke test")
    p.add_argument("--testnet", default="moderato", choices=list(TEMPO_TESTNETS.keys()))
    p.add_argument("--rpc", default=None, help="Override RPC URL")
    p.add_argument("--amount", type=float, default=1.0, help="pathUSD amount to swap")
    p.add_argument("--slippage", type=float, default=0.5, help="slippage %% for min-out")
    p.add_argument("--skip-memo", action="store_true", help="skip transferWithMemo step")
    args = p.parse_args()

    net = TEMPO_TESTNETS[args.testnet]
    rpc_url = args.rpc or net["rpc_url"]
    chain_id = net["chain_id"]

    import os

    pk = os.environ.get("TEMPO_TESTNET_PRIVKEY")
    acct = Account.from_key(pk) if pk else Account.create()

    _log(f"== Tempo testnet smoke: {args.testnet} (chain {chain_id}) ==")
    _log(f"RPC:     {rpc_url}")
    _log(f"Account: {acct.address}")

    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
    on_chain_id = w3.eth.chain_id
    if on_chain_id != chain_id:
        _log(f"!! chainId mismatch: RPC says {on_chain_id}, expected {chain_id}")
        return 1
    _log(f"Connected. chainId={on_chain_id}, block={w3.eth.block_number}")

    # 1. Fund via the Tempo-specific faucet RPC (testnet only).
    _log("\n[1] Funding via tempo_fundAddress ...")
    try:
        w3.provider.make_request("tempo_fundAddress", [acct.address])
        time.sleep(3)
    except Exception as e:
        _log(f"!! tempo_fundAddress failed: {e}")
        _log("   (account may already be funded; continuing)")

    bals = _balances(w3, acct.address)
    for sym, raw in bals.items():
        _log(f"    {sym:9s} {raw / 10 ** get_token_decimals(sym, 'tempo'):,.6f}")
    if bals["PATHUSD"] == 0:
        _log("!! No pathUSD balance after funding — cannot swap. Aborting.")
        return 1

    # 2. Quote pathUSD -> AlphaUSD.
    token_in, token_out = "PATHUSD", "ALPHAUSD"
    dec_in = get_token_decimals(token_in, "tempo")
    amount_in = int(args.amount * 10**dec_in)
    addr_in = Web3.to_checksum_address(get_token_address(token_in, "tempo"))
    addr_out = Web3.to_checksum_address(get_token_address(token_out, "tempo"))
    dex = w3.eth.contract(address=Web3.to_checksum_address(TEMPO_DEX_ADDRESS), abi=TEMPO_DEX_ABI)

    _log(f"\n[2] Quote {args.amount} {token_in} -> {token_out} ...")
    quoted_out = dex.functions.quoteSwapExactAmountIn(addr_in, addr_out, amount_in).call()
    min_out = int(quoted_out * (1 - args.slippage / 100))
    _log(
        f"    quoted out: {quoted_out / 10 ** get_token_decimals(token_out, 'tempo'):,.6f} "
        f"(minOut after {args.slippage}%: {min_out})"
    )

    # 3. approve -> swapExactAmountIn (corrected 4-arg, no recipient).
    _log("\n[3] approve(DEX) ...")
    tok_in = w3.eth.contract(address=addr_in, abi=TIP20_ABI)
    approve_data = tok_in.encode_abi(
        "approve", args=[Web3.to_checksum_address(TEMPO_DEX_ADDRESS), amount_in]
    )
    r1 = _send(w3, acct, {"to": addr_in, "data": approve_data}, chain_id, gas=120_000)
    _log(f"    approve status={r1['status']} tx={r1['transactionHash'].hex()}")

    _log("[3] swapExactAmountIn ...")
    swap_data = dex.encode_abi("swapExactAmountIn", args=[addr_in, addr_out, amount_in, min_out])
    out_before = _balances(w3, acct.address)[token_out]
    r2 = _send(
        w3,
        acct,
        {"to": Web3.to_checksum_address(TEMPO_DEX_ADDRESS), "data": swap_data},
        chain_id,
        gas=400_000,
    )
    _log(f"    swap status={r2['status']} tx={r2['transactionHash'].hex()}")
    if r2["status"] != 1:
        _log("!! swap reverted")
        return 1
    out_after = _balances(w3, acct.address)[token_out]
    gained = out_after - out_before
    _log(f"    {token_out} +{gained / 10 ** get_token_decimals(token_out, 'tempo'):,.6f}")
    if gained <= 0:
        _log("!! output balance did not increase — swap did not settle to wallet")
        return 1

    # 4. Optional TIP-20 transferWithMemo (bytes32 memo) to self.
    if not args.skip_memo:
        _log("\n[4] transferWithMemo (bytes32) to self ...")
        memo_tx = TempoTIP20().build_transfer_with_memo(
            get_token_address(token_out, "tempo"), acct.address, gained, memo="smoke-test"
        )
        r3 = _send(w3, acct, memo_tx, chain_id, gas=150_000)
        _log(f"    transferWithMemo status={r3['status']} tx={r3['transactionHash'].hex()}")
        if r3["status"] != 1:
            _log("!! transferWithMemo reverted")
            return 1

    _log("\n✅ Tempo testnet smoke test PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
