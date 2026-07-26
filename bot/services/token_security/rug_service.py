"""Rug Protection Service for Solana."""

import logging
import asyncio
import json
from typing import Any, Dict, List, Optional
import websockets

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.swap_engine import SwapEngine
from bot.services.wallet import WalletService
from bot.utils.http_client import get_session as get_http_session
from bot.models.user import User, Wallet
from bot.models.favorites import UserSettings
from bot.models.swap import SwapTransaction
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Program IDs to monitor
RAYDIUM_AMM = "675kPX9MHTjS2zt1qnt1dJLv765qL8p1kS47Ktr9GWh7"
PUMP_FUN_BONDING = "6EF8rrecthRzztZ6f34idMND7tV36o995mX8s2L2cS"

# Wrapped SOL + major stablecoin mints. A liquidity-removal tx always moves
# one of these on one side of the pair — we want the *other* (rugged) token,
# so these are excluded when scanning pre/postTokenBalances for candidates.
WSOL_MINT = "So11111111111111111111111111111111111111112"
STABLE_MINTS = frozenset(
    {
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  # USDC
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  # USDT
    }
)

# --- C1 hardening -----------------------------------------------------------
# Minimum fraction of a pool vault's PRE-withdrawal balance that must be
# removed for a detected Raydium instruction to count as a real liquidity
# rug (as opposed to dust or a tiny partial withdrawal). Deliberately
# conservative: a false negative just means a user isn't auto-protected (they
# can still sell manually); a false positive forces a 25%-slippage market
# sell of a user's ENTIRE balance.
RUG_WITHDRAWAL_MIN_FRACTION = 0.5

# --- B1 hardening -------------------------------------------------------
# RUG_WITHDRAWAL_MIN_FRACTION alone is PURELY RELATIVE: a pool seeded with
# $5 and withdrawn 100% qualifies identically to a real $5M pool withdrawn
# 100%. Raydium AMM v4 pools are permissionless to create, so the actual
# adversarial path is: attacker buys a little of victim mint X, creates a
# brand-new Raydium pool for (X, WSOL) seeded with a few dollars, and
# immediately withdraws 100% of it in one tx -- every opted-in holder of X
# then gets force-sold at 25% slippage over a signal that cost the attacker
# pocket change to forge.
#
# We can't price the victim mint X itself (that's the whole point of a rug
# -- its "price" is whatever the attacker wants it to look like), but every
# qualifying tx has exactly one non-WSOL/non-stable candidate LEFT after
# WSOL_MINT/STABLE_MINTS are excluded (see the module-level comment above),
# which means the PAIRED side of the pool -- the vault we just excluded --
# MUST have been WSOL or a stablecoin. That side we CAN price: WSOL via
# price_service (SOL/USD), stables at their ~1:1 USD peg. This constant is
# the minimum USD value that paired vault's PRE-withdrawal balance must
# have held for the withdrawal to count as a real rug.
#
# $35,000 default, settings-tunable (RUG_MIN_DRAINED_NOTIONAL_USD env var /
# settings.rug_min_drained_notional_usd): chosen as a conservative middle of
# the requested $25k-50k range. An attacker-seeded decoy pool (bought with
# throwaway capital just to forge a withdrawal signal) is realistically
# single-digit-to-low-hundreds of dollars -- $35k gives wide margin above
# that. A pool that legitimately attracted third-party liquidity worth
# protecting against losing is typically far larger than $35k in practice,
# so this floor is not expected to meaningfully raise the false-negative
# rate on real rugs. The accepted tradeoff (same philosophy as
# RUG_WITHDRAWAL_MIN_FRACTION above): a small BUT genuine rug under this
# floor is a false negative (user isn't auto-protected, can still sell
# manually) -- strictly preferred over a false positive that forces a
# 25%-slippage market sell of a user's entire balance over a $5 decoy.
RUG_MIN_DRAINED_NOTIONAL_USD = settings.rug_min_drained_notional_usd

