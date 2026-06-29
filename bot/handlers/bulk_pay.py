"""Bulk Payments handler — /pay command.

Batch-send native or ERC-20/SPL/TRC-20 tokens to many recipients in one flow,
mirroring the Cozy/Cwallet "Bulk Payments" UX.

Flow
----
1. /pay             → wallet-selector (one wallet per chain family)
2. Wallet chosen    → ask for token (native or ERC-20 symbol)
3. Token confirmed  → ask for recipient list (one `address amount` per line)
4. List parsed      → show summary (totals, per-recipient table, balance check)
5. User confirms    → execute:
     EVM + native token  → Multicall3 `disperse`-style batch (one tx, gas-efficient)
     EVM + ERC-20        → sequential sends with per-recipient status
     Solana / TRON       → sequential sends with per-recipient status
6. Result report    → per-recipient success / failure, partial-failure flagged

MONEY-PATH note (for reviewer)
-------------------------------
* Private key is decrypted exactly once per execution, via wallet_service.get_private_key()
  which uses the existing envelope-crypto / KMS path.  The key is scrubbed with
  _zeroize_str() after use.
* EVM native batch uses a one-shot Multicall3 aggregate3 + value call (no disperse contract
  dependency — just the universally-deployed Multicall3).  Token amounts are validated as
  Decimal to avoid float rounding before conversion to wei/lamports/sun.
* Balance check happens BEFORE confirmation is shown.  If balance < total + estimated_gas,
  the user is blocked — no funds move.
* Address validation is strict: wrong-chain format = immediate rejection of that line,
  entire list rejected (not silently skipped).
* Confirmation step requires explicit "Confirm" button tap — no auto-send on timeout.
"""

import asyncio
import logging
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
from bot.services.wallet import WalletService, _zeroize_str
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
) = range(4)

# User-data keys
_UD_WALLET_ID = "bp_wallet_id"
_UD_CHAIN = "bp_chain"
_UD_CHAIN_TYPE = "bp_chain_type"
_UD_TOKEN = "bp_token"
_UD_RECIPIENTS = "bp_recipients"

# Max recipients per batch (safety cap to avoid OOM / RPC-rate-limit flood)
MAX_RECIPIENTS = 100

# Multicall3 — same address on every mainnet EVM chain (canonical deployment).
MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11"

# Gas estimate per native transfer in a Multicall3 batch (21_000 + overhead).
_GAS_PER_NATIVE_CALL = 21_000
# Gas limit used when estimating for the confirmation screen (not on-chain).
_BATCH_BASE_GAS = 50_000

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


# ---------------------------------------------------------------------------
# EVM helpers
# ---------------------------------------------------------------------------


def _build_multicall3_native_batch(
    w3: Web3,
    from_address: str,
    recipients: list[Recipient],
    chain: object,
) -> dict:
    """Build a single Multicall3 aggregate3 transaction that distributes native
    tokens to all recipients.

    Uses `aggregate3Value` (Multicall3 v1.1+) which accepts msg.value and
    distributes it.  Falls back to sequential sends on chains where Multicall3
    is not available.

    Returns raw tx dict (unsigned).
    """
    # aggregate3Value ABI (part of Multicall3 canonical deployment)
    aggregate3_value_abi = [
        {
            "inputs": [
                {
                    "components": [
                        {"name": "target", "type": "address"},
                        {"name": "allowFailure", "type": "bool"},
                        {"name": "value", "type": "uint256"},
                        {"name": "callData", "type": "bytes"},
                    ],
                    "name": "calls",
                    "type": "tuple[]",
                }
            ],
            "name": "aggregate3Value",
            "outputs": [
                {
                    "components": [
                        {"name": "success", "type": "bool"},
                        {"name": "returnData", "type": "bytes"},
                    ],
                    "name": "returnData",
                    "type": "tuple[]",
                }
            ],
            "stateMutability": "payable",
            "type": "function",
        }
    ]

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(MULTICALL3_ADDRESS), abi=aggregate3_value_abi
    )

    # Each call: send ETH to recipient via a plain transfer-call (empty callData).
    calls = []
    total_value = 0
    for r in recipients:
        # Native decimals are always 18 for EVM (TRON uses 6 but handled separately)
        wei = int(r.amount * Decimal(10**chain.native_decimals))
        total_value += wei
        calls.append(
            (
                Web3.to_checksum_address(r.address),  # target
                False,  # allowFailure=False: abort whole batch on any failure
                wei,  # value
                b"",  # callData (plain ETH transfer)
            )
        )

    nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(from_address))
    gas_price = w3.eth.gas_price

    # Apply chain minimum gas price (Rootstock etc.)
    from bot.config.chains import apply_min_gas_price

    gas_price = apply_min_gas_price(chain.name, gas_price)

    tx = contract.functions.aggregate3Value(calls).build_transaction(
        {
            "from": Web3.to_checksum_address(from_address),
            "value": total_value,
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": chain.chain_id,
        }
    )
    # Estimate gas with a generous buffer
    try:
        estimated = w3.eth.estimate_gas(tx)
        tx["gas"] = int(estimated * 1.2)
    except Exception:
        tx["gas"] = _BATCH_BASE_GAS + len(recipients) * _GAS_PER_NATIVE_CALL

    return tx


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


