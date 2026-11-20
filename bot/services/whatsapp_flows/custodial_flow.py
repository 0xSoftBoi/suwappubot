"""Custodial deposit/withdraw flows for WhatsApp."""

import asyncio
import logging
import os
import uuid
from decimal import Decimal, InvalidOperation
from typing import Optional, Tuple

from bot.services.whatsapp_flows.base import BaseWhatsAppFlow, FlowResponse
from bot.services.whatsapp_flows import register_flow
from bot.services.whatsapp_flows.flow_errors import user_safe_error
from bot.services.whatsapp_conversation import ConversationState

logger = logging.getLogger(__name__)

# This flow is pinned to Ethereum mainnet: it reads the ETHEREUM RPC and signs
# with that chain's chainId. Every amount/gas/address decision below assumes it.
WITHDRAW_CHAIN = "ethereum"

# Gas: estimate, then pad. Hardcoded limits were the old behaviour and are
# wrong in both directions — 21000 to a contract destination is a guaranteed
# out-of-gas, and 100000 is thin for fee-on-transfer or hook ERC-20s. The
# floors below are only a lower bound for when estimate_gas returns an
# implausibly small number; a FAILED estimate aborts pre-broadcast instead of
# guessing, because a bad guess burns the user's gas for nothing.
GAS_ESTIMATE_BUFFER_PCT = 25
NATIVE_GAS_FLOOR = 21_000
TOKEN_GAS_FLOOR = 65_000

# How long to wait for a receipt before we stop waiting and report the
# withdrawal as still confirming. We never print a success line without a
# receipt that says status == 1.
RECEIPT_TIMEOUT_SECONDS = 90

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Node errors that mean the transaction was DEFINITIVELY not accepted into the
# mempool. Treating these as ambiguous would strand the user: they'd be told
# "submitted, do not re-send" over a transfer that never existed, and the row
# would keep a hash the reconciler can never resolve against chain state.
#
# Deliberately conservative, and deliberately does NOT include "already known"
# / "known transaction" — those mean the node ALREADY HAS the tx, i.e. it is
# genuinely in flight and must stay ambiguous. Misclassifying an in-flight tx
# as rejected is the dangerous direction, so a match here is only trusted
# after the chain confirms the tx is absent (see _tx_absent).
DEFINITIVE_REJECTIONS = (
    "nonce too low",
    "replacement transaction underpriced",
    "transaction underpriced",
    "intrinsic gas too low",
    "insufficient funds",
    "exceeds block gas limit",
    "invalid sender",
    "oversized data",
    "negative value",
)

# A PENDING self-custody withdrawal younger than this blocks a new one, so a
# user who ignores "do not re-send this withdrawal" cannot push a second
# transfer out while the first is still unresolved.
UNRESOLVED_WITHDRAW_BLOCK_MINUTES = 30


class BroadcastRejected(RuntimeError):
    """The node definitively refused the transaction: nothing was broadcast.

    Distinct from PostBroadcastAmbiguous, which means the node may have
    accepted it. This one is safe to report as a plain failure and safe to
    release the idempotency claim for.
    """


# Per-withdrawal amount ceilings, in token units. Read at call time from the
# environment (same approach as the TERMINAL_WITHDRAW_ENABLED kill-switch in
# hot_wallet.py) so an operator can tighten a cap without a redeploy:
#   WHATSAPP_WITHDRAW_MAX_<SYMBOL>  e.g. WHATSAPP_WITHDRAW_MAX_ETH=0.5
#   WHATSAPP_WITHDRAW_MAX_DEFAULT   applies to any symbol without its own cap
DEFAULT_WITHDRAW_CAPS = {
    "ETH": "2",
    "USDC": "25000",
    "USDT": "25000",
    "LINK": "1000",
    "MATIC": "25000",
    "ARB": "25000",
    "OP": "25000",
}
FALLBACK_WITHDRAW_CAP = "1000"

# Tokens offered by the withdraw menu. EVM-mainnet only, because the flow can
# only ever build an Ethereum transaction — offering SOL here just produced a
# dead end at the confirm step.
WITHDRAW_TOKENS = ["ETH", "USDC", "USDT", "MATIC", "ARB", "OP", "LINK"]


def _as_decimal(value) -> Optional[Decimal]:
    """Parse a user/state-supplied amount without ever going through float."""
    try:
        parsed = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not parsed.is_finite() or parsed <= 0:
        return None
    return parsed


def _withdraw_cap(symbol: str) -> Decimal:
    """Per-withdrawal ceiling for ``symbol``, env-overridable."""
    sym = (symbol or "").upper()
    raw = (
        os.getenv(f"WHATSAPP_WITHDRAW_MAX_{sym}")
        or os.getenv("WHATSAPP_WITHDRAW_MAX_DEFAULT")
        or DEFAULT_WITHDRAW_CAPS.get(sym)
        or FALLBACK_WITHDRAW_CAP
    )
    cap = _as_decimal(raw)
    if cap is None:
        logger.warning("Invalid withdraw cap %r for %s; using fallback", raw, sym)
        cap = Decimal(FALLBACK_WITHDRAW_CAP)
    return cap