# --- C3 hardening -----------------------------------------------------------
# getTransaction retry knobs. logsSubscribe fires at "processed" commitment,
# but a signature seen at "processed" is routinely not yet visible to
# getTransaction even at "confirmed" commitment (and getTransaction defaults
# to "finalized" if no commitment is passed at all, which is worse). A few
# short retries turn "not indexed yet" into a real lookup instead of an
# automatic None.
RUG_TX_FETCH_MAX_ATTEMPTS = 3
RUG_TX_FETCH_RETRY_DELAY_SECONDS = 0.5


# ---------------------------------------------------------------------------
# Transaction-parsing helpers (module-level, pure — easy to unit test)
# ---------------------------------------------------------------------------


def _account_key_str(key: Any) -> Optional[str]:
    """Normalize one accountKeys entry to a pubkey string.

    getTransaction(encoding="jsonParsed") returns message.accountKeys as
    {"pubkey": ..., "signer": ..., "writable": ..., "source": ...} objects
    (richer than the bare base58 strings other encodings use). Accept both
    shapes defensively.
    """
    if isinstance(key, str):
        return key
    if isinstance(key, dict):
        return key.get("pubkey")
    return None


def _resolve_account_keys(message: Dict[str, Any], meta: Dict[str, Any]) -> List[str]:
    """Build the ordered pubkey list matching the indices used by
    preTokenBalances/postTokenBalances[].accountIndex: static accountKeys
    first, then any v0 address-lookup-table addresses (writable, then
    readonly) appended via meta.loadedAddresses.
    """
    keys = [k for k in (_account_key_str(k) for k in message.get("accountKeys") or []) if k]
    loaded = meta.get("loadedAddresses") or {}
    keys.extend(a for a in loaded.get("writable") or [] if isinstance(a, str))
    keys.extend(a for a in loaded.get("readonly") or [] if isinstance(a, str))
    return keys


def _instruction_accounts(instruction: Dict[str, Any], account_keys: List[str]) -> List[str]:
    """Normalize an instruction's `accounts` field to pubkey strings.

    jsonParsed PartiallyDecodedInstructions (unparseable programs, e.g.
    Raydium's AMM) already resolve `accounts` to pubkey strings; handle raw
    integer indices too, defensively, in case of a differing RPC response
    shape.
    """
    resolved = []
    for entry in instruction.get("accounts") or []:
        if isinstance(entry, str):
            resolved.append(entry)
        elif isinstance(entry, int) and 0 <= entry < len(account_keys):
            resolved.append(account_keys[entry])
    return resolved


def _iter_program_instructions(tx_data: Dict[str, Any], program_id: str) -> List[Dict[str, Any]]:
    """Return every top-level AND inner (CPI) instruction whose programId
    matches `program_id` — i.e. instructions the program actually EXECUTED.

    This is deliberately distinct from logsSubscribe's `{"mentions": [...]}`
    filter, which matches any transaction that merely REFERENCES the account
    (e.g. as a bare, unused account key alongside an unrelated Memo log
    containing the word "withdraw"). Only an executed instruction proves the
    program actually ran.
    """
    matches: List[Dict[str, Any]] = []

    message = (tx_data.get("transaction") or {}).get("message") or {}
    for ix in message.get("instructions") or []:
        if ix.get("programId") == program_id:
            matches.append(ix)

    meta = tx_data.get("meta") or {}
    for inner in meta.get("innerInstructions") or []:
        for ix in inner.get("instructions") or []:
            if ix.get("programId") == program_id:
                matches.append(ix)

    return matches


def _ui_amount(entry: Optional[Dict[str, Any]]) -> float:
    """Extract a token-balance entry's uiAmount as a float (0.0 if absent)."""
    if not entry:
        return 0.0
    amount = entry.get("uiTokenAmount") or {}
    raw = amount.get("uiAmount")
    if raw is None:
        raw = amount.get("uiAmountString")
    try:
        return float(raw) if raw is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


