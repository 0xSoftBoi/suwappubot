"""Starknet mainnet contract addresses — all on-chain verified 2026-06-10.

Verified via starknet_getClassHashAt against Starknet mainnet RPC (see
docs/internal/plans/starknet-btc-neobank-plan.md). Phase 1 uses the AVNU exchange,
core tokens, and the Argent v0.4.0 class hash; Vesu/Endur entries are
included for later phases (3-4).
"""

AVNU_EXCHANGE = "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f"
STAKING_L2 = "0x00ca1702e64c81d9a07b86bd2c540188d92a2c73cf5cc0e508d949015e7e84a7"

ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"  # native Circle
USDT = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8"
WBTC = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac"
STRKBTC = (
    "0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135"  # 2 sources + on-chain
)
TBTC = "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f"
SOLVBTC = "0x0593e034dda23eea82d2ba9a30960ed42cf4a01502cc2351dc9b9881f9931a68"

# Endur LSTs (same class hash family; xstrkBTC single-sourced — re-verify on Voyager)
XSTRK = "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a"
XWBTC = "0x06a567e68c805323525fe1649adb80b03cddf92c23d2629a6779f54192dffc13"
XSTRKBTC = "0x047751b3532fABCa89B0f2E35cA1cB45e5A7b11d5e3D3663dfA1F4406b45FD88"

# Vesu Genesis pool vTokens (V1 singleton, from vesuxyz/changelog pools_sn_mainnet.json)
VESU_SINGLETON = "0x02545b2e5d519fc230e9cd781046d3a64e092114f07e44771e0d719d148725ef"
V_WBTC_GENESIS = "0x06b0ef784eb49c85f4d9447f30d7f7212be65ce1e553c18d516c87131e81dbd6"
V_USDC_GENESIS = "0x01610abab2ff987cdfb5e73cccbf7069cbb1a02bbfa5ee31d97cc30e29d89090"

# Vesu V2 (Re7-curated) vTokens — retrieved on-chain via PoolFactory.v_token_for_asset(pool, asset)
# (discovery: PoolFactory 0x3760f...88c0 is the sole vToken registry; pools themselves expose none)
V_USDC_RE7_CORE = "0x060e91c92fdad9e7245b9bb4e143b880e4e9354d0b95c5c2d33dc347dded3bf0"
V_WBTC_RE7_XBTC = "0x0131cc09160f144ec5880a0bc1a0633999030fa6a546388b5d0667cb171a52a0"
V_STRKBTC_RE7_XBTC = "0x04269987e8971bc613be4f8161e04a4d2652f5e6ade9aa3f2820b1fc3f7ef848"
# vTokens are full ERC-4626/SNIP-22 and the recommended surface (deposit() wraps modify_position).
# Note: vTokens are PER-POOL instances — same asset has different vTokens in different pools.

ARGENT_V040_CLASS_HASH = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f"
# constructor calldata: [0, owner_pubkey, 0]  (signer_type=Starknet, pubkey, guardian=None)
# Note: 0x01a736d... (previously considered) is Argent v0.3.0; OZ classes are NOT AVNU-whitelisted.
