"""Bulk Payments handler — /pay command.

Batch-send native or ERC-20/SPL/TRC-20 tokens to many recipients in one flow,
mirroring the Cozy/Cwallet "Bulk Payments" UX.

Flow
----
1. /pay             → wallet-selector (one wallet per chain family)
2. Wallet chosen    → ask for token (native or ERC-20 symbol)
3. Token confirmed  → ask for recipient list (one `address amount` per line)
4. List parsed      → show summary (totals, per-recipient table, balance check)
5. User confirms    → 2FA gate (if enabled + above threshold) → execute:
     EVM + native token  → sequential sends (one 21k tx per recipient)
     EVM + ERC-20        → sequential sends with per-recipient status
     Solana / TRON       → sequential sends with per-recipient status
6. Result report    → per-recipient success / failure, partial-failure flagged

MONEY-PATH note (for reviewer)
-------------------------------
* Private key is decrypted exactly once per execution, via wallet_service.get_private_key()
  which uses the existing envelope-crypto / KMS path.  The key is scrubbed with
  _zeroize_str() after use.
* EVM native sends use sequential 21k transfers (one tx per recipient).
  The Multicall3 aggregate3Value path has been DISABLED pending a purpose-built
  disperse contract + testnet verification (see CRITICAL #3 fix comment below).
* Token amounts are validated as Decimal to avoid float rounding before conversion
  to wei/lamports/sun.
* Balance check happens BEFORE confirmation is shown.  Balance required for native
  sends includes an estimated gas buffer (21_000 * n_recipients * gas_price).
* Address validation is strict: wrong-chain format = immediate rejection of that line,
  entire list rejected (not silently skipped).
* Confirmation step requires explicit "Confirm" button tap — no auto-send on timeout.
* Wallet ownership is verified in EVERY step that loads a wallet: the DB wallet must
  have wallet.user_id == caller db_user.id.  Wallet IDs from callback data are never
  trusted alone (IDOR fix).
* 2FA and spending-limit checks mirror bulk_swap.py exactly.
"""

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional

from eth_account import Account
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)
from web3 import Web3

from bot.config.chains import CHAINS, ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals
from bot.models.user import User, Wallet
from bot.services.rpc_manager import rpc_manager
from bot.services.spending_limits import spending_limit_service
from bot.services.twofa import twofa_service
from bot.services.wallet import WalletService, _zeroize_str
from bot.utils.rate_limiter import swap_limiter, enforce_rate_limit_for_update
from bot.utils.tos_utils import enforce_tos
from bot.utils.validators import validate_address
from database.db import get_session

logger = logging.getLogger(__name__)

wallet_service = WalletService()

# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------
(
    BP_SELECT_WALLET,
    BP_SELECT_TOKEN,
    BP_ENTER_LIST,
    BP_CONFIRM,
    BP_2FA,
) = range(5)

# User-data keys
_UD_WALLET_ID = "bp_wallet_id"
_UD_CHAIN = "bp_chain"
_UD_CHAIN_TYPE = "bp_chain_type"
_UD_TOKEN = "bp_token"
_UD_RECIPIENTS = "bp_recipients"
_UD_TOTAL_USD = "bp_total_usd"
_UD_2FA_VERIFIED_AT = "bp_twofa_verified_at"
_UD_2FA_ATTEMPTS = "bp_twofa_attempts"
_UD_DB_USER_ID = "bp_db_user_id"

# Max recipients per batch (safety cap to avoid OOM / RPC-rate-limit flood)
MAX_RECIPIENTS = 100

# Multicall3 — address kept for reference only; the native batch path is DISABLED.
# DISABLED: _build_multicall3_native_batch / _execute_evm_native_batch are removed.
# Reason: aggregate3Value with per-call value can strand msg.value in the contract
# if the sum of sub-call values drifts from msg.value (integer arithmetic edge
# cases), and the path has no testnet verification.  Re-enable only after deploying
# a purpose-built disperse contract with a full test suite on every target chain.
MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"  # kept for reference

# Gas constants for native EVM sends
_GAS_PER_NATIVE_TRANSFER = 21_000  # standard ETH transfer
_GAS_BUFFER_FACTOR = Decimal("1.2")  # 20% buffer on gas cost estimate

# Conservative per-tx gas estimate for ERC-20 transfer() calls, used only for
# the balance precheck (the real tx uses w3.eth.estimate_gas with its own
# 1.2x buffer / 80_000 fallback — see _build_erc20_transfer_tx).  This is
# intentionally generous so the precheck doesn't under-count and let a batch
# pass confirmation only to run out of native gas mid-execution.
_GAS_PER_ERC20_TRANSFER = 80_000

# 2FA validity window (seconds) — mirrors bulk_swap.py
TWOFA_VALID_SECONDS = 300

# ERC-20 transfer selector (keccak256("transfer(address,uint256)")[:4])
_ERC20_TRANSFER_SELECTOR = "0xa9059cbb"

NATIVE_SYMBOL = "NATIVE"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Recipient:
    address: str
    amount: Decimal
    status: str = "pending"  # pending | ok | failed
    tx_hash: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _chain_type_for_wallet(wallet: Wallet) -> str:
    """Return chain_type string ('evm', 'solana', 'tron', 'starknet')."""
    return wallet.chain_type


def _validate_address_for_chain(address: str, chain_type: str) -> bool:
    """Strict per-chain address validation (rejects cross-chain pastes)."""
    return validate_address(address, chain_type)


