"""Execute our Relay provider end to end against an anvil fork of Base.

What this proves: the exact transactions `SwapEngine._execute_relay_swap` signs
for a real, live Relay quote are accepted by the real RelayDepository contract
on Base (forked state), in order, with the right events and balance moves.
What it cannot prove: a solver fill on the destination chain (the deposit lands
on a fork Relay does not watch).

Run:  anvil --fork-url https://mainnet.base.org --chain-id 8453 --port 8545 &
      KMS_PROVIDER=dev TELEGRAM_BOT_TOKEN=x ENCRYPTION_KEY=<fernet> \
      DATABASE_URL=sqlite:////tmp/relay_fork.db python3 scripts/research/relay_fork_exec.py
"""
import asyncio, json, os, sys, time
import requests
from web3 import Web3

ANVIL = os.environ.get("ANVIL_URL", "http://127.0.0.1:8545")
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
RELAY_SOLVER = "0xf70da97812CB96acDF810712Aa562db8dfA3dbEF"
NATIVE_DEPOSIT_TOPIC = Web3.keccak(text="RelayNativeDeposit(address,uint256,bytes32)").hex()
ERC20_DEPOSIT_TOPIC = Web3.keccak(text="RelayErc20Deposit(address,address,uint256,bytes32)").hex()
ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "transfer", "type": "function", "stateMutability": "nonpayable", "inputs": [{"name": "to", "type": "address"}, {"name": "v", "type": "uint256"}], "outputs": [{"name": "", "type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view", "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]


def rpc(method, params):
    r = requests.post(ANVIL, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=60).json()
    if "error" in r:
        raise RuntimeError(r["error"])
    return r["result"]


def topic0(hexstr):
    return hexstr if hexstr.startswith("0x") else "0x" + hexstr


async def main():
    from database.db import init_db
    from bot.config.settings import settings
    from bot.services import rpc_manager as rpc_mod
    from bot.services.wallet import WalletService
    from bot.services.swap_engine import SwapEngine

    init_db(settings.database_url)
    w3 = Web3(Web3.HTTPProvider(ANVIL, request_kwargs={"timeout": 120}))
    assert w3.eth.chain_id == 8453, w3.eth.chain_id
    # Point the engine's Base RPC at the fork.
    rpc_mod.rpc_manager.get_web3 = lambda chain: w3
    rpc_mod.rpc_manager.get_rpc_url = lambda chain: ANVIL
    settings.relay_app_fee_recipient = None  # keep the quote minimal

    engine = SwapEngine()
    wallet_service = engine.wallet_service
    wallet = await wallet_service.create_wallet(user_id=424242, name="relay-fork-test", chain_type="evm")
    addr = Web3.to_checksum_address(wallet.address)
    print("test wallet", addr)

    # Fund: 1 ETH from thin air, 100 USDC from Relay's own solver inventory (impersonated on the fork).
    rpc("anvil_setBalance", [addr, hex(10**18)])
    rpc("anvil_impersonateAccount", [RELAY_SOLVER])
    rpc("anvil_setBalance", [RELAY_SOLVER, hex(10**18)])
    usdc = w3.eth.contract(address=Web3.to_checksum_address(BASE_USDC), abi=ERC20_ABI)
    data = usdc.encode_abi("transfer", args=[addr, 100_000_000])
    h = rpc("eth_sendTransaction", [{"from": RELAY_SOLVER, "to": BASE_USDC, "data": data, "gas": hex(100000)}])
    w3.eth.wait_for_transaction_receipt(h, timeout=60)
    rpc("anvil_stopImpersonatingAccount", [RELAY_SOLVER])
    print("funded: ETH", w3.eth.get_balance(addr) / 1e18, "USDC", usdc.functions.balanceOf(addr).call() / 1e6)

    wallet_data = {"id": wallet.id, "address": addr, "user_id": 424242}
    results = []

    async def run_case(label, from_token, to_token, amount_h, amount_raw, native):
        t0 = time.time()
        quote = await engine._get_relay_quote(
            "base", "arbitrum", from_token, to_token, amount_h, amount_raw, addr, None, 0.5
        )
        print(f"\n[{label}] LIVE quote: out={quote.to_amount_human} min={quote.to_amount_min} "
              f"fee=${quote.fee_cost_usd:.4f} gas=${quote.gas_cost_usd:.4f} eta={quote.estimated_time}s "
              f"steps={[s['step_id'] for s in quote.raw_quote['steps']]}")
        dep_addr = Web3.to_checksum_address(quote.raw_quote["steps"][-1]["to"])
        dep_before = usdc.functions.balanceOf(dep_addr).call()
        tx_hash = await engine._execute_relay_swap(quote, wallet_data)
        rcpt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        topic = NATIVE_DEPOSIT_TOPIC if native else ERC20_DEPOSIT_TOPIC
        logs = [l for l in rcpt["logs"] if l["topics"] and l["topics"][0].hex().lower().replace("0x", "") == topic.lower().replace("0x", "")]
        request_id = quote.raw_quote.get("request_id")
        emitted_id = logs[0]["data"][-32:].hex() if logs else None
        ok = rcpt["status"] == 1 and len(logs) == 1
        dep_after = usdc.functions.balanceOf(dep_addr).call()
        info = {
            "case": label, "deposit_tx": tx_hash, "status": rcpt["status"], "gas_used": rcpt["gasUsed"],
            "to": rcpt["to"], "deposit_event": bool(logs), "request_id": request_id,
            "emitted_deposit_order_id": emitted_id,  # protocol order id, not the API requestId
            "usdc_moved_to_depository": (dep_after - dep_before) / 1e6, "elapsed_s": round(time.time() - t0, 1),
        }
        print(f"[{label}] RESULT {json.dumps(info)}")
        results.append(info)
        return ok

    ok1 = await run_case("native ETH 0.01 Base->Arbitrum", "ETH", "ETH", 0.01, str(10**16), native=True)
    ok2 = await run_case("USDC 25 Base->Arbitrum", "USDC", "USDC", 25.0, "25000000", native=False)
    # After the ERC-20 case the approval must be fully consumed (no lingering allowance).
    dep = results[-1]["to"]
    allowance = usdc.functions.allowance(addr, Web3.to_checksum_address(dep)).call()
    print("residual allowance to depository:", allowance)
    results.append({"residual_allowance": allowance, "wallet": addr})
    out = "/home/user/suwappubot/docs/research/relay/probe/fork-exec-result.json"
    json.dump(results, open(out, "w"), indent=1)
    print("\nOVERALL:", "PASS" if (ok1 and ok2 and allowance == 0) else "FAIL")
    return 0 if (ok1 and ok2 and allowance == 0) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
