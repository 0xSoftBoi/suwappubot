#!/usr/bin/env python3
"""Integration test for Stargate V2 smart contracts.

Self-contained — no project imports, just web3. Tests:
1. RPC connectivity for each chain
2. Pool contract code verification
3. quoteSend() on-chain fee quotes
4. Token balances (with --address)
5. Dry-run transaction build (with --dry-run)

Usage:
    python scripts/test_stargate.py
    python scripts/test_stargate.py --address 0xYourAddress
    python scripts/test_stargate.py --route base:ethereum:USDC
    python scripts/test_stargate.py --dry-run --address 0x... --route base:ethereum:USDC --amount 2.5
"""

import sys
import argparse
from web3 import Web3

# ─── Config (mirrored from project, standalone) ───────────────────────────

RPC_URLS = {
    "ethereum": "https://eth.llamarpc.com",
    "arbitrum": "https://arb1.arbitrum.io/rpc",
    "optimism": "https://mainnet.optimism.io",
    "base": "https://mainnet.base.org",
    "polygon": "https://polygon.drpc.org",
    "bsc": "https://bsc-dataseed.binance.org",
    "avalanche": "https://api.avax.network/ext/bc/C/rpc",
    "linea": "https://rpc.linea.build",
    "mantle": "https://rpc.mantle.xyz",
}

LZ_ENDPOINT_IDS = {
    "ethereum": 30101, "bsc": 30102, "avalanche": 30106,
    "polygon": 30109, "arbitrum": 30110, "optimism": 30111,
    "base": 30184, "linea": 30183, "mantle": 30181,
}

STARGATE_V2_POOLS = {
    "ethereum": {
        "USDC": "0xc026395860Db2d07ee33e05fE50ed7bD583189C7",
        "USDT": "0x933597a323Eb81cAe705C5bC29985172fd5A3973",
        "ETH":  "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931",
    },
    "arbitrum": {
        "USDC": "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3",
        "USDT": "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0",
        "ETH":  "0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F",
    },
    "optimism": {
        "USDC": "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0",
        "USDT": "0x19cFCE47eD54a88614648DC3f19A5980097007dD",
        "ETH":  "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3",
    },
    "base": {
        "USDC": "0x27a16dc786820B16E5c9028b75B99F6f604b5d26",
        "ETH":  "0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7",
    },
    "polygon": {
        "USDC": "0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4",
        "USDT": "0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7",
    },
    "bsc": {
        "USDT": "0x138EB30f73BC423c6455C53df6D89CB01d9eBc63",
    },
    "avalanche": {
        "USDC": "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47",
        "USDT": "0x12dC9256Acc9895B076f6638D628382881e62CeE",
    },
    "linea": {
        "ETH": "0x81F6138153d473E8c5EcebD3DC8Cd4903506B075",
    },
    "mantle": {
        "USDC": "0xAc290Ad4e0c891FDc295ca4F0a6214cf6dC6acDC",
        "USDT": "0xB715B85682B731dB9D5063187C450095c91C57FC",
        "ETH":  "0x4c1d3Fc3fC3c177c3b633427c2F769276c547463",
    },
}

# Token addresses per chain (USDC, USDT — the actual ERC20 token, not the pool)
TOKEN_ADDRESSES = {
    "USDC": {
        "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        "base":     "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "polygon":  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        "avalanche":"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        "mantle":   "0x09Bc4E0D10C13DA4AC25D3aDB9a3559b5B25Fc50",
    },
    "USDT": {
        "ethereum": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "arbitrum": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "optimism": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        "polygon":  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "bsc":      "0x55d398326f99059fF775485246999027B3197955",
        "avalanche":"0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
        "mantle":   "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE",
    },
}

TOKEN_DECIMALS = {
    "USDC": 6, "USDT": 6, "ETH": 18,
}

# Overrides for chains where decimals differ
DECIMAL_OVERRIDES = {
    ("USDC", "bsc"): 18,
    ("USDT", "bsc"): 18,
}