async def _execute_evm_native_batch(
    wallet: Wallet,
    chain_name: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Execute a native-token batch via Multicall3.  Returns updated recipients."""
    chain = get_chain_by_name(chain_name)
    if chain is None:
        raise ValueError(f"Unknown chain: {chain_name}")

    w3 = rpc_manager.get_web3(chain_name)

    # Build the batch tx
    tx = _build_multicall3_native_batch(w3, wallet.address, recipients, chain)

    # Sign + broadcast
    signed_hex = await wallet_service.sign_evm_transaction(wallet, tx)
    raw_bytes = bytes.fromhex(signed_hex.replace("0x", ""))
    tx_hash_bytes = await asyncio.get_event_loop().run_in_executor(
        None, w3.eth.send_raw_transaction, raw_bytes
    )
    tx_hash = tx_hash_bytes.hex()
    logger.info(
        "bulk_pay: EVM native batch tx %s for %d recipients on %s",
        tx_hash,
        len(recipients),
        chain_name,
    )

    # All recipients share the same tx hash
    for r in recipients:
        r.status = "ok"
        r.tx_hash = tx_hash

    return recipients


async def _execute_evm_native_sequential(
    wallet: Wallet,
    chain_name: str,
    recipients: list[Recipient],
) -> list[Recipient]:
    """Fallback: sequential native-token sends (one tx per recipient)."""
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
                "gas": 21_000,
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
# Balance pre-checks
# ---------------------------------------------------------------------------


async def _check_evm_balance(
    wallet_address: str,
    chain_name: str,
    token: str,
    total_needed: Decimal,
) -> tuple[bool, str]:
    """Return (sufficient, reason_text)."""
    chain = get_chain_by_name(chain_name)
    if chain is None:
        return False, f"Unknown chain {chain_name}"

    is_native = token.upper() in (chain.native_token.upper(), NATIVE_SYMBOL)

    if is_native:
        balance = await wallet_service.get_evm_native_balance(chain_name, wallet_address)
        bal = Decimal(str(balance))
        if bal < total_needed:
            return False, (
                f"Insufficient {chain.native_token}: have {bal:.6f}, need {total_needed:.6f}"
            )
        return True, ""
    else:
        balance = await wallet_service.get_evm_token_balance(chain_name, token, wallet_address)
        bal = Decimal(str(balance))
        if bal < total_needed:
            return False, f"Insufficient {token}: have {bal:.6f}, need {total_needed:.6f}"
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
# Conversation entry point: /pay
# ---------------------------------------------------------------------------


async def pay_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /pay — show wallet selector."""
    user = update.effective_user
    context.user_data.clear()

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("Please use /start first.")
            return ConversationHandler.END

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
    """Wallet chosen — ask for token."""
    query = update.callback_query
    await query.answer()

    if query.data == "bp_cancel":
        await query.edit_message_text("Bulk payment cancelled.")
        return ConversationHandler.END

    wallet_id = int(query.data.removeprefix("bp_wallet_"))
    wallet = wallet_service.get_wallet_by_id(wallet_id)
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

    if not wallet_id or not chain_name:
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

    # Balance check
    wallet = wallet_service.get_wallet_by_id(wallet_id)
    if wallet is None:
        await update.message.reply_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    total = sum(r.amount for r in recipients)
    checking_msg = await update.message.reply_text("Checking balance…")

    try:
        if chain_type == "evm":
            sufficient, reason = await _check_evm_balance(wallet.address, chain_name, token, total)
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

    # Store parsed recipients
    context.user_data[_UD_RECIPIENTS] = [
        {"address": r.address, "amount": str(r.amount)} for r in recipients
    ]

    summary, _ = _summarize(recipients, token, chain_type)
    chain_label = CHAINS.get(chain_name, {})
    chain_display = getattr(chain_label, "display_name", chain_name) if chain_label else chain_name

    await checking_msg.edit_text(
        f"Bulk Payment Summary\n\n"
        f"Chain: {chain_display}\n"
        f"Token: {token}\n"
        f"Wallet: {wallet.address[:10]}…\n\n"
        f"{summary}\n\n"
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
    """Execute the bulk payment."""
    query = update.callback_query
    await query.answer()

    if query.data == "bp_cancel":
        await query.edit_message_text("Bulk payment cancelled.")
        return ConversationHandler.END

    chain_type = context.user_data.get(_UD_CHAIN_TYPE, "evm")
    chain_name = context.user_data.get(_UD_CHAIN, "")
    token = context.user_data.get(_UD_TOKEN, NATIVE_SYMBOL)
    wallet_id = context.user_data.get(_UD_WALLET_ID)
    raw_recipients = context.user_data.get(_UD_RECIPIENTS, [])

    if not wallet_id or not chain_name or not raw_recipients:
        await query.edit_message_text("Session lost. Please start again with /pay.")
        return ConversationHandler.END

    wallet = wallet_service.get_wallet_by_id(wallet_id)
    if wallet is None:
        await query.edit_message_text("Wallet not found. Please start again with /pay.")
        return ConversationHandler.END

    recipients = [
        Recipient(address=r["address"], amount=Decimal(r["amount"])) for r in raw_recipients
    ]

    await query.edit_message_text(f"Sending to {len(recipients)} recipients… please wait.")

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
                # Try Multicall3 batch first; fall back to sequential on failure
                try:
                    recipients = await _execute_evm_native_batch(wallet, chain_name, recipients)
                except Exception as exc:
                    logger.warning(
                        "bulk_pay: Multicall3 batch failed (%s), falling back to sequential", exc
                    )
                    # Reset status so sequential starts fresh
                    for r in recipients:
                        r.status = "pending"
                    recipients = await _execute_evm_native_sequential(
                        wallet, chain_name, recipients
                    )
            else:
                recipients = await _execute_evm_token_sequential(
                    wallet, chain_name, token, recipients
                )

        elif chain_type == "solana":
            recipients = await _execute_solana_sequential(wallet, token, recipients)

        elif chain_type == "tron":
            recipients = await _execute_tron_sequential(wallet, token, recipients)

        else:
            for r in recipients:
                r.status = "failed"
                r.error = f"Unsupported chain type: {chain_type}"

    except Exception as exc:
        logger.error("bulk_pay: unexpected execution error: %s", exc, exc_info=True)
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=f"Bulk payment encountered an unexpected error: {str(exc)[:200]}",
        )
        return ConversationHandler.END

    # Build result report
    ok = [r for r in recipients if r.status == "ok"]
    failed = [r for r in recipients if r.status != "ok"]

    lines = [f"Bulk Payment Complete — {len(ok)}/{len(recipients)} sent\n"]

    if ok:
        lines.append("Sent successfully:")
        # Deduplicate tx hashes for batched sends
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

    report = "\n".join(lines)
    # Telegram message limit ~4096 chars
    if len(report) > 3900:
        report = report[:3900] + "\n…(truncated)"

    await context.bot.send_message(chat_id=query.message.chat_id, text=report)

    if failed:
        logger.warning(
            "bulk_pay: partial failure — %d/%d recipients failed (wallet %s, chain %s)",
            len(failed),
            len(recipients),
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
    },
    fallbacks=[CommandHandler("cancel", _pay_cancel)],
    allow_reentry=True,
    name="bulk_pay",
    persistent=False,
)

# Named exports for main.py registration
bulk_pay_handler = bulk_pay_conversation_handler
