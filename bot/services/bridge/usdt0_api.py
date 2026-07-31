"""USDT0 (LayerZero-OFT canonical USDT) bridge provider.

USDT0 is a LayerZero Omnichain Fungible Token (OFT) wrapping of Tether's
original USDT liquidity: `send()` on the source chain burns (or, on Ethereum,
locks), `lzReceive()` on the destination chain mints — 1:1, no AMM pool, no
slippage. The only variable cost is the LayerZero messaging fee (native-gas +
optional OFT protocol fee), which `quoteSend()` returns before the user
commits.

VERIFIED facts (confirmed via direct JSON-RPC calls, 2026-07-30 — do not
extend beyond these without a source):
  - Every OFT address below was confirmed by calling `OFT.token()` on-chain
    and checking it returns exactly the paired token address, so the
    (token, oft) pairs are cross-verified, not merely copied from docs.
  - EIDs verified against LayerZero's official metadata API
    (https://metadata.layerzero-api.com/v1/metadata).
  - decimals = 6 on every chain listed (verified directly on
    arbitrum/plasma/hyperevm; the others follow the same USDT0 deployment).
  - Tron is NOT on USDT0 — it runs the original Tether TRC20 with a
    separate mint authority. Any Tron route must be rejected here.
  - `approvalRequired()` on-chain: satellite chains return `false` (native
    OFT mint/burn — no ERC20 approve needed before `send`). Ethereum's OFT
    is a LOCKBOX/adapter wrapping the real Tether USDT and returns `true`
    (an ERC20 approve to the lockbox IS required before `send`). See
    `OFT_ADDRESSES[...]["approval_required"]` — this asymmetry is load
    bearing: emitting an approve where none is needed wastes gas, and
    omitting it on Ethereum makes `send()` revert.
  - The token contracts are plain ERC-20s and do NOT expose send/quoteSend.
    Never call send()/quoteSend() on a token address — always the OFT
    address.

Default-OFF (see `USDT0_BRIDGE_ENABLED`): the wiring below is real and
quote-capable, but the provider stays disabled until explicitly flipped on
by whoever owns the rollout.
"""

import logging
from typing import Any, Dict, Optional

from web3 import Web3

from bot.config.settings import settings
from bot.services.bridge.base import (
    BridgeError,
    BridgeProvider,
    BridgeQuote,
    normalize_amount,
    validate_address_for_chain,
)

logger = logging.getLogger(__name__)

# Default-OFF: the address map and quoteSend()/send() wiring below are real and
# verified (see module docstring), but the provider stays disabled until
# explicitly flipped on.
#
# `settings.usdt0_bridge_enabled` is the single source of truth, so this can be
# turned on per environment without a code change. The module-level alias is
# kept because it is read once at import (consistent with how the rest of the
# repo treats Settings) and because it is a convenient patch point in tests.
USDT0_BRIDGE_ENABLED = settings.usdt0_bridge_enabled

# LayerZero fees track destination gas at delivery time, not at quote time --
# quoteSend() is a snapshot. Buffering the `value` we actually send protects
# the tx from reverting if gas moves between quote and signature; the buffer
# is free because `_refundAddress` is already `from_address` (see get_quote)
# and LayerZero refunds any surplus native automatically.
NATIVE_FEE_BUFFER_BPS = 1_750  # 17.5% headroom, mid of the requested 15-20% range

# Hard ceiling on the native value a single USDT0 send() may attach. quoteSend()
# is a view call on the OFT contract we trust, but nothing otherwise bounds what
# it returns -- a wrong/compromised OFT could report an absurd fee and drain the
# user's whole native balance into `value`.
#
# Denominated in USD, not native units. A fixed native-unit ceiling is
# meaningless across chains: 0.05 is ~$150 of ETH but ~a cent of XPL, so the
# original 0.05-native bound passed on Ethereum and rejected every legitimate
# Plasma quote (measured: a real plasma->arbitrum fee buffers to ~1.24 XPL).
# Generous on purpose. Real LayerZero fees are normally cents to low dollars,
# but an expensive corridor during a gas spike can legitimately reach tens of
# dollars, so the bound is set well clear of that: it exists to catch an absurd
# quote (a wrong or compromised OFT reporting orders of magnitude too much), not
# to price-protect the user against a genuinely expensive route. Rejecting a
# real fee would look like "no route available", which is its own harm.
NATIVE_FEE_CEILING_USD = 100.0