def _is_definitive_rejection(error_text: str) -> bool:
    """True if the node's error says the tx was never accepted."""
    low = (error_text or "").lower()
    if "already known" in low or "known transaction" in low:
        return False
    return any(marker in low for marker in DEFINITIVE_REJECTIONS)


def _has_unresolved_withdrawal(db_uid: int) -> bool:
    """True if this user has a recent self-custody withdrawal still PENDING.

    Used to refuse a *new* withdrawal while an earlier one is unresolved. The
    idempotency key already stops one confirmation executing twice, but it
    cannot stop a user who re-runs `withdraw` from scratch after being told an
    earlier transfer might be in flight — which is exactly when a second send
    would double-spend.
    """
    from datetime import datetime, timedelta

    from bot.models.custodial import CustodialTransaction, TransactionStatus, TransactionType
    from database.db import get_session
    from bot.services.hot_wallet import SELF_CUSTODY_NO_LEDGER_REFUND

    cutoff = datetime.utcnow() - timedelta(minutes=UNRESOLVED_WITHDRAW_BLOCK_MINUTES)
    with get_session() as session:
        return (
            session.query(CustodialTransaction)
            .filter(
                CustodialTransaction.user_id == db_uid,
                CustodialTransaction.tx_type == TransactionType.WITHDRAWAL.value,
                CustodialTransaction.status == TransactionStatus.PENDING.value,
                CustodialTransaction.notes == SELF_CUSTODY_NO_LEDGER_REFUND,
                CustodialTransaction.created_at >= cutoff,
            )
            .first()
            is not None
        )


def _hex0x(value) -> str:
    """Normalize a hash/HexBytes/str to a 0x-prefixed hex string."""
    text = value.hex() if hasattr(value, "hex") else str(value)
    return text if text.startswith("0x") else "0x" + text


def _load_evm_wallet(db_uid: int) -> Tuple[Optional[object], Optional[str]]:
    """Return (evm_wallet, error_message).

    Picks the user's active **EVM** wallet specifically. The old code took the
    first active wallet of any kind and only then checked ``chain_type``, so a
    user whose first active wallet happened to be Solana was told Solana
    withdrawals were being finalized even when they had a perfectly good EVM
    wallet sitting right behind it.
    """
    from database.db import get_session
    from bot.models.user import User

    with get_session() as session:
        user = session.query(User).filter(User.id == db_uid).first()
        if not user:
            return None, "Account not found. Send *start* first."
        active = [w for w in user.wallets if w.is_active]
        evm_wallet = next((w for w in active if w.chain_type == "evm"), None)
        has_solana = any(w.chain_type == "solana" for w in active)

    if evm_wallet:
        return evm_wallet, None
    if has_solana:
        return None, (
            "Solana withdrawals are currently being finalized.\n"
            "Please use the web dashboard for Solana withdrawals."
        )
    return None, "No active EVM wallet found. Use *wallets* to create one first."


def _validate_evm_destination(
    address: str, from_address: str, token_address: Optional[str] = None
) -> Optional[str]:
    """Return an error message if ``address`` is not a safe EVM destination.

    The old check was ``len(address) < 20``, which a Solana base58 address
    sails straight through — it then reached EVM signing.
    """
    from web3 import Web3

    if not address or not Web3.is_address(address):
        return (
            "That doesn't look like a valid EVM address.\n"
            "Enter a 0x address (42 characters) to withdraw to:"
        )

    # Reject a mixed-case address whose EIP-55 checksum doesn't verify: that is
    # a typo, not a different-but-valid address. All-lower/all-upper input has
    # no checksum to verify and is accepted.
    stripped = address[2:] if address.lower().startswith("0x") else address
    if stripped != stripped.lower() and stripped != stripped.upper():
        if not Web3.is_checksum_address(address):
            return (
                "That address failed its EIP-55 checksum — it's likely a typo.\n"
                "Please re-check and enter the destination address again:"
            )

    checksummed = Web3.to_checksum_address(address)

    if checksummed == Web3.to_checksum_address(ZERO_ADDRESS):
        return "Cannot withdraw to the zero address. Enter a real destination address:"

    if from_address and checksummed == Web3.to_checksum_address(from_address):
        return (
            "That's your own wallet address — the withdrawal would just burn gas.\n"
            "Enter a different destination address:"
        )

    if token_address and checksummed == Web3.to_checksum_address(token_address):
        return (
            "That's the token's own contract address. Tokens sent there are "
            "almost always unrecoverable.\nEnter a different destination address:"
        )

    return None


