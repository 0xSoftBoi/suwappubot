"""Native P2P escrow executor — wires :class:`P2PEscrow` to the real on-chain path.

Custodial-during-trade model (the same shape NoOnes uses): the crypto leg is held
by a Suwappu-controlled EVM hot wallet (the "escrow wallet") for the trade window.

  - ``lock``    seller wallet ──USDC──▶ escrow wallet
                (built + signed via ``WalletService.sign_evm_transaction`` — handles
                 both Turnkey and locally-encrypted wallets transparently)
  - ``release`` escrow wallet ──USDC──▶ buyer
                (``HotWalletService.send_token`` — the same path as custodial payouts)
  - ``refund``  escrow wallet ──USDC──▶ seller (on cancel/timeout)

This reuses the exact build→sign→broadcast sequences already used by the savings
(Aave) flow and custodial withdrawals — no new signing code is introduced. A fully
trustless on-chain escrow *contract* is the future upgrade; this is the shippable
interim that makes native trades actually settle.

Escrow wallet selection: ``settings.p2p_escrow_hot_wallet_id`` if set, else the
primary active EVM deposit hot wallet. If neither exists the executor raises
``EscrowConfigError`` so a trade never silently "settles" without moving funds.
"""

import asyncio
import logging
from decimal import Decimal
from typing import Optional

from web3 import Web3

from bot.config.chains import get_chain_by_name
from bot.config.settings import settings
from bot.config.tokens import get_token_address, get_token_decimals
from bot.services.hot_wallet import hot_wallet_service
from bot.services.p2p_service import P2PError
from bot.services.rpc_manager import rpc_manager
from bot.services.wallet import WalletService

logger = logging.getLogger(__name__)

# Minimal ERC-20 transfer ABI (matches savings_service / hot_wallet usage).
_ERC20_TRANSFER_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    }
]


class EscrowConfigError(P2PError):
    """No usable Suwappu escrow hot wallet, or a misconfigured escrow request.

    Subclasses ``P2PError`` so handlers that already catch P2P errors surface a
    clean user-facing message instead of crashing.
    """


def _get_escrow_wallet():
    """Resolve the Suwappu-controlled EVM escrow hot wallet."""
    wallet_id = settings.p2p_escrow_hot_wallet_id
    if wallet_id:
        w = hot_wallet_service.get_hot_wallet_by_id(int(wallet_id))
        if w and w.is_active:
            return w
        logger.warning("P2P escrow hot wallet id %s not found/inactive", wallet_id)
    # Fall back to the primary active EVM deposit wallet.
    return hot_wallet_service.get_deposit_wallet("evm")


async def _lock_from_seller(
    seller_wallet_id: int, escrow_address: str, amount: Decimal, chain: str, token: str
) -> str:
    """Send ``amount`` of ``token`` from the seller's wallet into escrow. Returns tx hash."""
    ws = WalletService()
    wallet = ws.get_wallet_by_id(int(seller_wallet_id))
    if not wallet:
        raise EscrowConfigError(f"Seller wallet {seller_wallet_id} not found")

    token_address = get_token_address(token, chain)
    if not token_address:
        raise EscrowConfigError(f"{token} is not configured on {chain}")
    decimals = get_token_decimals(token, chain)
    chain_cfg = get_chain_by_name(chain)
    if not chain_cfg:
        raise EscrowConfigError(f"Unknown chain {chain}")
    amount_raw = int(amount * Decimal(10**decimals))
    web3 = rpc_manager.get_web3(chain)

    def _build() -> dict:
        usdc = web3.eth.contract(
            address=Web3.to_checksum_address(token_address), abi=_ERC20_TRANSFER_ABI
        )
        from_addr = Web3.to_checksum_address(wallet.address)
        fn = usdc.functions.transfer(Web3.to_checksum_address(escrow_address), amount_raw)
        tx = fn.build_transaction(
            {
                "from": from_addr,
                "nonce": web3.eth.get_transaction_count(from_addr),
                "gasPrice": web3.eth.gas_price,
                "chainId": chain_cfg.chain_id,
            }
        )
        tx["gas"] = int(web3.eth.estimate_gas(tx) * 1.2)
        return tx

    tx = await asyncio.to_thread(_build)
    # Signing routes to Turnkey or local key based on the wallet provider.
    signed_hex = await ws.sign_evm_transaction(wallet, tx)
    raw = bytes.fromhex(signed_hex.replace("0x", ""))

    def _broadcast() -> str:
        tx_hash = web3.eth.send_raw_transaction(raw)
        receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if receipt.get("status") != 1:
            raise EscrowConfigError(f"Escrow lock tx reverted on-chain: {tx_hash.hex()}")
        return tx_hash.hex()

    return await asyncio.to_thread(_broadcast)


async def p2p_escrow_executor(
    action: str,
    *,
    from_wallet_id: Optional[int] = None,
    to_address: Optional[str] = None,
    amount=None,
    chain: str = "base",
    token: str = "USDC",
) -> str:
    """Executor injected into ``P2PEscrow.set_executor``.

    Returns the on-chain tx hash. Raises ``EscrowConfigError`` on any
    misconfiguration so the trade state machine never advances on a non-trade.
    """
    amt = Decimal(str(amount))
    if amt <= 0:
        raise EscrowConfigError("Escrow amount must be positive")

    escrow = _get_escrow_wallet()
    if not escrow:
        raise EscrowConfigError(
            "No Suwappu escrow hot wallet configured. Set P2P_ESCROW_HOT_WALLET_ID "
            "or create an active EVM deposit hot wallet."
        )

    if action == "lock":
        if not from_wallet_id:
            raise EscrowConfigError("lock requires the seller's wallet id")
        return await _lock_from_seller(from_wallet_id, escrow.address, amt, chain, token)

    if action in ("release", "refund"):
        if not to_address:
            raise EscrowConfigError(f"{action} requires a destination address")
        token_address = get_token_address(token, chain)
        if not token_address:
            raise EscrowConfigError(f"{token} is not configured on {chain}")
        decimals = get_token_decimals(token, chain)
        # TODO(compliance): escrow refund leg needs defined unwind on block.
        # send_token screens ``to_address`` via
        # HotWalletService._assert_recipient_compliant and raises
        # ComplianceBlockedError on a hit. For "release" that's a clean
        # failure (the trade just doesn't pay out). For "refund" the funds
        # are already locked in escrow with no defined unwind path back to
        # the seller if the refund recipient itself is blocked — the P2P
        # trade state machine has no handling for that today. No behavior
        # change here; flagging so the unwind gets designed before it's hit
        # in practice.
        return await hot_wallet_service.send_token(
            escrow,
            chain,
            token_address,
            Web3.to_checksum_address(to_address),
            amt,
            decimals,
            memo=f"p2p-{action}",
        )

    raise EscrowConfigError(f"Unknown escrow action: {action}")


def wire_p2p_escrow() -> bool:
    """Attach the on-chain executor to the P2P escrow. Call once at startup.

    Returns True if an escrow wallet is available (escrow is live), False if not
    (executor is still attached, but lock/release will raise until a wallet
    exists — kept honest rather than silently no-op).
    """
    from bot.services.p2p_service import p2p_service

    p2p_service.escrow.set_executor(p2p_escrow_executor)
    available = _get_escrow_wallet() is not None
    if available:
        logger.info("✓ P2P native escrow executor wired (on-chain USDC settlement live)")
    else:
        logger.warning(
            "P2P escrow executor wired but NO escrow hot wallet found — native "
            "trades will fail until P2P_ESCROW_HOT_WALLET_ID or an EVM deposit wallet is set"
        )
    return available