# Fallback bound, in native units, used only when the native token cannot be
# priced. Without a price we cannot apply the USD ceiling, and blocking every
# quote during a price-service outage would be a worse failure than a loose
# bound -- but leaving `value` completely unbounded is not acceptable either.
NATIVE_FEE_CEILING_UNPRICED_UNITS = 5.0

# Chain -> {token, oft, eid, decimals, approval_required}.
#
# verified on-chain 2026-07-30, OFT.token() cross-checked against `token` for
# every entry below (satellite chains) plus the Ethereum lockbox.
#
#   - "token": the plain ERC-20 USDT/USDT0 address on that chain.
#   - "oft": the LayerZero V2 OFT contract — the ONLY address `send`/
#     `quoteSend` may be called on. Never the token address.
#   - "eid": LayerZero V2 endpoint ID for that chain.
#   - "approval_required": whether an ERC20 `approve(oft, amount)` on `token`
#     must be sent before `send()`. False on every satellite chain (native
#     OFT mint/burn, verified via `approvalRequired() == 0`); True only on
#     Ethereum (lockbox/adapter locking real Tether USDT, verified via
#     `approvalRequired() == 1`).
OFT_ADDRESSES: Dict[str, Dict[str, Any]] = {
    "arbitrum": {
        "token": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "oft": "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92",
        "eid": 30110,
        "decimals": 6,
        "approval_required": False,
    },
    "plasma": {
        "token": "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
        "oft": "0x02ca37966753bDdDf11216B73B16C1dE756A7CF9",
        "eid": 30383,
        "decimals": 6,
        "approval_required": False,
    },
    "hyperevm": {
        "token": "0xB8CE59FC3717ada4c02eaDF9682a9e934F625ebb",
        "oft": "0x904861a24F30EC96ea7CFC3bE9EA4B476d237e98",
        "eid": 30367,
        "decimals": 6,
        "approval_required": False,
    },
    "ink": {
        "token": "0x0200C29006150606B650577BBE7B6248F58470c1",
        "oft": "0x1cB6De532588fCA4a21B7209DE7C456AF8434A65",
        "eid": 30339,
        "decimals": 6,
        "approval_required": False,
    },
    "unichain": {
        "token": "0x9151434b16b9763660705744891fA906F660EcC5",
        "oft": "0xc07bE8994D035631c36fb4a89C918CeFB2f03EC3",
        "eid": 30320,
        "decimals": 6,
        "approval_required": False,
    },
    "berachain": {
        "token": "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
        "oft": "0x3Dc96399109df5ceb2C226664A086140bD0379cB",
        "eid": 30362,
        "decimals": 6,
        "approval_required": False,
    },
    "flare": {
        "token": "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
        "oft": "0x567287d2A9829215a37e3B88843d32f9221E7588",
        "eid": 30295,
        "decimals": 6,
        "approval_required": False,
    },
    "ethereum": {
        # Real Tether USDT — locked, not minted/burned.
        "token": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        # LOCKBOX adapter. approvalRequired() == 1 on this chain only.
        "oft": "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee",
        "eid": 30101,
        "decimals": 6,
        "approval_required": True,
    },
}

# Chains confirmed to have a USDT0 OFT deployment (per verified facts above).
# Kept in sync with OFT_ADDRESSES.keys() — separate set only so
# is_supported_route reads cleanly against the "is the token live here at
# all" question.
USDT0_SUPPORTED_CHAINS = set(OFT_ADDRESSES.keys())

