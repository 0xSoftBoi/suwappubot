#!/usr/bin/env python3
"""End-to-end harness for the HyperLiquid funding rails (Across / HyperUnit / CCTP).

Validates that our request shapes match the *live* external APIs — the part that
unit tests (which mock HTTP) can't prove. The read-only tier hits real endpoints
but spends nothing; account/live tiers are opt-in and gated.

Usage:
    # Read-only — real Across quote, HyperUnit address gen, Circle CCTP fee/poll.
    # No key, no spend; proves the integrations are wired to the live contracts:
    python scripts/funding_e2e_test.py

    # Account reads for a funded (testnet) key — HL balances at the deposit target:
    FUNDING_E2E_PRIVATE_KEY=0x... python scripts/funding_e2e_test.py

    # Live write — generate a real HyperUnit deposit address you can actually
    # fund on testnet, and (with a relayer) watch it credit. Opt-in:
    FUNDING_E2E_PRIVATE_KEY=0x... FUNDING_E2E_WRITE=1 python scripts/funding_e2e_test.py

Notes:
  * Across Swap API + Circle CCTP target mainnet contracts; quoting is free and
    moves nothing. Set ACROSS_INTEGRATOR_ID / ACROSS_API_KEY for production limits.
  * HyperUnit endpoint defaults to mainnet; set HYPERUNIT_API_URL to the testnet
    host to generate testnet deposit addresses.
"""

import asyncio
import os
import sys

# Standalone env so importing bot.config.settings doesn't require a real deploy.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "e2e-token")
os.environ.setdefault("ENCRYPTION_KEY", "e2e-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/funding_e2e.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.services.across_api import across_api, ACROSS_TOKENS, AcrossError  # noqa: E402
from bot.services.hyperunit_api import hyperunit_api, HyperUnitError  # noqa: E402
from bot.services.cctp_hypercore import cctp_hypercore, CctpHyperCoreError  # noqa: E402

# A throwaway address used only as a quote/gen recipient (nothing is sent to it).
DUMMY_HL = "0x000000000000000000000000000000000000dEaD"
SRC_CHAIN = "arbitrum"


def _hdr(t):
    print(f"\n=== {t} ===")


async def across_quote() -> bool:
    _hdr("Across Swap API — HyperCore USDC deposit quote (10 USDC, no spend)")
    try:
        usdc = ACROSS_TOKENS["USDC"][SRC_CHAIN]
        q = await across_api.get_hypercore_usdc_deposit(
            from_chain=SRC_CHAIN,
            input_token_address=usdc,
            amount=str(10_000_000),  # 10 USDC (6dp)
            recipient=DUMMY_HL,
        )
        print(f"  expected out: ~{q.expected_output_human:.2f} USDC  fill~{q.estimated_fill_time}s")
        print(f"  approvals: {len(q.approval_txns)}  swap_tx.to: {q.swap_tx.get('to')}")
        ok = bool(q.swap_tx.get("to") and q.swap_tx.get("data"))
        print(f"  -> {'OK' if ok else 'FAIL (no swap tx)'}")
        return ok
    except AcrossError as e:
        print(f"  Across error (may need ACROSS_API_KEY / integrator id): {e}")
        return False


async def hyperunit_gen() -> bool:
    _hdr("HyperUnit — generate native deposit addresses (no spend)")
    ok = True
    for asset in ("btc", "eth"):
        try:
            d = await hyperunit_api.generate_deposit_address(asset, DUMMY_HL)
            sigs = len(d.signatures)
            print(f"  {asset.upper()}: {d.address}  guardians={sigs}  min={d.min_amount}")
            ok &= bool(d.address) and sigs >= 2
        except HyperUnitError as e:
            print(f"  {asset.upper()} error: {e}")
            ok = False
    print(f"  -> {'OK' if ok else 'FAIL'}")
    return ok


async def cctp_checks() -> bool:
    _hdr("Circle CCTP V2 — fee API + burn quote + attestation reachability")
    ok = True
    try:
        fee = await cctp_hypercore.get_fast_fee(SRC_CHAIN, 10_000_000)
        print(f"  fast fee for 10 USDC: {fee/1e6:.4f} USDC")
        q = await cctp_hypercore.quote_burn(SRC_CHAIN, 10.0, DUMMY_HL, fast=True)
        print(f"  burn_tx.to: {q.burn_tx.get('to')}  finality: {q.min_finality_threshold}")
        ok &= bool(q.burn_tx.get("data"))
        # Reachability of Iris V2 messages endpoint (fake tx -> pending, not error).
        att = await cctp_hypercore.get_attestation(
            SRC_CHAIN, "0x" + "00" * 32, max_attempts=1, poll_interval=0
        )
        print(f"  attestation poll (fake tx): status={att.status} (expected pending)")
    except CctpHyperCoreError as e:
        print(f"  CCTP error: {e}")
        ok = False
    print(f"  -> {'OK' if ok else 'FAIL'}")
    return ok


async def account_reads(address: str):
    _hdr(f"HL account reads for deposit target {address}")
    from bot.services.hyperliquid_client import HyperLiquidClient

    testnet = os.getenv("FUNDING_E2E_MAINNET") != "1"
    c = HyperLiquidClient(testnet=testnet)
    print(f"  perps value: ${await c.get_account_value(address):,.2f}")
    print(f"  spot value:  ${await c.get_spot_value_usd(address):,.2f}")
    await c.close()


async def live_write(address: str):
    _hdr("LIVE: real HyperUnit deposit address you can fund")
    host = os.getenv("HYPERUNIT_API_URL", hyperunit_api.api_url)
    print(f"  (HyperUnit host: {host})")
    d = await hyperunit_api.generate_deposit_address("btc", address)
    print(f"  Send testnet BTC to: {d.address}")
    print(f"  It will credit HyperCore spot for {address} (min {d.min_amount} BTC).")
    print("  Watch with: hyperunit_api.get_operation(<address>) or /fund → Check status.")


async def main():
    print("Funding rails E2E — read-only hits live APIs, spends nothing.")
    results = {
        "across": await across_quote(),
        "hyperunit": await hyperunit_gen(),
        "cctp": await cctp_checks(),
    }

    pk = os.getenv("FUNDING_E2E_PRIVATE_KEY")
    if pk:
        from eth_account import Account

        address = Account.from_key(pk).address
        await account_reads(address)
        if os.getenv("FUNDING_E2E_WRITE") == "1":
            await live_write(address)
    else:
        print("\n(set FUNDING_E2E_PRIVATE_KEY for account reads / a real deposit address)")

    print("\n=== SUMMARY ===")
    for name, ok in results.items():
        print(f"  {name:10s}: {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    asyncio.run(main())