STARGATE_SEND_ABI = [
    {
        "inputs": [
            {"components": [
                {"name": "dstEid", "type": "uint32"},
                {"name": "to", "type": "bytes32"},
                {"name": "amountLD", "type": "uint256"},
                {"name": "minAmountLD", "type": "uint256"},
                {"name": "extraOptions", "type": "bytes"},
                {"name": "composeMsg", "type": "bytes"},
                {"name": "oftCmd", "type": "bytes"},
            ], "name": "_sendParam", "type": "tuple"},
            {"components": [
                {"name": "nativeFee", "type": "uint256"},
                {"name": "lzTokenFee", "type": "uint256"},
            ], "name": "_fee", "type": "tuple"},
            {"name": "_refundAddress", "type": "address"},
        ],
        "name": "sendToken",
        "outputs": [{"components": [
            {"name": "guid", "type": "bytes32"},
            {"name": "nonce", "type": "uint64"},
            {"components": [
                {"name": "nativeFee", "type": "uint256"},
                {"name": "lzTokenFee", "type": "uint256"},
            ], "name": "fee", "type": "tuple"},
        ], "name": "", "type": "tuple"}],
        "stateMutability": "payable",
        "type": "function",
    },
    {
        "inputs": [
            {"components": [
                {"name": "dstEid", "type": "uint32"},
                {"name": "to", "type": "bytes32"},
                {"name": "amountLD", "type": "uint256"},
                {"name": "minAmountLD", "type": "uint256"},
                {"name": "extraOptions", "type": "bytes"},
                {"name": "composeMsg", "type": "bytes"},
                {"name": "oftCmd", "type": "bytes"},
            ], "name": "_sendParam", "type": "tuple"},
            {"name": "_payInLzToken", "type": "bool"},
        ],
        "name": "quoteSend",
        "outputs": [{"components": [
            {"name": "nativeFee", "type": "uint256"},
            {"name": "lzTokenFee", "type": "uint256"},
        ], "name": "", "type": "tuple"}],
        "stateMutability": "view",
        "type": "function",
    },
]

ERC20_ABI = [
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

NATIVE_PRICES = {
    "ethereum": 2000, "polygon": 0.8, "bsc": 300,
    "arbitrum": 2000, "optimism": 2000, "base": 2000,
    "avalanche": 35, "linea": 2000, "mantle": 0.5,
}

# ─── Helpers ──────────────────────────────────────────────────────────────

G = "\033[92m"; R = "\033[91m"; Y = "\033[93m"; C = "\033[96m"; B = "\033[1m"; X = "\033[0m"

def ok(msg):   print(f"  {G}✓{X} {msg}")
def fail(msg): print(f"  {R}✗{X} {msg}")
def warn(msg): print(f"  {Y}⚠{X} {msg}")
def header(msg):
    print(f"\n{B}{C}{'='*60}{X}")
    print(f"{B}{C}  {msg}{X}")
    print(f"{B}{C}{'='*60}{X}")

def get_decimals(token, chain):
    return DECIMAL_OVERRIDES.get((token, chain), TOKEN_DECIMALS.get(token, 18))

def get_web3(chain):
    url = RPC_URLS.get(chain)
    if not url:
        raise ValueError(f"No RPC for {chain}")
    return Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 15}))

# ─── Tests ────────────────────────────────────────────────────────────────

def test_rpc():
    header("1. RPC Connectivity")
    results = {}
    for chain in STARGATE_V2_POOLS:
        url = RPC_URLS.get(chain, "MISSING")
        try:
            w3 = get_web3(chain)
            block = w3.eth.block_number
            ok(f"{chain:12s} block #{block:,}  ({url[:55]})")
            results[chain] = True
        except Exception as e:
            fail(f"{chain:12s} {e}")
            results[chain] = False
    return results

def test_pools(rpc_ok):
    header("2. Pool Contract Verification")
    results = {}
    for chain, pools in STARGATE_V2_POOLS.items():
        if not rpc_ok.get(chain):
            warn(f"{chain}: skipped"); continue
        w3 = get_web3(chain)
        for token, addr in pools.items():
            try:
                code = w3.eth.get_code(Web3.to_checksum_address(addr))
                if len(code) > 2:
                    ok(f"{chain:12s} {token:5s} {addr}  ({len(code)} bytes)")
                    results[(chain, token)] = True
                else:
                    fail(f"{chain:12s} {token:5s} {addr}  NO CODE")
                    results[(chain, token)] = False
            except Exception as e:
                fail(f"{chain:12s} {token:5s} {e}")
                results[(chain, token)] = False
    return results