# Minimal LayerZero V2 OFT ABI: only what we call.
OFT_ABI = [
    {
        "inputs": [
            {
                "components": [
                    {"name": "dstEid", "type": "uint32"},
                    {"name": "to", "type": "bytes32"},
                    {"name": "amountLD", "type": "uint256"},
                    {"name": "minAmountLD", "type": "uint256"},
                    {"name": "extraOptions", "type": "bytes"},
                    {"name": "composeMsg", "type": "bytes"},
                    {"name": "oftCmd", "type": "bytes"},
                ],
                "name": "_sendParam",
                "type": "tuple",
            },
            {"name": "_payInLzToken", "type": "bool"},
        ],
        "name": "quoteSend",
        "outputs": [
            {
                "components": [
                    {"name": "nativeFee", "type": "uint256"},
                    {"name": "lzTokenFee", "type": "uint256"},
                ],
                "name": "",
                "type": "tuple",
            },
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {
                "components": [
                    {"name": "dstEid", "type": "uint32"},
                    {"name": "to", "type": "bytes32"},
                    {"name": "amountLD", "type": "uint256"},
                    {"name": "minAmountLD", "type": "uint256"},
                    {"name": "extraOptions", "type": "bytes"},
                    {"name": "composeMsg", "type": "bytes"},
                    {"name": "oftCmd", "type": "bytes"},
                ],
                "name": "_sendParam",
                "type": "tuple",
            },
            {
                "components": [
                    {"name": "nativeFee", "type": "uint256"},
                    {"name": "lzTokenFee", "type": "uint256"},
                ],
                "name": "_fee",
                "type": "tuple",
            },
            {"name": "_refundAddress", "type": "address"},
        ],
        "name": "send",
        "outputs": [
            {
                "components": [
                    {"name": "guid", "type": "bytes32"},
                    {"name": "nonce", "type": "uint64"},
                    {
                        "components": [
                            {"name": "nativeFee", "type": "uint256"},
                            {"name": "lzTokenFee", "type": "uint256"},
                        ],
                        "name": "fee",
                        "type": "tuple",
                    },
                ],
                "name": "",
                "type": "tuple",
            },
        ],
        "stateMutability": "payable",
        "type": "function",
    },
]

# Minimal ERC20 approve ABI, reused for the Ethereum lockbox leg only.
ERC20_APPROVE_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


class USDT0Error(BridgeError):
    """Exception for USDT0 (LayerZero OFT) bridge errors."""


def _to_bytes32(address: str) -> bytes:
    """Left-pad an EVM address to 32 bytes for LayerZero's `to` field.

    Classic fund-losing bug if done wrong: LayerZero decodes the low 20
    bytes of `to` as the recipient EVM address, so the address MUST be
    right-aligned (left-padded with zero bytes), not left-aligned.
    """
    return Web3.to_bytes(hexstr=Web3.to_checksum_address(address)).rjust(32, b"\x00")