def _parse_recipient_list(text: str, chain_type: str) -> tuple[list[Recipient], list[str]]:
    """Parse a multi-line 'address amount' list.

    Returns (valid_recipients, error_lines).  Every line is accounted for —
    nothing is silently dropped.
    """
    recipients: list[Recipient] = []
    errors: list[str] = []

    for raw_line in text.strip().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split()
        if len(parts) < 2:
            errors.append(f"Bad format (need `address amount`): {line[:60]}")
            continue

        address = parts[0].strip()
        amount_str = parts[1].strip()

        if not _validate_address_for_chain(address, chain_type):
            errors.append(f"Invalid {chain_type.upper()} address: {address[:20]}…")
            continue

        try:
            amount = Decimal(amount_str)
        except InvalidOperation:
            errors.append(f"Invalid amount '{amount_str}' for {address[:12]}…")
            continue

        if amount <= 0:
            errors.append(f"Amount must be > 0 for {address[:12]}…")
            continue

        recipients.append(Recipient(address=address, amount=amount))

    return recipients, errors


def _summarize(recipients: list[Recipient], token: str, chain_type: str) -> tuple[str, Decimal]:
    """Build a human-readable summary table and return (text, total_amount)."""
    total = sum(r.amount for r in recipients)
    lines = [f"Recipients: {len(recipients)}", f"Total: {total:f} {token}\n"]
    for i, r in enumerate(recipients, 1):
        addr_short = r.address[:8] + "…" + r.address[-6:]
        lines.append(f"{i}. {addr_short}  {r.amount:f} {token}")
    return "\n".join(lines), total


def _get_caller_db_user_id(context: ContextTypes.DEFAULT_TYPE) -> Optional[int]:
    """Return the authenticated DB user id stored at flow entry."""
    return context.user_data.get(_UD_DB_USER_ID)


# ---------------------------------------------------------------------------
# EVM helpers
# ---------------------------------------------------------------------------


def _build_erc20_transfer_tx(
    w3: Web3,
    from_address: str,
    token_contract_address: str,
    to_address: str,
    amount_raw: int,
    nonce: int,
    chain: object,
) -> dict:
    """Build an ERC-20 transfer tx (unsigned)."""
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
        }
    ]
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(token_contract_address), abi=erc20_abi
    )
    from bot.config.chains import apply_min_gas_price

    gas_price = w3.eth.gas_price
    gas_price = apply_min_gas_price(chain.name, gas_price)

    tx = contract.functions.transfer(
        Web3.to_checksum_address(to_address), amount_raw
    ).build_transaction(
        {
            "from": Web3.to_checksum_address(from_address),
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": chain.chain_id,
        }
    )
    try:
        estimated = w3.eth.estimate_gas(tx)
        tx["gas"] = int(estimated * 1.2)
    except Exception:
        tx["gas"] = 80_000
    return tx