def test_quotes(rpc_ok, specific=None):
    header("3. quoteSend() Fee Quotes")
    routes = []
    if specific:
        s, d, t = specific.split(":")
        routes.append((s, d, t))
    else:
        candidates = [
            ("base", "ethereum", "USDC"), ("base", "arbitrum", "USDC"),
            ("ethereum", "base", "USDC"), ("ethereum", "arbitrum", "USDC"),
            ("arbitrum", "base", "USDC"), ("ethereum", "base", "ETH"),
            ("base", "ethereum", "ETH"), ("polygon", "ethereum", "USDC"),
            ("ethereum", "polygon", "USDT"), ("avalanche", "ethereum", "USDC"),
        ]
        for s, d, t in candidates:
            if STARGATE_V2_POOLS.get(s, {}).get(t) and STARGATE_V2_POOLS.get(d, {}).get(t):
                routes.append((s, d, t))

    results = {}
    for src, dst, token in routes:
        if not rpc_ok.get(src):
            warn(f"{src}→{dst} {token}: skipped"); continue

        w3 = get_web3(src)
        pool_addr = STARGATE_V2_POOLS[src][token]
        dst_eid = LZ_ENDPOINT_IDS[dst]
        decimals = get_decimals(token, src)

        amount = (10 * 10**decimals) if token in ("USDC", "USDT") else int(0.01 * 10**decimals)
        min_amt = int(amount * 0.995)
        dummy = "0x0000000000000000000000000000000000000001"
        to_b32 = Web3.to_bytes(hexstr=dummy).rjust(32, b'\x00')
        send_param = (dst_eid, to_b32, amount, min_amt, b"", b"", b"")

        try:
            pool = w3.eth.contract(address=Web3.to_checksum_address(pool_addr), abi=STARGATE_SEND_ABI)
            fee = pool.functions.quoteSend(send_param, False).call()
            native_fee = fee[0]
            fee_eth = float(w3.from_wei(native_fee, "ether"))
            usd = fee_eth * NATIVE_PRICES.get(src, 2000)
            human = amount / 10**decimals
            ok(f"{src:12s} → {dst:12s}  {human} {token:5s}  fee: {fee_eth:.6f} (≈${usd:.2f})")
            results[(src, dst, token)] = {"fee_wei": native_fee, "fee_usd": usd}
        except Exception as e:
            fail(f"{src:12s} → {dst:12s}  {token:5s}  {e}")
            results[(src, dst, token)] = None
    return results

def test_balances(address, rpc_ok):
    header("4. Token Balances")
    for chain, pools in STARGATE_V2_POOLS.items():
        if not rpc_ok.get(chain):
            warn(f"{chain}: skipped"); continue
        w3 = get_web3(chain)
        try:
            nb = float(w3.from_wei(w3.eth.get_balance(Web3.to_checksum_address(address)), "ether"))
            (ok if nb > 0 else warn)(f"{chain:12s} native: {nb:.6f}")
        except Exception as e:
            fail(f"{chain:12s} native: {e}")

        for token in pools:
            if token == "ETH": continue
            addr = TOKEN_ADDRESSES.get(token, {}).get(chain)
            if not addr: continue
            try:
                c = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ERC20_ABI)
                bal = c.functions.balanceOf(Web3.to_checksum_address(address)).call()
                dec = get_decimals(token, chain)
                h = bal / 10**dec
                (ok if h > 0 else (lambda m: print(f"  - {m}")))(f"{chain:12s} {token:5s}: {h:.4f}")
            except Exception as e:
                fail(f"{chain:12s} {token:5s}: {e}")