class USDT0Bridge(BridgeProvider):
    """Client for the USDT0 LayerZero-OFT canonical USDT bridge."""

    @property
    def name(self) -> str:
        return "usdt0"

    @property
    def enabled(self) -> bool:
        # Default OFF (see USDT0_BRIDGE_ENABLED docstring). Even if flipped
        # on, individual routes still gate on OFT_ADDRESSES having both legs
        # configured in get_quote/is_supported_route.
        return USDT0_BRIDGE_ENABLED

    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        from_chain = from_chain.lower()
        to_chain = to_chain.lower()

        if from_chain == to_chain:
            return False
        if token is not None and token.upper() not in ("USDT", "USDT0"):
            return False
        # Tron is never on USDT0 — original TRC20 USDT with a separate mint
        # authority. Reject explicitly rather than relying on chain-set
        # membership alone, so this stays correct even if "tron" is ever
        # accidentally added to USDT0_SUPPORTED_CHAINS.
        if from_chain == "tron" or to_chain == "tron":
            return False
        if from_chain not in USDT0_SUPPORTED_CHAINS or to_chain not in USDT0_SUPPORTED_CHAINS:
            return False
        # Both legs need a verified contract address configured; an empty
        # OFT_ADDRESSES means no route is actually quotable yet.
        return from_chain in OFT_ADDRESSES and to_chain in OFT_ADDRESSES

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        if slippage_bps <= 0:
            raise USDT0Error("slippage_bps must be > 0")
        if not self.enabled:
            return None
        if not self.is_supported_route(from_chain, to_chain, from_token):
            return None

        from_chain = from_chain.lower()
        to_chain = to_chain.lower()

        to_address = to_address or from_address
        if not validate_address_for_chain(to_address, to_chain):
            logger.warning(
                f"USDT0: destination address failed format validation for chain {to_chain!r}"
            )
            return None
        if not validate_address_for_chain(from_address, from_chain):
            logger.warning(
                f"USDT0: source address failed format validation for chain {from_chain!r}"
            )
            return None

        try:
            amount = normalize_amount(from_amount)
        except ValueError as e:
            raise USDT0Error(f"Invalid from_amount: {e}") from e

        amount_int = int(amount)
        if amount_int <= 0:
            return None

        src = OFT_ADDRESSES[from_chain]
        dst = OFT_ADDRESSES[to_chain]

        # USDT0 is a 1:1 mint/burn (or lock/mint on the Ethereum leg) OFT —
        # there is no AMM/pool slippage. We still set a real, conservative
        # floor from slippage_bps using integer math; never fabricate an
        # output amount better than the input.
        min_amount_ld = amount_int - (amount_int * slippage_bps) // 10000
        if min_amount_ld > amount_int:
            min_amount_ld = amount_int
        if min_amount_ld < 0:
            min_amount_ld = 0

        try:
            to_bytes32 = _to_bytes32(to_address)
        except Exception as e:
            logger.warning(f"USDT0: failed to pad recipient {to_address!r} to bytes32: {e}")
            return None

        send_param = (
            dst["eid"],
            to_bytes32,
            amount_int,
            min_amount_ld,
            b"",  # extraOptions — empty = default LZ executor gas config
            b"",  # composeMsg
            b"",  # oftCmd — empty = default (taxi) mode
        )

        try:
            from bot.services.rpc_manager import rpc_manager

            web3 = rpc_manager.get_web3(from_chain)
            oft = web3.eth.contract(
                address=Web3.to_checksum_address(src["oft"]),
                abi=OFT_ABI,
            )
            fee = oft.functions.quoteSend(send_param, False).call()
            native_fee = int(fee[0])
        except Exception as e:
            # Fail closed: never guess a messaging fee. A wrong/low fee
            # makes `send()` revert or, worse, gets executed with an
            # under-priced value the LZ executor never delivers.
            logger.warning(
                f"USDT0: quoteSend failed for {from_chain}->{to_chain} " f"(oft={src['oft']}): {e}"
            )
            return None

        # Buffer the value we actually attach so a gas-price move between
        # quote and signature doesn't revert send() -- the surplus is
        # refunded automatically by LayerZero (_refundAddress=from_address).
        buffered_fee = (native_fee * (10_000 + NATIVE_FEE_BUFFER_BPS)) // 10_000

        buffered_fee_native = float(web3.from_wei(buffered_fee, "ether"))

        # Price the fee once: it serves both the safety ceiling below and the
        # honest cost reported on the quote (router.py subtracts it from
        # net_output_usd, so a zero here would make USDT0 look free).
        gas_cost_usd = 0.0
        native_price = 0.0
        try:
            from bot.config.chains import get_chain_by_name
            from bot.services.price_service import price_service

            native_symbol = get_chain_by_name(from_chain).native_token
            prices = await price_service.get_prices([native_symbol])
            native_price = float(prices.get(native_symbol, 0) or 0)
            gas_cost_usd = buffered_fee_native * native_price
        except Exception as e:  # noqa: BLE001 — the on-chain `value` is unaffected
            logger.warning(
                f"USDT0: failed to price native_fee to USD for {from_chain}->{to_chain}: {e}"
            )

        # Fail closed on an absurd/compromised quote rather than attaching an
        # unbounded amount of the user's native balance as `value`. Compared in
        # USD, because a native-unit bound cannot be right for both ETH and XPL.
        if native_price > 0:
            if gas_cost_usd > NATIVE_FEE_CEILING_USD:
                logger.warning(
                    f"USDT0: quoteSend fee for {from_chain}->{to_chain} (oft={src['oft']}) "
                    f"buffers to ${gas_cost_usd:.2f}, above the ${NATIVE_FEE_CEILING_USD} "
                    "ceiling -- refusing to quote (likely a broken or compromised OFT/quote "
                    "path, not a real fee)."
                )
                return None
        elif buffered_fee_native > NATIVE_FEE_CEILING_UNPRICED_UNITS:
            # Unpriced: a loose native bound still beats leaving `value` open.
            logger.warning(
                f"USDT0: quoteSend fee for {from_chain}->{to_chain} (oft={src['oft']}) "
                f"buffers to {buffered_fee_native:.6f} native units and the native token "
                f"could not be priced, above the {NATIVE_FEE_CEILING_UNPRICED_UNITS}-unit "
                "unpriced ceiling -- refusing to quote."
            )
            return None

        try:
            send_data = oft.encode_abi(
                "send",
                args=[send_param, (native_fee, 0), Web3.to_checksum_address(from_address)],
            )
        except Exception as e:
            logger.warning(f"USDT0: failed to encode send() calldata: {e}")
            return None

        transaction_request: Dict[str, Any] = {
            "to": Web3.to_checksum_address(src["oft"]),
            "data": send_data,
            "value": buffered_fee,
        }

        # Approve is ONLY required on the Ethereum lockbox leg
        # (approvalRequired() == 1, verified on-chain). Satellite chains use
        # native OFT mint/burn — no ERC20 allowance exists to spend.
        if src["approval_required"]:
            try:
                token_contract = web3.eth.contract(
                    address=Web3.to_checksum_address(src["token"]),
                    abi=ERC20_APPROVE_ABI,
                )
                approve_data = token_contract.encode_abi(
                    "approve",
                    args=[Web3.to_checksum_address(src["oft"]), amount_int],
                )
                transaction_request["approval_tx"] = {
                    "to": Web3.to_checksum_address(src["token"]),
                    "data": approve_data,
                    "value": 0,
                }
            except Exception as e:
                logger.warning(f"USDT0: failed to encode approve() calldata: {e}")
                return None

        return BridgeQuote(
            provider=self.name,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=from_token,
            from_amount=amount,
            # 1:1 mint/burn: output never exceeds input.
            to_amount=amount,
            to_amount_min=str(min_amount_ld),
            # There is no separate protocol fee here -- the entire cost is the
            # LayerZero messaging fee, charged as native `value`. Reported as
            # gas_cost_usd (not fee_cost_usd) since it's paid identically to
            # gas: native currency, at broadcast time, not deducted from the
            # USDT amount. Either way it is now non-zero so router.py's
            # net_output_usd ranks this route honestly against alternatives.
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0.0,
            estimated_time=120,
            transaction_request=transaction_request,
            raw_response={
                "eid_src": src["eid"],
                "eid_dst": dst["eid"],
                "native_fee": str(native_fee),
                "native_fee_buffered": str(buffered_fee),
                "approval_required": src["approval_required"],
            },
            settlement="tx",
            trust_model="liquidity",
        )

    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """LayerZero message tracking is not implemented; callers should
        track the source-chain tx hash via LayerZero Scan instead.
        """
        return {"status": "UNKNOWN", "note": "Track via LayerZero Scan using the source tx hash."}


# Global instance
usdt0_api = USDT0Bridge()