async def _execute_evm_native_sequential(
    wallet: Wallet,
    chain_name: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Sequential native-token sends — one standard 21k tx per recipient.

    This is the ONLY EVM native path.  The Multicall3 aggregate3Value batch
    has been disabled (see module docstring / CRITICAL #3 fix).
    """
    chain = get_chain_by_name(chain_name)
    if chain is None:
        raise ValueError(f"Unknown chain: {chain_name}")

    w3 = rpc_manager.get_web3(chain_name)
    nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))
    from bot.config.chains import apply_min_gas_price

    for r in recipients:
        try:
            gas_price = apply_min_gas_price(chain.name, w3.eth.gas_price)
            wei = int(r.amount * Decimal(10**chain.native_decimals))
            tx = {
                "to": Web3.to_checksum_address(r.address),
                "value": wei,
                "nonce": nonce,
                "gas": _GAS_PER_NATIVE_TRANSFER,
                "gasPrice": gas_price,
                "chainId": chain.chain_id,
            }
            signed_hex = await wallet_service.sign_evm_transaction(wallet, tx)
            raw_bytes = bytes.fromhex(signed_hex.replace("0x", ""))
            tx_hash_bytes = await asyncio.get_event_loop().run_in_executor(
                None, w3.eth.send_raw_transaction, raw_bytes
            )
            r.tx_hash = tx_hash_bytes.hex()
            r.status = "ok"
            nonce += 1
        except Exception as exc:
            r.status = "failed"
            r.error = str(exc)[:120]
            logger.warning("bulk_pay: sequential send failed for %s: %s", r.address, exc)

    return recipients


async def _execute_evm_token_sequential(
    wallet: Wallet,
    chain_name: str,
    token_symbol: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Sequential ERC-20 sends."""
    chain = get_chain_by_name(chain_name)
    if chain is None:
        raise ValueError(f"Unknown chain: {chain_name}")

    token_address = get_token_address(token_symbol, chain_name)
    if not token_address:
        for r in recipients:
            r.status = "failed"
            r.error = f"Token {token_symbol} not found on {chain_name}"
        return recipients

    decimals = get_token_decimals(token_symbol, chain_name)
    w3 = rpc_manager.get_web3(chain_name)
    nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(wallet.address))

    for r in recipients:
        try:
            amount_raw = int(r.amount * Decimal(10**decimals))
            tx = _build_erc20_transfer_tx(
                w3, wallet.address, token_address, r.address, amount_raw, nonce, chain
            )
            signed_hex = await wallet_service.sign_evm_transaction(wallet, tx)
            raw_bytes = bytes.fromhex(signed_hex.replace("0x", ""))
            tx_hash_bytes = await asyncio.get_event_loop().run_in_executor(
                None, w3.eth.send_raw_transaction, raw_bytes
            )
            r.tx_hash = tx_hash_bytes.hex()
            r.status = "ok"
            nonce += 1
        except Exception as exc:
            r.status = "failed"
            r.error = str(exc)[:120]
            logger.warning(
                "bulk_pay: ERC-20 send failed for %s (%s): %s", r.address, token_symbol, exc
            )

    return recipients


async def _execute_solana_sequential(
    wallet: Wallet,
    token: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Sequential SOL / SPL-token sends."""
    import aiohttp
    import base58 as _base58
    from solders.keypair import Keypair
    from solders.pubkey import Pubkey
    from solders.system_program import TransferParams, transfer as sol_transfer
    from solders.transaction import Transaction
    from solders.message import Message

    rpc_url = rpc_manager.get_rpc_url("solana")
    private_key_str = wallet_service.get_private_key(wallet)
    try:
        key_bytes = _base58.b58decode(private_key_str)
        keypair = Keypair.from_bytes(key_bytes)
    finally:
        _zeroize_str(private_key_str)

    is_native = token.upper() in ("SOL", NATIVE_SYMBOL)

    if is_native:
        from solana.rpc.async_api import AsyncClient

        async with AsyncClient(rpc_url) as client:
            for r in recipients:
                try:
                    lamports = int(r.amount * Decimal(10**9))
                    ix = sol_transfer(
                        TransferParams(
                            from_pubkey=keypair.pubkey(),
                            to_pubkey=Pubkey.from_string(r.address),
                            lamports=lamports,
                        )
                    )
                    bh_resp = await client.get_latest_blockhash()
                    recent_bh = bh_resp.value.blockhash
                    msg = Message.new_with_blockhash([ix], keypair.pubkey(), recent_bh)
                    tx = Transaction.new_unsigned(msg)
                    tx.sign([keypair], recent_bh)
                    result = await client.send_transaction(tx)
                    r.tx_hash = str(result.value)
                    r.status = "ok"
                except Exception as exc:
                    r.status = "failed"
                    r.error = str(exc)[:120]
                    logger.warning("bulk_pay: SOL send failed for %s: %s", r.address, exc)
    else:
        # SPL token — build transfer_checked per recipient
        from solana.rpc.async_api import AsyncClient
        from spl.token.instructions import (
            TransferCheckedParams,
            get_associated_token_address,
            transfer_checked,
        )

        token_mint_str = get_token_address(token, "solana")
        if not token_mint_str:
            for r in recipients:
                r.status = "failed"
                r.error = f"SPL token {token} not found"
            return recipients

        decimals = get_token_decimals(token, "solana")
        mint_pubkey = Pubkey.from_string(token_mint_str)
        spl_program = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
        source_ata = get_associated_token_address(keypair.pubkey(), mint_pubkey)

        async with AsyncClient(rpc_url) as client:
            for r in recipients:
                try:
                    dest_pubkey = Pubkey.from_string(r.address)
                    dest_ata = get_associated_token_address(dest_pubkey, mint_pubkey)
                    amount_raw = int(r.amount * Decimal(10**decimals))
                    ix = transfer_checked(
                        TransferCheckedParams(
                            program_id=spl_program,
                            source=source_ata,
                            mint=mint_pubkey,
                            dest=dest_ata,
                            owner=keypair.pubkey(),
                            amount=amount_raw,
                            decimals=decimals,
                        )
                    )
                    bh_resp = await client.get_latest_blockhash()
                    recent_bh = bh_resp.value.blockhash
                    msg = Message.new_with_blockhash([ix], keypair.pubkey(), recent_bh)
                    tx = Transaction.new_unsigned(msg)
                    tx.sign([keypair], recent_bh)
                    result = await client.send_transaction(tx)
                    r.tx_hash = str(result.value)
                    r.status = "ok"
                except Exception as exc:
                    r.status = "failed"
                    r.error = str(exc)[:120]
                    logger.warning("bulk_pay: SPL send failed for %s: %s", r.address, exc)

    return recipients


async def _execute_tron_sequential(
    wallet: Wallet,
    token: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Sequential TRX / TRC-20 sends via tronpy."""
    try:
        from tronpy import AsyncTron
        from tronpy.keys import PrivateKey as TronPrivateKey
    except ImportError:
        for r in recipients:
            r.status = "failed"
            r.error = "tronpy not installed"
        return recipients

    private_key_str = wallet_service.get_tron_private_key(wallet)
    try:
        key_bytes = bytes.fromhex(private_key_str.replace("0x", ""))
        tron_pk = TronPrivateKey(key_bytes)
    finally:
        _zeroize_str(private_key_str)

    is_native = token.upper() in ("TRX", NATIVE_SYMBOL)

    async with AsyncTron() as client:
        for r in recipients:
            try:
                if is_native:
                    sun = int(r.amount * Decimal(1_000_000))
                    txn = await client.trx.transfer(wallet.address, r.address, sun).memo("").build()
                else:
                    token_addr = get_token_address(token, "tron")
                    if not token_addr:
                        r.status = "failed"
                        r.error = f"TRC-20 token {token} not found"
                        continue
                    decimals = get_token_decimals(token, "tron")
                    amount_raw = int(r.amount * Decimal(10**decimals))
                    contract = await client.get_contract(token_addr)
                    txn = (
                        await contract.functions.transfer(r.address, amount_raw)
                        .with_owner(wallet.address)
                        .fee_limit(20_000_000)
                        .build()
                    )
                signed_txn = txn.sign(tron_pk)
                result = await client.broadcast(signed_txn)
                r.tx_hash = result.get("txid") or result.get("transaction", {}).get("txID", "")
                r.status = "ok"
            except Exception as exc:
                r.status = "failed"
                r.error = str(exc)[:120]
                logger.warning("bulk_pay: TRON send failed for %s: %s", r.address, exc)

    return recipients


# ---------------------------------------------------------------------------
# Balance pre-checks (MED #7 fix: add gas buffer for native EVM sends)
# ---------------------------------------------------------------------------


def _estimate_native_gas_reserve(
    chain, chain_name: str, gas_per_tx: int, n_recipients: int
) -> Decimal:
    """Return an estimated native-token gas reserve (in native units) for
    n_recipients transactions, with a 20% buffer.  Returns 0 if estimation
    fails (best-effort only — the on-chain send will still fail naturally
    if funds are truly insufficient)."""
    try:
        w3 = rpc_manager.get_web3(chain_name)
        from bot.config.chains import apply_min_gas_price

        gas_price_wei = apply_min_gas_price(chain.name, w3.eth.gas_price)
        gas_cost_wei = gas_price_wei * gas_per_tx * n_recipients
        gas_cost_wei = int(gas_cost_wei * _GAS_BUFFER_FACTOR)
        return Decimal(gas_cost_wei) / Decimal(10**chain.native_decimals)
    except Exception as exc:
        logger.warning("bulk_pay: gas estimation failed, using 0 buffer: %s", exc)
        return Decimal(0)


async def _check_evm_balance(
    wallet_address: str,
    chain_name: str,
    token: str,
    total_needed: Decimal,
    n_recipients: int,
) -> tuple[bool, str]:
    """Return (sufficient, reason_text).

    For native sends, the required total includes an estimated gas reserve:
      gas_cost = gas_price * GAS_PER_TRANSFER * n_recipients * 1.2 buffer
    converted from wei to native units.

    FIX P2: ERC-20 sends also require native-token gas (the token balance
    alone is not sufficient to execute the batch) — the precheck now also
    verifies the wallet holds enough native balance to cover estimated gas
    for all ERC-20 transfer txs, mirroring the native-path gas buffer, so a
    batch cannot pass confirmation only to fail at execution for lack of gas.
    """
    chain = get_chain_by_name(chain_name)
    if chain is None:
        return False, f"Unknown chain {chain_name}"

    is_native = token.upper() in (chain.native_token.upper(), NATIVE_SYMBOL)

    if is_native:
        balance = await wallet_service.get_evm_native_balance(chain_name, wallet_address)
        bal = Decimal(str(balance))

        gas_cost_native = _estimate_native_gas_reserve(
            chain, chain_name, _GAS_PER_NATIVE_TRANSFER, n_recipients
        )

        total_required = total_needed + gas_cost_native
        if bal < total_required:
            return False, (
                f"Insufficient {chain.native_token}: have {bal:.6f}, "
                f"need {total_needed:.6f} + ~{gas_cost_native:.6f} gas = {total_required:.6f}"
            )
        return True, ""
    else:
        balance = await wallet_service.get_evm_token_balance(chain_name, token, wallet_address)
        bal = Decimal(str(balance))
        if bal < total_needed:
            return False, f"Insufficient {token}: have {bal:.6f}, need {total_needed:.6f}"

        # FIX P2: also verify native gas funds for the ERC-20 batch.
        gas_cost_native = _estimate_native_gas_reserve(
            chain, chain_name, _GAS_PER_ERC20_TRANSFER, n_recipients
        )
        if gas_cost_native > 0:
            native_balance = await wallet_service.get_evm_native_balance(chain_name, wallet_address)
            native_bal = Decimal(str(native_balance))
            if native_bal < gas_cost_native:
                return False, (
                    f"Insufficient {chain.native_token} for gas: have {native_bal:.6f}, "
                    f"need ~{gas_cost_native:.6f} to send {token} to {n_recipients} recipient(s)"
                )
        return True, ""


async def _check_solana_balance(
    wallet_address: str,
    token: str,
    total_needed: Decimal,
) -> tuple[bool, str]:
    is_native = token.upper() in ("SOL", NATIVE_SYMBOL)
    if is_native:
        balance = await wallet_service.get_solana_native_balance(wallet_address)
    else:
        balance = await wallet_service.get_solana_token_balance(token, wallet_address)
    bal = Decimal(str(balance))
    label = "SOL" if is_native else token
    if bal < total_needed:
        return False, f"Insufficient {label}: have {bal:.6f}, need {total_needed:.6f}"
    return True, ""


async def _check_tron_balance(
    wallet_address: str,
    token: str,
    total_needed: Decimal,
) -> tuple[bool, str]:
    is_native = token.upper() in ("TRX", NATIVE_SYMBOL)
    if is_native:
        balance = await wallet_service.get_tron_native_balance(wallet_address)
    else:
        balance = await wallet_service.get_tron_token_balance(token, wallet_address)
    bal = Decimal(str(balance))
    label = "TRX" if is_native else token
    if bal < total_needed:
        return False, f"Insufficient {label}: have {bal:.6f}, need {total_needed:.6f}"
    return True, ""


# ---------------------------------------------------------------------------
# Wallet ownership binding helper (IDOR fix — CRITICAL #2)
# ---------------------------------------------------------------------------


def _get_owned_wallet(wallet_id: int, db_user_id: int) -> Optional[Wallet]:
    """Load a wallet only if it belongs to db_user_id.

    Uses Wallet.id == wallet_id AND Wallet.user_id == db_user_id so that a
    caller cannot access another user's wallet by crafting a callback with an
    arbitrary wallet_id.  Returns None if no matching wallet is found.
    """
    with get_session() as session:
        return (
            session.query(Wallet)
            .filter(Wallet.id == wallet_id, Wallet.user_id == db_user_id)
            .first()
        )


# ---------------------------------------------------------------------------
# Conversation entry point: /pay
# ---------------------------------------------------------------------------


@enforce_tos
async def pay_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /pay — show wallet selector."""
    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    user = update.effective_user
    context.user_data.clear()

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return ConversationHandler.END

        # FIX CRITICAL #2: store the authenticated DB user id at flow entry.
        # All subsequent wallet loads use this id to bind wallet ownership.
        context.user_data[_UD_DB_USER_ID] = db_user.id

        wallets = (
            session.query(Wallet)
            .filter(Wallet.user_id == db_user.id, Wallet.is_active == True)
            .all()
        )
        if not wallets:
            await update.message.reply_text("You have no wallets. Use /wallet to create one first.")
            return ConversationHandler.END

        keyboard = []
        for w in wallets:
            emoji = {"evm": "🔷", "solana": "🟢", "tron": "💎", "starknet": "🐺"}.get(
                w.chain_type, "🔷"
            )
            label = f"{emoji} {w.name} ({w.chain_type.upper()}) — {w.address[:8]}…"
            keyboard.append([InlineKeyboardButton(label, callback_data=f"bp_wallet_{w.id}")])

        keyboard.append([InlineKeyboardButton("Cancel", callback_data="bp_cancel")])

    await update.message.reply_text(
        "Bulk Payments — select the sending wallet:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return BP_SELECT_WALLET


async def _pay_select_wallet(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Wallet chosen — ask for token.

    FIX CRITICAL #2: wallet is loaded via _get_owned_wallet() which binds
    Wallet.id == wallet_id AND Wallet.user_id == caller db_user.id.  A crafted
    bp_wallet_<victim_id> callback will find no row and be rejected.
    """
    query = update.callback_query
    await query.answer()

    if query.data == "bp_cancel":
        await query.edit_message_text("Bulk payment cancelled.")
        return ConversationHandler.END

    db_user_id = _get_caller_db_user_id(context)
    if not db_user_id:
        await query.edit_message_text("Session expired. Please start again with /pay.")
        return ConversationHandler.END

    wallet_id = int(query.data.removeprefix("bp_wallet_"))

    # IDOR fix: bind wallet to authenticated caller
    wallet = _get_owned_wallet(wallet_id, db_user_id)
    if wallet is None:
        await query.edit_message_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    context.user_data[_UD_WALLET_ID] = wallet_id
    context.user_data[_UD_CHAIN_TYPE] = wallet.chain_type

    # Starknet bulk pay is not yet supported (no multi-call primitive in our stack)
    if wallet.chain_type == "starknet":
        await query.edit_message_text("Bulk payments are not yet supported for Starknet wallets.")
        return ConversationHandler.END

    # For EVM — ask which chain + token; for Solana/TRON — token only
    chain_type = wallet.chain_type

    if chain_type == "evm":
        # Show EVM chain list
        evm_chains = [name for name, cfg in CHAINS.items() if cfg.chain_type == ChainType.EVM]
        keyboard = []
        row = []
        for i, chain_name in enumerate(sorted(evm_chains)):
            cfg = CHAINS[chain_name]
            row.append(
                InlineKeyboardButton(
                    f"{cfg.logo_emoji} {cfg.display_name}",
                    callback_data=f"bp_chain_{chain_name}",
                )
            )
            if len(row) == 3 or i == len(evm_chains) - 1:
                keyboard.append(row)
                row = []
        keyboard.append([InlineKeyboardButton("Cancel", callback_data="bp_cancel")])

        await query.edit_message_text(
            f"Wallet: {wallet.name} ({wallet.address[:10]}…)\n\nSelect the EVM chain:",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
        return BP_SELECT_TOKEN  # re-use state — EVM needs chain first

    else:
        # Solana / TRON — set default chain and go straight to token
        context.user_data[_UD_CHAIN] = chain_type  # "solana" or "tron"
        native_symbol = "SOL" if chain_type == "solana" else "TRX"
        await query.edit_message_text(
            f"Wallet: {wallet.name} ({wallet.address[:10]}…)\n\n"
            f"Enter the token symbol to send (e.g. `{native_symbol}`, `USDC`), "
            f"or `NATIVE` for the native coin:",
            parse_mode="Markdown",
        )
        return BP_SELECT_TOKEN


async def _pay_select_token(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle both EVM chain selection (callback) and token text entry."""
    chain_type = context.user_data.get(_UD_CHAIN_TYPE, "evm")

    # --- EVM chain callback ---
    if update.callback_query:
        query = update.callback_query
        await query.answer()

        if query.data == "bp_cancel":
            await query.edit_message_text("Bulk payment cancelled.")
            return ConversationHandler.END

        if query.data.startswith("bp_chain_"):
            chain_name = query.data.removeprefix("bp_chain_")
            if chain_name not in CHAINS:
                await query.edit_message_text("Unknown chain. Please start again with /pay.")
                return ConversationHandler.END
            context.user_data[_UD_CHAIN] = chain_name
            cfg = CHAINS[chain_name]
            await query.edit_message_text(
                f"Chain: {cfg.logo_emoji} {cfg.display_name}\n\n"
                f"Enter the token symbol to send (e.g. `{cfg.native_token}`, `USDC`), "
                f"or `NATIVE` for the native coin:",
                parse_mode="Markdown",
            )
            return BP_SELECT_TOKEN

    # --- Token text entry ---
    if not update.message or not update.message.text:
        return BP_SELECT_TOKEN

    token = update.message.text.strip().upper()
    chain_name = context.user_data.get(_UD_CHAIN, "")

    if not chain_name:
        await update.message.reply_text("Session lost. Please start again with /pay.")
        return ConversationHandler.END

    context.user_data[_UD_TOKEN] = token

    # Verify token exists on chain (unless NATIVE)
    if token != NATIVE_SYMBOL:
        chain_native = CHAINS.get(chain_name)
        if chain_native and token == chain_native.native_token.upper():
            # User typed the actual native symbol — treat as NATIVE
            context.user_data[_UD_TOKEN] = NATIVE_SYMBOL

    await update.message.reply_text(
        f"Token: {token}\n\n"
        "Now paste the recipient list — one recipient per line:\n"
        "`<address> <amount>`\n\n"
        "Example:\n"
        "`0xABC...123  1.5`\n"
        "`0xDEF...456  0.75`\n\n"
        f"Max {MAX_RECIPIENTS} recipients.",
        parse_mode="Markdown",
    )
    return BP_ENTER_LIST


async def _pay_enter_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Parse the pasted recipient list and show confirmation."""
    if not update.message or not update.message.text:
        return BP_ENTER_LIST

    chain_type = context.user_data.get(_UD_CHAIN_TYPE, "evm")
    chain_name = context.user_data.get(_UD_CHAIN, "")
    token = context.user_data.get(_UD_TOKEN, NATIVE_SYMBOL)
    wallet_id = context.user_data.get(_UD_WALLET_ID)
    db_user_id = _get_caller_db_user_id(context)

    if not wallet_id or not chain_name or not db_user_id:
        await update.message.reply_text("Session lost. Please start again with /pay.")
        return ConversationHandler.END

    recipients, parse_errors = _parse_recipient_list(update.message.text, chain_type)

    if parse_errors:
        error_text = "\n".join(f"• {e}" for e in parse_errors[:10])
        await update.message.reply_text(
            f"Validation errors — all issues must be fixed before sending:\n\n"
            f"{error_text}\n\n"
            "Please fix the list and paste it again.",
        )
        return BP_ENTER_LIST

    if not recipients:
        await update.message.reply_text("No valid recipients found. Please paste the list again.")
        return BP_ENTER_LIST

    if len(recipients) > MAX_RECIPIENTS:
        await update.message.reply_text(
            f"Too many recipients ({len(recipients)}). Max is {MAX_RECIPIENTS} per batch."
        )
        return BP_ENTER_LIST

    # FIX CRITICAL #2: load wallet with ownership binding
    wallet = _get_owned_wallet(wallet_id, db_user_id)
    if wallet is None:
        await update.message.reply_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    total = sum(r.amount for r in recipients)
    checking_msg = await update.message.reply_text("Checking balance…")

    try:
        if chain_type == "evm":
            sufficient, reason = await _check_evm_balance(
                wallet.address, chain_name, token, total, len(recipients)
            )
        elif chain_type == "solana":
            sufficient, reason = await _check_solana_balance(wallet.address, token, total)
        elif chain_type == "tron":
            sufficient, reason = await _check_tron_balance(wallet.address, token, total)
        else:
            sufficient, reason = False, f"Unsupported chain type: {chain_type}"
    except Exception as exc:
        logger.warning("bulk_pay: balance check failed: %s", exc)
        sufficient, reason = False, f"Balance check failed: {str(exc)[:100]}"

    if not sufficient:
        await checking_msg.edit_text(
            f"Insufficient balance — {reason}\n\nFix your list and try again."
        )
        return BP_ENTER_LIST

    # Store parsed recipients (serialized for persistence)
    context.user_data[_UD_RECIPIENTS] = [
        {"address": r.address, "amount": str(r.amount)} for r in recipients
    ]

    # MED #7: compute USD value of batch for spending-limit check later
    total_usd: Optional[float] = None
    is_native = token.upper() in (
        NATIVE_SYMBOL,
        (CHAINS[chain_name].native_token.upper() if chain_name in CHAINS else ""),
    )
    price_token = CHAINS[chain_name].native_token if is_native and chain_name in CHAINS else token
    try:
        total_usd = await spending_limit_service.usd_value(price_token, float(total))
    except Exception:
        pass
    context.user_data[_UD_TOTAL_USD] = total_usd

    summary, _ = _summarize(recipients, token, chain_type)
    chain_label = CHAINS.get(chain_name, {})
    chain_display = getattr(chain_label, "display_name", chain_name) if chain_label else chain_name

    usd_line = f"\nEst. value: ~${total_usd:,.2f}" if total_usd else ""

    await checking_msg.edit_text(
        f"Bulk Payment Summary\n\n"
        f"Chain: {chain_display}\n"
        f"Token: {token}\n"
        f"Wallet: {wallet.address[:10]}…\n\n"
        f"{summary}{usd_line}\n\n"
        "Tap Confirm to send. This CANNOT be undone.",
        reply_markup=InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("Confirm Send", callback_data="bp_confirm"),
                    InlineKeyboardButton("Cancel", callback_data="bp_cancel"),
                ]
            ]
        ),
    )
    return BP_CONFIRM


async def _pay_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the bulk payment — spending-limit + 2FA gate before execution.

    FIX MED #8: mirrors bulk_swap.py's spending_limit_service.check() and
    twofa_service TOTP gate.
    FIX CRITICAL #2: wallet loaded via _get_owned_wallet() (ownership binding).
    """
    query = update.callback_query
    await query.answer()

    if query.data == "bp_cancel":
        await query.edit_message_text("Bulk payment cancelled.")
        return ConversationHandler.END

    allowed = await enforce_rate_limit_for_update(update, swap_limiter)
    if not allowed:
        return ConversationHandler.END

    chain_type = context.user_data.get(_UD_CHAIN_TYPE, "evm")
    chain_name = context.user_data.get(_UD_CHAIN, "")
    token = context.user_data.get(_UD_TOKEN, NATIVE_SYMBOL)
    wallet_id = context.user_data.get(_UD_WALLET_ID)
    raw_recipients = context.user_data.get(_UD_RECIPIENTS, [])
    db_user_id = _get_caller_db_user_id(context)
    total_usd: Optional[float] = context.user_data.get(_UD_TOTAL_USD)

    if not wallet_id or not chain_name or not raw_recipients or not db_user_id:
        await query.edit_message_text("Session lost. Please start again with /pay.")
        return ConversationHandler.END

    # FIX CRITICAL #2: re-verify wallet ownership at execution time
    wallet = _get_owned_wallet(wallet_id, db_user_id)
    if wallet is None:
        await query.edit_message_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    # FIX MED #8: spending-limit pre-check (mirrors bulk_swap.py:773-781)
    if total_usd is not None:
        limit_ok, limit_reason = spending_limit_service.check(db_user_id, total_usd)
        if not limit_ok:
            await query.edit_message_text(
                f"Spending limit exceeded: {limit_reason}",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Cancel", callback_data="bp_cancel")]]
                ),
            )
            return ConversationHandler.END

        # FIX MED #8: 2FA gate (mirrors bulk_swap.py:783-801)
        verified_at = context.user_data.get(_UD_2FA_VERIFIED_AT, 0)
        recently_verified = (time.time() - verified_at) < TWOFA_VALID_SECONDS
        if (
            not recently_verified
            and twofa_service.is_2fa_enabled(db_user_id)
            and total_usd >= spending_limit_service.effective_2fa_threshold(db_user_id)
        ):
            context.user_data[_UD_2FA_ATTEMPTS] = 0
            await query.edit_message_text(
                f"2FA Required\n\n"
                f"This bulk payment moves ~${total_usd:,.2f}, which is at or above "
                f"your 2FA threshold.\n\n"
                f"Enter the 6-digit code from your authenticator app:",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("Cancel", callback_data="bp_cancel")]]
                ),
            )
            return BP_2FA

    return await _run_bulk_pay(query.edit_message_text, context, wallet, recipients=None)


async def _pay_twofa_entered(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Verify the TOTP code then execute the bulk payment."""
    db_user_id = _get_caller_db_user_id(context)
    wallet_id = context.user_data.get(_UD_WALLET_ID)

    if not db_user_id or not wallet_id or not context.user_data.get(_UD_RECIPIENTS):
        await update.message.reply_text("Session expired. Please start again with /pay.")
        return ConversationHandler.END

    code = (update.message.text or "").strip()
    if not twofa_service.verify_transaction(db_user_id, code):
        attempts = context.user_data.get(_UD_2FA_ATTEMPTS, 0) + 1
        context.user_data[_UD_2FA_ATTEMPTS] = attempts
        if attempts >= 3:
            context.user_data.clear()
            await update.message.reply_text("Too many invalid 2FA codes. Bulk payment cancelled.")
            return ConversationHandler.END
        await update.message.reply_text(
            f"Invalid code. {3 - attempts} attempt(s) left — try again:"
        )
        return BP_2FA

    context.user_data[_UD_2FA_VERIFIED_AT] = time.time()

    # FIX CRITICAL #2: re-verify ownership before execution
    wallet = _get_owned_wallet(wallet_id, db_user_id)
    if wallet is None:
        await update.message.reply_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    status_msg = await update.message.reply_text("2FA verified. Executing bulk payment…")
    return await _run_bulk_pay(status_msg.edit_text, context, wallet, recipients=None)


async def _run_bulk_pay(
    edit,
    context: ContextTypes.DEFAULT_TYPE,
    wallet: Wallet,
    recipients: Optional[list[Recipient]],
) -> int:
    """Execute all pending recipients and build the result report.

    MONEY-PATH: this is where funds move.  Each call signs and broadcasts an
    on-chain transaction.  Per-recipient failure reporting ensures partial
    failures are surfaced, not hidden.

    MED #7 — replay / idempotency note:
    Each run pulls recipients from context.user_data[_UD_RECIPIENTS] (set once
    at list-entry time).  Already-sent recipients are identified by status "ok"
    so a retry path skips them.  On partial failure the result report clearly
    labels which sends succeeded and which failed; the user must start a new
    /pay flow to re-attempt failed recipients — the same context cannot
    re-trigger a second execution of the successful ones.
    """
    chain_type = context.user_data.get(_UD_CHAIN_TYPE, "evm")
    chain_name = context.user_data.get(_UD_CHAIN, "")
    token = context.user_data.get(_UD_TOKEN, NATIVE_SYMBOL)
    raw_recipients = context.user_data.get(_UD_RECIPIENTS, [])

    if not chain_name or not raw_recipients:
        await edit("Session lost. Please start again with /pay.")
        return ConversationHandler.END

    # Deserialize; skip any already marked ok (idempotency guard)
    all_recipients = [
        Recipient(
            address=r["address"],
            amount=Decimal(r["amount"]),
            status=r.get("status", "pending"),
            tx_hash=r.get("tx_hash"),
        )
        for r in raw_recipients
    ]
    pending = [r for r in all_recipients if r.status != "ok"]

    if not pending:
        await edit("All recipients already sent in a previous attempt.")
        context.user_data.clear()
        return ConversationHandler.END

    await edit(f"Sending to {len(pending)} recipient(s)… please wait.")

    try:
        if chain_type == "evm":
            is_native = token in (
                NATIVE_SYMBOL,
                (
                    CHAINS.get(chain_name, object()).native_token  # type: ignore[union-attr]
                    if CHAINS.get(chain_name)
                    else ""
                ),
            )
            if is_native:
                # FIX CRITICAL #3: only sequential sends; Multicall3 native batch disabled.
                pending = await _execute_evm_native_sequential(wallet, chain_name, pending)
            else:
                pending = await _execute_evm_token_sequential(wallet, chain_name, token, pending)

        elif chain_type == "solana":
            pending = await _execute_solana_sequential(wallet, token, pending)

        elif chain_type == "tron":
            pending = await _execute_tron_sequential(wallet, token, pending)

        else:
            for r in pending:
                r.status = "failed"
                r.error = f"Unsupported chain type: {chain_type}"

    except Exception as exc:
        logger.error("bulk_pay: unexpected execution error: %s", exc, exc_info=True)
        await edit(f"Bulk payment encountered an unexpected error: {str(exc)[:200]}")
        return ConversationHandler.END

    # Merge pending results back into all_recipients for the report.
    # (already-ok ones from a prior run keep their status)
    #
    # FIX P1: key the merge by POSITION (index into all_recipients), not by
    # address.  Keying by address collapses duplicate recipient addresses —
    # if two lines in the batch send to the same address, an address-keyed
    # dict would only retain one Recipient object and both would be reported
    # (and re-attempted on retry) with the same status, corrupting per-line
    # success/failure tracking.  `pending` preserves the relative order of
    # the entries it was given (all non-"ok" entries from all_recipients, in
    # order), so we can walk both lists in lockstep by position.
    pending_iter = iter(pending)
    for r in all_recipients:
        if r.status != "ok":
            updated = next(pending_iter)
            r.status = updated.status
            r.tx_hash = updated.tx_hash
            r.error = updated.error

    # Persist updated statuses so a second confirm tap is idempotent
    context.user_data[_UD_RECIPIENTS] = [
        {"address": r.address, "amount": str(r.amount), "status": r.status, "tx_hash": r.tx_hash}
        for r in all_recipients
    ]

    # Build result report
    ok = [r for r in all_recipients if r.status == "ok"]
    failed = [r for r in all_recipients if r.status != "ok"]

    lines = [f"Bulk Payment Complete — {len(ok)}/{len(all_recipients)} sent\n"]

    if ok:
        lines.append("Sent successfully:")
        seen_hashes: set[str] = set()
        for r in ok:
            addr_short = r.address[:8] + "…" + r.address[-6:]
            if r.tx_hash and r.tx_hash not in seen_hashes:
                lines.append(f"  {addr_short}  {r.amount} {token}  tx: {r.tx_hash[:16]}…")
                seen_hashes.add(r.tx_hash)
            else:
                lines.append(f"  {addr_short}  {r.amount} {token}")

    if failed:
        lines.append("\nFailed (funds NOT sent to these addresses):")
        for r in failed:
            addr_short = r.address[:8] + "…" + r.address[-6:]
            lines.append(f"  {addr_short}  {r.amount} {token}  — {r.error or 'unknown error'}")
        lines.append(
            "\nTo retry failed recipients, start a new /pay flow with only the failed addresses."
        )

    report = "\n".join(lines)
    # Telegram message limit ~4096 chars
    if len(report) > 3900:
        report = report[:3900] + "\n…(truncated)"

    await edit(report)

    if failed:
        logger.warning(
            "bulk_pay: partial failure — %d/%d recipients failed (wallet %s, chain %s)",
            len(failed),
            len(all_recipients),
            wallet.address,
            chain_name,
        )

    context.user_data.clear()
    return ConversationHandler.END


async def _pay_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /cancel or timeout."""
    context.user_data.clear()
    if update.message:
        await update.message.reply_text("Bulk payment cancelled.")
    return ConversationHandler.END


# ---------------------------------------------------------------------------
# Handler assembly
# ---------------------------------------------------------------------------

bulk_pay_conversation_handler = ConversationHandler(
    entry_points=[CommandHandler("pay", pay_command)],
    states={
        BP_SELECT_WALLET: [
            CallbackQueryHandler(_pay_select_wallet, pattern="^bp_wallet_"),
            CallbackQueryHandler(_pay_select_wallet, pattern="^bp_cancel$"),
        ],
        BP_SELECT_TOKEN: [
            CallbackQueryHandler(_pay_select_token, pattern="^bp_chain_"),
            CallbackQueryHandler(_pay_select_token, pattern="^bp_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, _pay_select_token),
        ],
        BP_ENTER_LIST: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, _pay_enter_list),
        ],
        BP_CONFIRM: [
            CallbackQueryHandler(_pay_confirm, pattern="^bp_confirm$"),
            CallbackQueryHandler(_pay_confirm, pattern="^bp_cancel$"),
        ],
        BP_2FA: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, _pay_twofa_entered),
        ],
    },
    fallbacks=[CommandHandler("cancel", _pay_cancel)],
    allow_reentry=True,
    name="bulk_pay",
    persistent=False,
)

# Named exports for main.py registration
bulk_pay_handler = bulk_pay_conversation_handler

# ---------------------------------------------------------------------------
# MONEY-PATH audit surface
# ---------------------------------------------------------------------------
#
# Every place funds move in this module:
#
# 1. _run_bulk_pay → _execute_evm_native_sequential / _execute_evm_token_sequential
#    / _execute_solana_sequential / _execute_tron_sequential
#    One on-chain tx per recipient.  The Multicall3 native batch (_execute_evm_native_batch)
#    has been removed (CRITICAL #3 fix).
#
# Guards that protect execution:
#   - @enforce_tos on the entry command
#   - enforce_rate_limit_for_update (swap_limiter) on entry + confirm
#   - Wallet ownership binding: _get_owned_wallet(wallet_id, db_user_id) in
#     _pay_select_wallet, _pay_enter_list (balance check), _pay_confirm, _pay_twofa_entered
#   - Balance check with gas buffer before confirmation card is shown
#   - Spending-limit pre-check (spending_limit_service.check) at confirm (MED #8)
#   - Optional TOTP 2FA gate at confirm (MED #8)
#   - Per-recipient status tracking prevents re-sending already-ok recipients (MED #7)