def test_dry_run(address, route, amount, rpc_ok):
    header("5. Dry-Run Transaction Build")
    src, dst, token = route.split(":")
    if not rpc_ok.get(src): fail(f"{src} offline"); return

    w3 = get_web3(src)
    pool_addr = STARGATE_V2_POOLS.get(src, {}).get(token)
    dst_eid = LZ_ENDPOINT_IDS.get(dst)
    if not pool_addr: fail(f"No pool for {token} on {src}"); return
    if not dst_eid: fail(f"No LZ eid for {dst}"); return

    dec = get_decimals(token, src)
    amt = int(amount * 10**dec)
    min_amt = int(amt * 0.995)
    to_b32 = Web3.to_bytes(hexstr=address).rjust(32, b'\x00')
    send_param = (dst_eid, to_b32, amt, min_amt, b"", b"", b"")
    pool = w3.eth.contract(address=Web3.to_checksum_address(pool_addr), abi=STARGATE_SEND_ABI)

    try:
        fee = pool.functions.quoteSend(send_param, False).call()
        native_fee = fee[0]
        ok(f"quoteSend → fee: {float(w3.from_wei(native_fee, 'ether')):.6f} native")
    except Exception as e:
        fail(f"quoteSend: {e}"); return

    if token != "ETH":
        taddr = TOKEN_ADDRESSES.get(token, {}).get(src)
        if taddr:
            tc = w3.eth.contract(address=Web3.to_checksum_address(taddr), abi=ERC20_ABI)
            bal = tc.functions.balanceOf(Web3.to_checksum_address(address)).call()
            h = bal / 10**dec
            (ok if bal >= amt else fail)(f"Balance: {h:.4f} {token} (need {amount})")

    nb = w3.eth.get_balance(Web3.to_checksum_address(address))
    needed = native_fee + w3.to_wei(0.002, "ether") + (amt if token == "ETH" else 0)
    (ok if nb >= needed else fail)(f"Gas: {float(w3.from_wei(nb, 'ether')):.6f} (need ≈{float(w3.from_wei(needed, 'ether')):.6f})")

    if token != "ETH":
        taddr = TOKEN_ADDRESSES.get(token, {}).get(src)
        if taddr:
            tc = w3.eth.contract(address=Web3.to_checksum_address(taddr), abi=ERC20_ABI)
            ad = tc.encodeABI(fn_name="approve", args=[Web3.to_checksum_address(pool_addr), amt])
            ok(f"approve tx: {taddr[:16]}... → {pool_addr[:16]}...")

    fee_tuple = (native_fee, 0)
    sd = pool.encodeABI(fn_name="sendToken", args=[send_param, fee_tuple, Web3.to_checksum_address(address)])
    ok(f"sendToken tx: {pool_addr[:16]}... value={native_fee} wei")
    print(f"\n  {B}{G}✓ Dry run complete — ready to sign & send{X}")

# ─── Main ─────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Test Stargate V2 integration")
    p.add_argument("--address", help="Wallet address for balance checks")
    p.add_argument("--route", help="src:dst:token (e.g. base:ethereum:USDC)")
    p.add_argument("--amount", type=float, help="Amount for dry-run")
    p.add_argument("--dry-run", action="store_true", help="Build tx without sending")
    args = p.parse_args()

    print(f"\n{B}Stargate V2 Integration Test{X}")

    rpc_ok = test_rpc()
    pool_ok = test_pools(rpc_ok)
    quote_ok = test_quotes(rpc_ok, args.route)

    if args.address:
        test_balances(args.address, rpc_ok)
    if args.dry_run and args.address and args.route and args.amount:
        test_dry_run(args.address, args.route, args.amount, rpc_ok)

    header("Summary")
    ro = sum(v for v in rpc_ok.values()); rt = len(rpc_ok)
    po = sum(v for v in pool_ok.values()); pt = len(pool_ok)
    qo = sum(1 for v in quote_ok.values() if v); qt = len(quote_ok)
    print(f"  RPCs:   {ro}/{rt}")
    print(f"  Pools:  {po}/{pt}")
    print(f"  Quotes: {qo}/{qt}")
    ok("ALL PASSED") if ro==rt and po==pt and qo==qt else fail("Some failures")
    return 0 if ro==rt and po==pt and qo==qt else 1

if __name__ == "__main__":
    sys.exit(main())