class RugService:
    """Monitors Raydium AMM logs for verified rug events and frontruns with
    opt-in Panic Sells.

    MONEY-PATH: gated off by settings.rug_auto_sell_enabled (default False).
    Even with the C1 hardening below, this service moves user funds
    unattended off a public log/mempool signal — it must stay behind an
    explicit, deliberate opt-in.
    """

    # B2: class-level flag so the "holder lookup is a known non-functional
    # gap" warning below fires once per process (loud, but not spammed on
    # every detected rug event).
    _b2_holder_lookup_warning_logged = False

    def __init__(self):
        self._running = False
        self._ws_task = None
        self._swap_engine = None
        self._wallet_service = WalletService()
        self._ws_url = (
            rpc_manager.get_rpc_url("solana")
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        )

    async def start(self, swap_engine: SwapEngine):
        """Start the rug monitoring service."""
        if not settings.rug_auto_sell_enabled:
            logger.info(
                "⏭️ Rug Protection Service NOT started — RUG_AUTO_SELL_ENABLED is "
                "False (default). This is a money-path auto-sell service; flip it "
                "on deliberately once you're comfortable with it."
            )
            return

        if self._running:
            return

        self._running = True
        self._swap_engine = swap_engine
        self._ws_task = asyncio.create_task(self._monitor_loop())
        logger.info("Rug Protection Service started")

    async def stop(self):
        """Stop the monitoring service."""
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()
        logger.info("Rug Protection Service stopped")

    async def _monitor_loop(self):
        """Websocket loop to monitor program logs."""
        while self._running:
            try:
                async with websockets.connect(self._ws_url) as ws:
                    # Subscribe to Raydium logs
                    subscribe_msg = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "logsSubscribe",
                        "params": [{"mentions": [RAYDIUM_AMM]}, {"commitment": "processed"}],
                    }
                    await ws.send(json.dumps(subscribe_msg))
                    logger.info(f"Subscribed to Raydium logs on {self._ws_url}")

                    while self._running:
                        msg = await ws.recv()
                        data = json.loads(msg)

                        if "params" in data:
                            logs = data["params"]["result"]["value"]["logs"]
                            signature = data["params"]["result"]["value"]["signature"]

                            # Cheap pre-filter only — logsSubscribe({"mentions": [...]})
                            # matches any tx that merely references the account, and
                            # these log strings are attacker-controllable (e.g. a Memo
                            # instruction). The real verification (was RAYDIUM_AMM an
                            # EXECUTED instruction, and did it drain a meaningful share
                            # of a pool vault) happens in _extract_token_mint_from_tx.
                            if any(
                                "withdraw" in log.lower() or "removeliquidity" in log.lower()
                                for log in logs
                            ):
                                await self._handle_potential_rug(logs, signature)

            except Exception as e:
                logger.error(f"Rug monitor loop error: {e}")
                await asyncio.sleep(5)  # Backoff

    async def _handle_potential_rug(self, logs: List[str], signature: str):
        """Process a suspicious transaction."""
        logger.warning(f"🚨 Potential Rug detected in tx {signature}!")

        # 1. Identify which token is being rugged by fetching + verifying the
        # transaction that triggered detection. Never falls back to a fake
        # mint — a None here means we genuinely don't know what to protect,
        # so we bail out rather than risk acting on the wrong token.
        token_mint = await self._extract_token_mint_from_tx(signature)
        if not token_mint:
            logger.warning(
                f"Rug detection: could not verify a rugged token mint for tx {signature}; skipping"
            )
            return

        # 2. Find all users who hold this token AND have panic sell enabled
        users_to_protect = await self._get_users_holding_token(token_mint)

        if not users_to_protect:
            return

        logger.info(f"Protecting {len(users_to_protect)} users from rug on {token_mint}")

        # 3. Trigger Frontrun Sells via the swap engine (per-user idempotent —
        # see H1 fix in _execute_panic_sell)
        tasks = []
        for user_id, wallet_id in users_to_protect:
            tasks.append(self._execute_panic_sell(user_id, wallet_id, token_mint, signature))

        if tasks:
            await asyncio.gather(*tasks)

    async def _get_users_holding_token(self, token_mint: str) -> List[tuple]:
        """Find opted-in users with a completed swap into this token, paired
        with each user's own DEFAULT Solana wallet.

        H3: reads UserSettings.panic_sell_enabled — the column the Telegram
        /set UI actually toggles (bot/handlers/settings.py). The old query
        filtered on User.panic_sell_enabled, a *different* column only the
        WhatsApp flow writes, so Telegram Pro users who enabled Panic Sell
        were silently never protected.

        H2: resolves each qualifying user's default Solana wallet directly
        (WalletService.get_default_wallet, which already filters chain_type
        + is_active) instead of joining User x Wallet x SwapTransaction. That
        join produced a cartesian product — one row per (wallet, matching
        swap) pair, with no chain or active-wallet filter — so a user's EVM
        wallet id could be handed to the Solana sell path, and a user with
        multiple wallets or multiple matching swaps could be returned
        multiple times.

        B2 — KNOWN NON-FUNCTIONAL GAP, NOT FIXED HERE: `SwapTransaction.to_token`
        is a `String(20)` column populated from `quote.to_token`, which is a
        token SYMBOL (e.g. "PEPE"), never a mint/contract address (see
        swap_engine.py ~2662, `to_token` docstring "Destination token
        symbol"). A Solana mint is 43-44 base58 characters, so
        `SwapTransaction.to_token == token_mint` can only match a real mint
        on a database that doesn't enforce the column's declared length —
        i.e. SQLite (used in tests), never Postgres (used in production).
        There is no mint/contract-address column on SwapTransaction to
        join/filter on instead; adding one is a schema migration and out of
        scope for this fix (migrations here are additive and deliberate, not
        invented ad hoc mid-fix). NET EFFECT: this holder lookup is currently
        a NO-OP against real trading data — `_handle_potential_rug` can
        detect a fully-verified rug and then find zero holders to protect,
        even with `rug_auto_sell_enabled=True` and users opted in. See the
        one-time `logger.warning` below; this is intentionally loud rather
        than silently left to rot as a comment nobody reads.
        """
        if not RugService._b2_holder_lookup_warning_logged:
            RugService._b2_holder_lookup_warning_logged = True
            logger.warning(
                "Rug Protection holder lookup (KNOWN GAP, B2): "
                "SwapTransaction.to_token stores a token SYMBOL (String(20), "
                "populated from quote.to_token), never a mint address, so "
                "matching it against a real Solana mint (43-44 chars) cannot "
                "succeed in production. There is no mint/contract-address "
                "column on SwapTransaction to match against instead (adding "
                "one is a schema migration, out of scope here). This means "
                "panic-sell holder lookup is currently a NO-OP against real "
                "trading data until a mint column is added -- see "
                "bot/services/token_security/rug_service.py::_get_users_holding_token."
            )

        with get_session() as session:
            rows = (
                session.query(User.id)
                .join(UserSettings, UserSettings.user_id == User.id)
                .join(SwapTransaction, SwapTransaction.user_id == User.id)
                .filter(
                    UserSettings.panic_sell_enabled == True,
                    SwapTransaction.to_token == token_mint,
                    SwapTransaction.status == "completed",
                )
                .distinct()
                .all()
            )
            user_ids = [row[0] for row in rows]

        holders: List[tuple] = []
        for user_id in user_ids:
            # B3: get_default_wallet() is a synchronous DB call; running N of
            # these directly in this async coroutine blocks the event loop
            # once per holder (N+1). Dispatch each to the run_in_db thread
            # pool instead (same helper used throughout swap_engine.py etc.).
            wallet = await run_in_db(self._wallet_service.get_default_wallet, user_id, "solana")
            if not wallet or not wallet.is_active or wallet.chain_type != "solana":
                continue
            holders.append((user_id, wallet.id))
        return holders

    async def _execute_panic_sell(
        self, user_id: int, wallet_id: int, token_mint: str, signature: str
    ):
        """Execute a 'Sell All' with Ultra Priority for a single user."""
        try:
            logger.info(f"Executing PANIC SELL for user {user_id} on {token_mint}")

            # 1. Get full balance
            wallet = self._wallet_service.get_wallet_by_id(wallet_id)
            if not wallet or wallet.chain_type != "solana" or not wallet.is_active:
                logger.warning(
                    f"Panic Sell skipped for user {user_id}: wallet {wallet_id} is not "
                    "an active Solana wallet"
                )
                return

            # C2: WalletService has no get_token_balance(wallet_id, chain, mint)
            # method. The real Solana balance lookup is
            # get_solana_token_balance(token_symbol_or_mint, address) —
            # get_token_address() passes raw base58 mints (len >= 32) through
            # unchanged, so passing token_mint directly works for arbitrary
            # (non-registry) mints, which is exactly what a rugged token is.
            balance = await self._wallet_service.get_solana_token_balance(
                token_mint, wallet.address
            )

            if balance <= 0:
                return

            # 2. Get Quote for Sell
            quote = await self._swap_engine.get_quote(
                from_chain="solana",
                to_chain="solana",
                from_token=token_mint,
                to_token="SOL",
                amount=balance,
                from_address=wallet.address,
                slippage=25.0,  # High slippage for panic sell (25%)
            )

            # H1: idempotency key MUST be unique per (user, wallet, triggering
            # tx). The old key was f"panic_sell:{token_mint}:{minute}" — shared
            # by every holder of the same token in the same minute — so with N
            # holders only the FIRST sell actually executed; every other
            # gather() call hit the same idempotency row in SwapEngine and
            # silently returned the FIRST user's SwapTransaction while logging
            # "success" for itself.
            idempotency_key = f"panic_sell:{user_id}:{wallet_id}:{signature}"

            # 3. Execute via the swap engine with URGENT priority
            await self._swap_engine.execute_swap(
                quote=quote,
                wallet_id=wallet_id,
                user_id=user_id,
                idempotency_key=idempotency_key,
            )

            logger.info(f"✅ Panic Sell SUCCESS for user {user_id}")

        except Exception as e:
            logger.error(f"Panic Sell failed for user {user_id}: {e}")

    async def _fetch_transaction(self, session, signature: str) -> Optional[Dict[str, Any]]:
        """getTransaction at 'confirmed' commitment with a bounded retry on a
        null result (C3).

        logsSubscribe fires at 'processed' commitment, but getTransaction had
        no commitment param at all, defaulting to 'finalized' — so a
        just-seen signature routinely returned null and extraction ALWAYS
        yielded None. 'confirmed' plus a short retry window closes that gap
        without waiting for full finalization.
        """
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                signature,
                {
                    "encoding": "jsonParsed",
                    "commitment": "confirmed",
                    "maxSupportedTransactionVersion": 0,
                },
            ],
        }

        for attempt in range(1, RUG_TX_FETCH_MAX_ATTEMPTS + 1):
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                if resp.status >= 400:
                    logger.warning(
                        f"Rug detection: getTransaction HTTP {resp.status} for tx {signature}"
                    )
                    return None
                result = await resp.json()

            if "error" in result:
                logger.warning(
                    f"Rug detection: getTransaction RPC error for tx {signature}: "
                    f"{result['error']}"
                )
                return None

            tx_data = result.get("result")
            if tx_data:
                return tx_data

            if attempt < RUG_TX_FETCH_MAX_ATTEMPTS:
                logger.info(
                    f"Rug detection: getTransaction null for tx {signature} "
                    f"(attempt {attempt}/{RUG_TX_FETCH_MAX_ATTEMPTS}); retrying"
                )
                await asyncio.sleep(RUG_TX_FETCH_RETRY_DELAY_SECONDS)

        logger.warning(
            f"Rug detection: getTransaction returned null after "
            f"{RUG_TX_FETCH_MAX_ATTEMPTS} attempts for tx {signature}"
        )
        return None

    async def _extract_token_mint_from_tx(self, signature: str) -> Optional[str]:
        """Fetch the triggering transaction and extract the token mint being
        removed from liquidity — ONLY if a Raydium AMM instruction was
        actually EXECUTED (top-level or via CPI), not merely referenced, and
        the withdrawal drained a meaningful share of THAT specific pool's own
        vault balance.

        Defensive by design: any missing data, RPC error, ambiguous result,
        or below-threshold withdrawal returns None. NEVER returns a fake,
        hardcoded, or tx-wide-inferred mint — callers must treat None as "do
        nothing".
        """
        try:
            session = await get_http_session()
            tx_data = await self._fetch_transaction(session, signature)
            if not tx_data:
                return None

            meta = tx_data.get("meta") or {}
            if meta.get("err") is not None:
                # The liquidity-removal tx itself failed on-chain — nothing happened.
                return None

            # --- C1 step 1: confirm RAYDIUM_AMM is the programId of an
            # EXECUTED instruction, not just an account the tx mentions.
            # logsSubscribe({"mentions": [RAYDIUM_AMM]}) matches any tx that
            # merely references the account — e.g. a bare, unused account key
            # plus an unrelated Memo log containing "withdraw" — which is
            # forgeable for a few thousand lamports.
            raydium_ixs = _iter_program_instructions(tx_data, RAYDIUM_AMM)
            if not raydium_ixs:
                logger.warning(
                    f"Rug detection: {RAYDIUM_AMM} was not an executed instruction "
                    f"program in tx {signature} (mentioned only); skipping"
                )
                return None

            message = (tx_data.get("transaction") or {}).get("message") or {}
            account_keys = _resolve_account_keys(message, meta)

            # --- C1 step 2: scope mint derivation to accounts the EXECUTED
            # Raydium instruction(s) actually touched (this pool's own
            # vaults/authority/etc.) rather than the tx-wide union of
            # pre/postTokenBalances. This is what stops an attacker padding
            # the transaction with an unrelated 1-unit self-transfer of the
            # victim mint elsewhere in the same tx.
            touched_accounts = set()
            for ix in raydium_ixs:
                touched_accounts.update(_instruction_accounts(ix, account_keys))

            if not touched_accounts:
                logger.warning(
                    f"Rug detection: could not resolve accounts touched by the "
                    f"Raydium instruction in tx {signature}; skipping"
                )
                return None

            pre_by_index = {e.get("accountIndex"): e for e in meta.get("preTokenBalances") or []}
            post_by_index = {e.get("accountIndex"): e for e in meta.get("postTokenBalances") or []}

            # --- C1 step 3: magnitude guard. Only a mint whose balance on one
            # of the Raydium instruction's own accounts DROPPED by more than
            # RUG_WITHDRAWAL_MIN_FRACTION counts as a real liquidity removal —
            # a dust withdrawal (or a decoy tx) never qualifies.
            #
            # B1: while we're at it, capture the drained PRE-balance of any
            # WSOL/stablecoin side that ALSO qualifies here (same magnitude
            # guard) as `paired_vault_notional_usd` — this is the pool's
            # paired-side dollar size, used below as an absolute floor on the
            # whole withdrawal. We can't price the victim mint itself, but
            # every qualifying rug tx has exactly one non-WSOL/non-stable
            # candidate left after this loop, which means the OTHER drained
            # side must have been WSOL or a stablecoin (see the module-level
            # comment on WSOL_MINT/STABLE_MINTS) — i.e. this is always
            # available for a real 2-sided AMM withdrawal.
            candidates: Dict[str, float] = {}
            paired_vault_notional_usd: Optional[float] = None
            sol_price_lookup_failed = False
            for idx in set(pre_by_index) | set(post_by_index):
                if idx is None or idx >= len(account_keys):
                    continue
                if account_keys[idx] not in touched_accounts:
                    continue

                pre_entry = pre_by_index.get(idx)
                post_entry = post_by_index.get(idx)
                mint = (pre_entry or post_entry or {}).get("mint")
                if not mint:
                    continue

                pre_amount = _ui_amount(pre_entry)
                post_amount = _ui_amount(post_entry)

                if pre_amount <= 0 or post_amount >= pre_amount:
                    continue  # nothing to withdraw, or not a decrease here

                removed_fraction = (pre_amount - post_amount) / pre_amount
                if removed_fraction <= RUG_WITHDRAWAL_MIN_FRACTION:
                    continue  # dust withdrawal — doesn't qualify

                if mint in STABLE_MINTS:
                    # ~1:1 USD peg — the drained pre-balance IS the dollar size.
                    paired_vault_notional_usd = pre_amount
                    continue

                if mint == WSOL_MINT:
                    sol_price = await self._get_sol_price_usd()
                    if sol_price is not None:
                        paired_vault_notional_usd = pre_amount * sol_price
                    else:
                        sol_price_lookup_failed = True
                    continue

                candidates[mint] = removed_fraction

            if len(candidates) != 1:
                logger.warning(
                    f"Rug detection: found {len(candidates)} qualifying candidate "
                    f"token mints (expected 1) for tx {signature}; skipping"
                )
                return None

            # --- B1 hardening: absolute USD floor -------------------------
            # RUG_WITHDRAWAL_MIN_FRACTION is purely relative (a $5 pool
            # drained 100% satisfies it identically to a $5M pool drained
            # 100%). Require the paired WSOL/stablecoin vault to have
            # actually held real money before treating this as a rug worth
            # force-selling a user's entire balance over.
            if paired_vault_notional_usd is None:
                logger.warning(
                    f"Rug detection: could not establish a USD notional for the "
                    f"paired WSOL/stablecoin vault in tx {signature} "
                    f"(sol_price_lookup_failed={sol_price_lookup_failed}); skipping "
                    f"rather than arm a panic-sell on an unpriced pool"
                )
                return None

            if paired_vault_notional_usd < RUG_MIN_DRAINED_NOTIONAL_USD:
                logger.warning(
                    f"Rug detection: paired vault pre-balance (~${paired_vault_notional_usd:,.2f}) "
                    f"in tx {signature} is below the ${RUG_MIN_DRAINED_NOTIONAL_USD:,.0f} "
                    f"absolute floor — likely a cheaply-seeded decoy pool, not a real "
                    f"liquidity rug; skipping"
                )
                return None

            return next(iter(candidates))

        except Exception as e:
            logger.warning(f"Rug detection: failed to extract token mint for tx {signature}: {e}")
            return None

    async def _get_sol_price_usd(self) -> Optional[float]:
        """SOL/USD price for converting a drained WSOL vault's pre-balance
        into a dollar notional for the B1 absolute-floor check.

        Imported lazily (same pattern used elsewhere, e.g. swap_engine.py
        ~5322) to avoid a module-load-time dependency cycle. Any failure
        (network, rate limit, unknown token) returns None — callers must
        treat that as "can't price this", never assume a price.
        """
        try:
            from bot.services.price_service import price_service

            return await price_service.get_price("SOL")
        except Exception as e:
            logger.warning(f"Rug detection: SOL price lookup failed: {e}")
            return None


# Global instance
rug_service = RugService()