class DepositFlow(BaseWhatsAppFlow):
    """Show deposit address and optionally a QR code."""

    flow_name = "custodial_deposit"
    trigger_commands = ["deposit"]
    steps = {
        "choose_chain": "_step_choose_chain",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        await self._set_state(user_id, "choose_chain", {"user_db_id": user_db_id})
        return FlowResponse(
            text="Select the chain to deposit on:",
            header="📥 Deposit",
            buttons=[
                {"id": "dep_evm", "title": "🔷 EVM"},
                {"id": "dep_solana", "title": "🟢 Solana"},
            ],
        )

    async def _step_choose_chain(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id

        chain_type = (
            "evm"
            if "evm" in text.lower()
            else "solana" if "solana" in text.lower() or "sol" in text.lower() else None
        )
        if not chain_type:
            return FlowResponse(
                "Please select EVM or Solana:",
                buttons=[
                    {"id": "dep_evm", "title": "🔷 EVM"},
                    {"id": "dep_solana", "title": "🟢 Solana"},
                ],
            )

        try:
            from database.db import get_session
            from bot.models.user import User

            with get_session() as session:
                user = session.query(User).filter(User.id == db_uid).first()
                wallet = (
                    next(
                        (w for w in user.wallets if w.chain_type == chain_type and w.is_active),
                        None,
                    )
                    if user
                    else None
                )

            if not wallet:
                return FlowResponse(
                    f"No {chain_type.upper()} wallet found.\n" f"Use *wallets* to create one first."
                )

            address = wallet.address
            # QR code via public API
            qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={address}"

            return FlowResponse(
                text=(
                    f"📥 *Deposit Address*\n\n"
                    f"Chain: {chain_type.upper()}\n"
                    f"Address:\n`{address}`\n\n"
                    f"Send tokens to this address. Only send {chain_type.upper()}-compatible tokens."
                ),
                image=qr_url,
            )
        except Exception as e:
            logger.error(f"Deposit flow error: {e}")
            return FlowResponse("Could not retrieve deposit address. Try again later.")


class WithdrawFlow(BaseWhatsAppFlow):
    """Multi-step withdrawal: token -> amount -> destination -> confirm.

    Funding source is the user's OWN wallet (``bot.models.user.Wallet``), not
    the platform hot wallet, so this flow cannot simply call
    ``HotWalletService.send_native_token`` / ``send_token``: those take a
    ``bot.models.custodial.HotWallet`` and sign Turnkey wallets against the
    main Turnkey org (``organization_id=None``), whereas a user wallet lives in
    its own Turnkey SUB-organization and must be signed through
    ``WalletService.sign_evm_transaction`` (which also normalizes chainId and
    carries the local-signing fallback). For the same reason this flow does NOT
    call ``reserve_custodial_balance``: there is no custodial ledger entry
    behind the send — the on-chain wallet balance IS the funding source — so a
    ledger debit here would reserve against the wrong pot of money.

    What it does instead is inline the precompute-hash-then-send rails from
    ``hot_wallet._broadcast_evm_raw_tx``:

      1. claim an idempotency key -> a PENDING CustodialTransaction row exists
         before anything is broadcast (tagged SELF_CUSTODY_NO_LEDGER_REFUND so
         the withdraw reconciler never credits a balance that was never
         debited);
      2. compute keccak(raw_tx) and stamp it onto that row BEFORE calling the
         node, so an ambiguous send always leaves a resolvable hash;
      3. treat ANY exception out of send_raw_transaction as ambiguous — the
         node may have accepted the tx anyway — and never report it to the
         user as a failure, never release the claim;
      4. only claim success after a receipt with status == 1.
    """

    flow_name = "custodial_withdraw"
    trigger_commands = ["withdraw"]
    steps = {
        "choose_token": "_step_choose_token",
        "enter_amount": "_step_enter_amount",
        "enter_destination": "_step_enter_destination",
        "confirm": "_step_confirm",
    }

    async def start(self, user_id: str, user_db_id: int, text: str = "") -> FlowResponse:
        # Resolve the wallet up front so the flow knows which chain it is on
        # from the first message, instead of walking the user through four
        # steps and only then discovering it cannot serve them.
        wallet, err = _load_evm_wallet(user_db_id)
        if err:
            return FlowResponse(err)

        await self._set_state(
            user_id,
            "choose_token",
            {"user_db_id": user_db_id, "wallet_id": wallet.id, "from_address": wallet.address},
        )
        rows = [{"id": f"wdtk_{t}", "title": t} for t in WITHDRAW_TOKENS]
        return FlowResponse(
            text="Select the token to withdraw:",
            header="📤 Withdraw",
            list_button_text="Choose Token",
            list_sections=[{"title": "Tokens", "rows": rows}],
        )

    async def _step_choose_token(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = text.replace("wdtk_", "").upper()
        if token not in WITHDRAW_TOKENS:
            rows = [{"id": f"wdtk_{t}", "title": t} for t in WITHDRAW_TOKENS]
            return FlowResponse(
                text="Please pick one of the supported tokens:",
                list_button_text="Choose Token",
                list_sections=[{"title": "Tokens", "rows": rows}],
            )
        await self._update(user_id, "enter_amount", {"token": token})
        cap = _withdraw_cap(token)
        return FlowResponse(
            text=(
                f"Token: *{token}*\n\n"
                f"Enter the amount to withdraw (max {cap.normalize()} {token} per withdrawal):"
            )
        )

    async def _step_enter_amount(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        token = (state.data.get("token") or "").upper()
        amount = _as_decimal(text)
        if amount is None:
            return FlowResponse("Please enter a valid positive amount:")

        # Early cap feedback. Re-checked authoritatively at confirm time, since
        # the cap can change between these two steps.
        cap = _withdraw_cap(token)
        if amount > cap:
            return FlowResponse(
                f"That's above the per-withdrawal limit of {cap.normalize()} {token}.\n"
                f"Enter a smaller amount:"
            )

        await self._update(user_id, "enter_destination", {"amount": str(amount)})
        return FlowResponse(text=f"Amount: *{amount} {token}*\n\nEnter the destination address:")

    async def _step_enter_destination(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        from web3 import Web3

        address = text.strip()
        err = _validate_evm_destination(address, state.data.get("from_address") or "")
        if err:
            return FlowResponse(err)

        address = Web3.to_checksum_address(address)
        token = (state.data.get("token") or "?").upper()
        amount = state.data.get("amount", "0")

        # A per-confirmation token is what makes the idempotency key stable:
        # re-confirming this exact card can never execute twice, while a fresh
        # withdraw gets a fresh key and is free to proceed.
        await self._update(
            user_id,
            "confirm",
            {"destination": address, "confirm_token": uuid.uuid4().hex[:16]},
        )
        short_addr = address[:8] + "..." + address[-6:]
        return FlowResponse(
            text=(
                f"*Confirm Withdrawal*\n\n"
                f"Token: {token}\n"
                f"Amount: {amount}\n"
                f"To: `{short_addr}`\n\n"
                f"Confirm?"
            ),
            buttons=[
                {"id": "wd_confirm", "title": "✅ Confirm"},
                {"id": "wd_cancel", "title": "❌ Cancel"},
            ],
        )

    async def _step_confirm(
        self, user_id: str, user_db_id: int, text: str, state: ConversationState
    ) -> FlowResponse:
        if text in ("wd_cancel", "cancel"):
            await self._clear(user_id)
            return FlowResponse("Withdrawal cancelled.")

        if text not in ("wd_confirm", "confirm", "yes"):
            return FlowResponse(
                "Please confirm or cancel:",
                buttons=[
                    {"id": "wd_confirm", "title": "✅ Confirm"},
                    {"id": "wd_cancel", "title": "❌ Cancel"},
                ],
            )

        await self._clear(user_id)
        db_uid = state.data.get("user_db_id") or user_db_id
        token = (state.data.get("token") or "").upper()
        destination = state.data.get("destination")
        confirm_token = state.data.get("confirm_token")
        amount = _as_decimal(state.data.get("amount"))

        if not (token and destination and confirm_token and amount is not None):
            return FlowResponse("This withdrawal has expired. Send *withdraw* to start a new one.")

        from bot.services.hot_wallet import (
            ComplianceBlockedError,
            PostBroadcastAmbiguous,
            SELF_CUSTODY_NO_LEDGER_REFUND,
            WithdrawalsPausedError,
            _assert_recipient_compliant,
            _assert_withdrawals_enabled,
            hot_wallet_service,
            quantize_to_decimals,
        )
        from bot.models.custodial import TransactionType

        claimed_tx_id: Optional[int] = None
        broadcast_attempted = False

        try:
            from web3 import Web3
            from bot.config.chains import CHAINS
            from bot.config.tokens import get_token_address, get_token_decimals
            from bot.services.wallet import WalletService

            # Authoritative cap re-check (the early one at amount entry is only
            # for fast feedback and can be stale by now).
            cap = _withdraw_cap(token)
            if amount > cap:
                return FlowResponse(
                    f"That's above the per-withdrawal limit of {cap.normalize()} {token}.\n"
                    f"Send *withdraw* to try a smaller amount."
                )

            wallet, wallet_err = _load_evm_wallet(db_uid)
            if wallet_err:
                return FlowResponse(wallet_err)

            # Refuse a second withdrawal while an earlier one is unresolved.
            # The idempotency key stops one confirmation executing twice, but
            # not a user who re-runs `withdraw` from scratch after being told
            # a transfer might be in flight — and that is precisely the case
            # where sending again double-spends.
            if _has_unresolved_withdrawal(db_uid):
                return FlowResponse(
                    "⏳ You already have a withdrawal still confirming.\n\n"
                    "Wait for it to finish before starting another — sending again "
                    "now could move your funds twice. Check your wallet for status."
                )

            # hot_wallet.send_native_token/send_token enforce the shared
            # TERMINAL_WITHDRAW_ENABLED kill-switch internally. This flow builds
            # and broadcasts its own tx, so it must call the guard directly or
            # it would be the one withdraw surface the kill-switch cannot pause.
            _assert_withdrawals_enabled()

            chain_cfg = CHAINS.get(WITHDRAW_CHAIN)
            rpc_url = os.environ.get(chain_cfg.rpc_url_env, "") if chain_cfg else ""
            if not rpc_url:
                return FlowResponse("RPC not configured. Please try again later.")

            w3 = Web3(Web3.HTTPProvider(rpc_url))
            from_address = Web3.to_checksum_address(wallet.address)
            destination = Web3.to_checksum_address(destination)

            # Only the chain's ACTUAL native asset may take the native branch.
            # This flow is pinned to Ethereum mainnet, so sending e.g. MATIC
            # here would move native ETH instead of the MATIC ERC-20 — a
            # wrong-asset loss at ~1000x the intended value. MATIC/ARB/OP/LINK
            # are all ERC-20s on mainnet and must go through the token branch.
            native_symbol = (getattr(chain_cfg, "native_token", None) or "ETH").upper()
            is_native = token == native_symbol

            token_addr = None
            decimals = 18
            if not is_native:
                token_addr = get_token_address(token, WITHDRAW_CHAIN)
                decimals = get_token_decimals(token, WITHDRAW_CHAIN)
                # Fail closed on a token this chain has no address for rather
                # than building a transfer against `None` and broadcasting
                # something wrong.
                if not token_addr or decimals is None:
                    return FlowResponse(
                        f"{token} withdrawals are not supported on Ethereum yet.\n"
                        "Please use the web dashboard."
                    )
                token_addr = Web3.to_checksum_address(token_addr)

            # Re-run destination validation now that the token contract is
            # known — the entry-step check could not screen for it.
            dest_err = _validate_evm_destination(destination, from_address, token_addr)
            if dest_err:
                return FlowResponse(dest_err + "\n\nSend *withdraw* to start again.")

            _assert_recipient_compliant(destination, WITHDRAW_CHAIN, token_address=token_addr)

            # Floor the amount to the asset's on-chain precision BEFORE it is
            # recorded or converted to base units. `int(amount * 10**decimals)`
            # floors anyway, so without this the persisted CustodialTransaction
            # row (and the message the user reads) would claim a few more base
            # units than the transaction actually moves.
            amount = quantize_to_decimals(amount, 18 if is_native else decimals)
            if amount <= 0:
                return FlowResponse(
                    f"That amount is too small to send — it rounds to zero at "
                    f"{token}'s precision.\nSend *withdraw* to try again."
                )

            # "pending", not web3's default "latest". This wallet is the
            # USER's own — shared with the swap engine and with anything they
            # drive from their own app — so a transaction of theirs sitting
            # unmined in the mempool is normal, unlike the platform hot wallet
            # which is serialized behind one flow. A "latest" nonce would build
            # this withdrawal at an already-occupied nonce, which either
            # replaces their pending transaction or is rejected outright.
            nonce = w3.eth.get_transaction_count(from_address, "pending")
            gas_price = w3.eth.gas_price
            native_balance = w3.eth.get_balance(from_address)

            if is_native:
                value = w3.to_wei(amount, "ether")
                # Balance check BEFORE estimating gas. eth_estimateGas runs the
                # call against the account's real balance, so when
                # value > balance the node reverts with "insufficient funds"
                # and the estimate raises — surfacing as the generic error
                # instead of this specific, actionable message. Only the
                # narrow `balance >= value but < value + gas` band would
                # otherwise reach it.
                if native_balance < value:
                    return self._insufficient(
                        token,
                        have=Decimal(native_balance) / Decimal(10**18),
                        need=amount,
                    )
                gas_limit = self._estimate_gas(
                    w3,
                    {"from": from_address, "to": destination, "value": value},
                    NATIVE_GAS_FLOOR,
                )
                gas_cost = gas_limit * gas_price
                # Gas reserve: a native withdrawal must leave enough behind to
                # pay for itself. Without this the send either reverts for
                # insufficient funds or drains the wallet to exactly zero.
                if native_balance < value + gas_cost:
                    return self._insufficient(
                        token,
                        have=Decimal(native_balance) / Decimal(10**18),
                        need=Decimal(value + gas_cost) / Decimal(10**18),
                        note=f"(includes ~{Decimal(gas_cost) / Decimal(10**18):.6f} {token} gas)",
                    )
                tx = {
                    "to": destination,
                    "value": value,
                    "gas": gas_limit,
                    "gasPrice": gas_price,
                    "nonce": nonce,
                    "chainId": chain_cfg.chain_id,
                }
            else:
                raw_amount = int(amount * (10**decimals))
                if raw_amount <= 0:
                    return FlowResponse(
                        f"That amount is too small to send — it rounds to zero at "
                        f"{token}'s {decimals} decimals.\nSend *withdraw* to try again."
                    )

                erc20_abi = [
                    {
                        "constant": False,
                        "inputs": [
                            {"name": "_to", "type": "address"},
                            {"name": "_value", "type": "uint256"},
                        ],
                        "name": "transfer",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                    },
                    {
                        "constant": True,
                        "inputs": [{"name": "_owner", "type": "address"}],
                        "name": "balanceOf",
                        "outputs": [{"name": "balance", "type": "uint256"}],
                        "type": "function",
                    },
                ]
                contract = w3.eth.contract(address=token_addr, abi=erc20_abi)

                token_balance = contract.functions.balanceOf(from_address).call()
                if token_balance < raw_amount:
                    return self._insufficient(
                        token,
                        have=Decimal(token_balance) / Decimal(10**decimals),
                        need=amount,
                    )

                transfer_fn = contract.functions.transfer(destination, raw_amount)
                gas_limit = self._estimate_gas(
                    w3, {"from": from_address}, TOKEN_GAS_FLOOR, fn=transfer_fn
                )
                gas_cost = gas_limit * gas_price
                # An ERC-20 transfer is paid for in the native asset, so check
                # that separately from the token balance.
                if native_balance < gas_cost:
                    return FlowResponse(
                        f"Not enough {native_symbol} to pay network fees.\n"
                        f"Need ~{Decimal(gas_cost) / Decimal(10**18):.6f} {native_symbol}, "
                        f"have {Decimal(native_balance) / Decimal(10**18):.6f}.\n"
                        f"Top up {native_symbol} and try again."
                    )

                tx = transfer_fn.build_transaction(
                    {
                        "from": from_address,
                        "gas": gas_limit,
                        "gasPrice": gas_price,
                        "nonce": nonce,
                        "chainId": chain_cfg.chain_id,
                    }
                )

            # ---- Rails start here: a durable record BEFORE any broadcast ----
            idempotency_key = f"wa_withdraw:{db_uid}:{confirm_token}"
            claimed_tx_id = hot_wallet_service.claim_idempotency_key(
                idempotency_key=idempotency_key,
                user_id=db_uid,
                tx_type=TransactionType.WITHDRAWAL,
                chain=WITHDRAW_CHAIN,
                token_symbol=token,
                amount=amount,
                to_address=destination,
                from_address=from_address,
                # Tag the row so the withdraw reconciler resolves it against
                # chain state but never credits a custodial balance: this
                # withdrawal debited the user's on-chain wallet, not a ledger.
                notes=SELF_CUSTODY_NO_LEDGER_REFUND,
            )
            if claimed_tx_id is None:
                # claim_idempotency_key swallows every IntegrityError, not just
                # a duplicate key, so None does NOT prove this key was already
                # claimed (a FK violation on user_id lands here too). Only take
                # the "already submitted, don't re-send" branch if a row really
                # exists — telling a user not to retry when nothing was ever
                # recorded or sent would strand them for no reason.
                existing = hot_wallet_service.get_transaction_by_idempotency_key(
                    db_uid, idempotency_key
                )
                if existing is None:
                    logger.error(
                        "whatsapp withdraw claim failed with no row for user %s key %s "
                        "— nothing was broadcast",
                        db_uid,
                        idempotency_key,
                    )
                    return FlowResponse(
                        "❌ Couldn't start this withdrawal — nothing was sent and your "
                        "funds are safe.\nSend *withdraw* to try again."
                    )
                tx_line = ""
                if existing.tx_hash:
                    from bot.utils.formatters import format_tx_link

                    tx_line = f"\nTx: {format_tx_link(existing.tx_hash, WITHDRAW_CHAIN)}"
                return FlowResponse(
                    "⏳ This withdrawal was already submitted."
                    + tx_line
                    + "\n\nCheck your wallet for status — don't re-send it."
                )

            # WalletService exposes sign_evm_transaction(wallet, tx) -> hex str
            # (there is no sign_transaction method). Routes Turnkey sub-org vs
            # local signing internally and normalizes chainId. Signing is
            # pre-broadcast and safe to let fail normally.
            ws = WalletService()
            signed_hex = await ws.sign_evm_transaction(wallet, tx)
            raw_tx = bytes.fromhex((signed_hex or "").replace("0x", ""))
            if not raw_tx:
                # Never hand an empty payload to the node: fail closed, loudly,
                # while we are still unambiguously pre-broadcast.
                raise ValueError("signer returned an empty transaction payload")

            # The tx hash is deterministic from the signed bytes, so stamp it
            # onto the claimed row BEFORE calling the node. If the send below
            # throws after the node already accepted the tx, the row left
            # behind still carries a hash the reconciler can resolve against
            # real chain state, instead of a hash-less row that could only be
            # blind-refunded by age.
            precomputed_hash = _hex0x(Web3.keccak(raw_tx))
            hot_wallet_service.stamp_pending_tx_hash(claimed_tx_id, precomputed_hash)

            broadcast_attempted = True
            try:
                sent = w3.eth.send_raw_transaction(raw_tx)
                tx_hash_hex = _hex0x(sent)
            except Exception as e:
                # Default is ambiguous: the node may have accepted and
                # propagated the tx even though this call raised (timeout,
                # dropped response, "already known", transient 5xx).
                #
                # But some rejections are DEFINITIVE — the tx never entered the
                # pool. Reporting one of those as "submitted, do not re-send"
                # strands the user over a transfer that never existed AND
                # leaves a row carrying a hash that will never appear on chain,
                # which the reconciler can never resolve (it refuses to
                # terminalize a hashed row on age). Downgrade to a definitive
                # failure only when the error text says so AND the chain
                # agrees the tx is absent; if that confirmation is itself
                # unavailable we stay ambiguous, because misclassifying an
                # in-flight tx as rejected is the dangerous direction.
                if _is_definitive_rejection(str(e)) and self._tx_absent(w3, precomputed_hash):
                    broadcast_attempted = False
                    raise BroadcastRejected(str(e)) from e
                raise PostBroadcastAmbiguous(
                    f"send_raw_transaction failed ambiguously "
                    f"(tx may already be broadcast): {e}",
                    tx_hash=precomputed_hash,
                ) from e

            # ---- Receipt check: no success claim without status == 1 ----
            return await self._await_receipt(
                w3,
                tx_hash_hex,
                claimed_tx_id=claimed_tx_id,
                from_address=from_address,
                token=token,
                amount=amount,
                destination=destination,
            )

        except PostBroadcastAmbiguous as exc:
            # DO NOT release the claim and DO NOT tell the user their funds are
            # safe. The node call threw AFTER the tx may already have been
            # accepted — we genuinely don't know whether funds moved. Leave the
            # placeholder PENDING with its hash for the reconciler.
            if claimed_tx_id is not None:
                hot_wallet_service.record_pending_tx_hash(claimed_tx_id, exc.tx_hash)
            logger.exception(
                "whatsapp withdraw broadcast ambiguous for user %s (tx_id=%s, tx_hash=%s) "
                "— left PENDING for reconciler",
                db_uid,
                claimed_tx_id,
                exc.tx_hash,
            )
            return FlowResponse(
                "⏳ *Withdrawal Submitted*\n\n"
                "We couldn't confirm it reached the network right away. We're checking — "
                "it will either complete or be marked failed.\n\n"
                "*Do not re-send this withdrawal.* Check your wallet shortly for status."
            )

        except BroadcastRejected as exc:
            # The node definitively refused it and the chain confirms no such
            # tx exists, so nothing is in flight: release the claim (the key
            # becomes reusable for a genuine retry) and say plainly that
            # nothing was sent.
            self._release(hot_wallet_service, claimed_tx_id, broadcast_attempted)
            logger.warning(
                "whatsapp withdraw definitively rejected by node for user %s (tx_id=%s): %s",
                db_uid,
                claimed_tx_id,
                exc,
            )
            return FlowResponse(
                "❌ The network rejected this withdrawal, so nothing was sent and "
                "your funds are safe.\n\n"
                "This usually means another transaction from your wallet is still "
                "pending. Wait for it to confirm, then send *withdraw* to try again."
            )

        except WithdrawalsPausedError:
            # Kill-switch fires before any node call — safe to fully undo.
            self._release(hot_wallet_service, claimed_tx_id, broadcast_attempted)
            return FlowResponse(
                "⏸️ Withdrawals are temporarily paused for maintenance.\n"
                "Your funds are safe. Please try again shortly."
            )

        except ComplianceBlockedError:
            self._release(hot_wallet_service, claimed_tx_id, broadcast_attempted)
            return FlowResponse(
                "❌ That destination address can't be used for withdrawals.\n"
                "Your funds are safe. Please use a different address."
            )

        except Exception as e:
            if broadcast_attempted:
                # We got past send_raw_transaction without a clean result —
                # treat it exactly like the ambiguous path rather than risking
                # a "funds are safe" message over a tx that may be in flight.
                logger.exception(
                    "whatsapp withdraw failed after broadcast for user %s (tx_id=%s)",
                    db_uid,
                    claimed_tx_id,
                )
                return FlowResponse(
                    "⏳ *Withdrawal Submitted*\n\n"
                    "We couldn't confirm its final status. We're checking — "
                    "it will either complete or be marked failed.\n\n"
                    "*Do not re-send this withdrawal.* Check your wallet shortly for status."
                )
            # Genuinely pre-broadcast: nothing was sent, the claim can go back,
            # and "your funds are safe" is actually true here.
            self._release(hot_wallet_service, claimed_tx_id, broadcast_attempted)
            return FlowResponse(user_safe_error(e, "withdrawal"))

    # === helpers ===

    @staticmethod
    def _release(service, claimed_tx_id: Optional[int], broadcast_attempted: bool) -> None:
        """Free a claimed idempotency key after a PRE-broadcast failure only.

        Never called once a broadcast has been attempted: releasing then would
        delete the very row the reconciler needs to resolve the ambiguity, and
        would re-arm the key so the user could send the same transfer twice.
        """
        if claimed_tx_id is None or broadcast_attempted:
            return
        try:
            service.release_claimed_transaction(claimed_tx_id)
        except Exception:
            logger.exception("Failed to release claimed withdraw tx %s", claimed_tx_id)

    @staticmethod
    def _tx_absent(w3, tx_hash: str) -> bool:
        """True only if the chain positively reports no such transaction.

        Any other outcome (found, or the lookup itself failing) returns False,
        so an unreachable node can never be mistaken for proof that nothing
        was broadcast.
        """
        try:
            from web3.exceptions import TransactionNotFound

            try:
                w3.eth.get_transaction(tx_hash)
                return False
            except TransactionNotFound:
                return True
        except Exception:
            logger.warning(
                "could not confirm absence of tx %s; treating as possibly in flight",
                tx_hash,
                exc_info=True,
            )
            return False

    @staticmethod
    def _estimate_gas(w3, params: dict, floor: int, fn=None) -> int:
        """estimate_gas + buffer, never below ``floor``.

        A failed estimate is allowed to raise: it means the transfer would
        revert, and aborting pre-broadcast is strictly better than guessing a
        limit and burning the user's gas on a doomed transaction.
        """
        estimated = fn.estimate_gas(params) if fn is not None else w3.eth.estimate_gas(params)
        padded = (int(estimated) * (100 + GAS_ESTIMATE_BUFFER_PCT)) // 100
        return max(padded, floor)

    @staticmethod
    def _insufficient(token: str, have: Decimal, need: Decimal, note: str = "") -> FlowResponse:
        suffix = f" {note}" if note else ""
        return FlowResponse(
            f"Insufficient {token} balance.\n"
            f"Need {need:.8f}{suffix}, have {have:.8f}.\n"
            f"Send *withdraw* to try a smaller amount."
        )

    async def _await_receipt(
        self,
        w3,
        tx_hash_hex: str,
        claimed_tx_id: int,
        from_address: str,
        token: str,
        amount: Decimal,
        destination: str,
    ) -> FlowResponse:
        """Wait for a receipt and report only what it actually proves.

        The old flow printed "✅ Withdrawal Submitted!" with a tx link the
        instant send_raw_transaction returned, so a reverted transfer looked
        like a success. Nothing here claims success without status == 1.
        """
        from bot.services.hot_wallet import hot_wallet_service
        from bot.models.custodial import TransactionStatus
        from bot.utils.formatters import format_tx_link

        tx_link = format_tx_link(tx_hash_hex, WITHDRAW_CHAIN)
        short_dest = f"{destination[:8]}...{destination[-6:]}"

        receipt = None
        try:
            # wait_for_transaction_receipt blocks; keep it off the event loop so
            # one pending withdrawal can't stall every other WhatsApp message.
            receipt = await asyncio.to_thread(
                w3.eth.wait_for_transaction_receipt, tx_hash_hex, RECEIPT_TIMEOUT_SECONDS
            )
        except asyncio.CancelledError:
            # App shutdown during the wait. CancelledError is a BaseException,
            # so without this the handler would unwind past every `except
            # Exception` below and the user would be told NOTHING about a
            # transfer that is already on the network — the one situation most
            # likely to make them re-send it. Swallow the cancellation and
            # answer: the broadcast is done, there is no work left to abort,
            # and the row stays PENDING for the reconciler either way.
            logger.warning(
                "whatsapp withdraw receipt wait cancelled (shutdown) for tx %s (tx_id=%s) "
                "— reporting as sent, left PENDING for reconciler",
                tx_hash_hex,
                claimed_tx_id,
            )
        except Exception:
            logger.warning(
                "whatsapp withdraw receipt not available within %ss for tx %s (tx_id=%s) "
                "— leaving PENDING for reconciler",
                RECEIPT_TIMEOUT_SECONDS,
                tx_hash_hex,
                claimed_tx_id,
                exc_info=True,
            )

        if receipt is None:
            # Broadcast succeeded, outcome still unknown. Row stays PENDING
            # with its hash; the reconciler finishes the job.
            return FlowResponse(
                f"⏳ *Withdrawal Sent — Confirming*\n\n"
                f"{amount} {token} → `{short_dest}`\n"
                f"Tx: {tx_link}\n\n"
                f"It's on the network but not confirmed yet. *Do not re-send it.*"
            )

        if int(receipt.get("status", 0)) == 1:
            hot_wallet_service.finalize_claimed_transaction(
                tx_id=claimed_tx_id, tx_hash=tx_hash_hex, from_address=from_address
            )
            return FlowResponse(
                f"✅ *Withdrawal Confirmed*\n\n"
                f"{amount} {token} → `{short_dest}`\n"
                f"Tx: {tx_link}"
            )

        # Mined but reverted: the transfer did not happen, though gas was spent.
        hot_wallet_service.cas_transaction_status(
            claimed_tx_id,
            expected_status=TransactionStatus.PENDING,
            new_status=TransactionStatus.FAILED,
            tx_hash=tx_hash_hex,
        )
        logger.error(
            "whatsapp withdraw reverted on-chain for tx %s (tx_id=%s)",
            tx_hash_hex,
            claimed_tx_id,
        )
        return FlowResponse(
            f"❌ *Withdrawal Failed On-Chain*\n\n"
            f"The transaction reverted, so your {token} was *not* sent "
            f"(the network fee was still spent).\n"
            f"Tx: {tx_link}\n\n"
            f"Send *withdraw* to try again."
        )


_deposit_flow = DepositFlow()
_withdraw_flow = WithdrawFlow()
register_flow("custodial_deposit", _deposit_flow)
register_flow("custodial_withdraw", _withdraw_flow)
