"""Atomiq BTC bridge orchestration (Starknet Phase 3).

Flows (docs/integrations/atomiq-api.md):
- Lightning → Starknet deposit ("ln_in"): we generate a 32-byte claim secret,
  send paymentHash=sha256(secret) with createSwap, show the user the BOLT11
  invoice (currentAction SendToAddress), and once the server requires the
  secret reveal we send it via getSwapStatus&secret= to complete the claim.
- Starknet → BTC/Lightning withdrawal ("btc_out"/"ln_out"): createSwap with
  srcAddress=the user's Starknet wallet; the server answers with
  SignSmartChainTransaction actions (escrow INVOKEs / refunds) that we sign
  and execute on-chain with the user's account.

SignSmartChainTransaction assumption (documented design decision):
The Atomiq SDK executes smart-chain (Starknet) actions DIRECTLY on-chain with
the user's wallet — the server detects the resulting on-chain state itself.
POST /submitTransaction exists for actions whose semantics require returning
signed-but-not-broadcast transactions to the server (the SignPSBT bitcoin
case, which is out of scope here). We therefore execute INVOKE actions via
the user's starknet_py account (execute_v3, auto_estimate) and do NOT call
submitTransaction for them.

Secret handling: the LN-in preimage is encrypted at rest with the SAME
utility used for wallet private keys (bot.utils.encryption Fernet +
settings.encryption_key), decrypted only at reveal time, and the plaintext
string is zeroized immediately afterwards.

starknet_py is imported lazily (execution only) so this module imports
cleanly on interpreters without it.
"""

import hashlib
import json
import logging
import secrets as _secrets
from datetime import datetime, timezone
from typing import Optional

from bot.config.settings import settings
from bot.models.btc_swap import BtcSwap
from bot.services.atomiq_api import AtomiqAPI, AtomiqClientError, AtomiqError, atomiq_api
from bot.utils.encryption import decrypt_private_key, encrypt_private_key
from database.db import get_session

logger = logging.getLogger(__name__)

# Atomiq token id for Lightning-network BTC
LIGHTNING_BTC = "LIGHTNING-BTC"
BITCOIN_BTC = "BITCOIN-BTC"

# Default seconds between polls when the server gives no pollTimeSeconds hint
DEFAULT_POLL_SECONDS = 20.0
# Live-verified minimum WBTC→on-chain-BTC output (sats); pre-checked locally
# so users get a clear error instead of an opaque createSwap rejection.
MIN_BTC_OUT_SATS = 11_548


class BtcBridgeError(Exception):
    """Raised for BTC bridge orchestration failures (user-presentable)."""


class AtomiqValidationError(BtcBridgeError):
    """Raised when a SignSmartChainTransaction call fails safety validation.

    Nothing is executed or marked; the poller treats it as a failure that
    counts toward the per-swap give-up threshold.
    """


# Non-approve entrypoints an Atomiq escrow contract may legitimately ask for
ALLOWED_ESCROW_ENTRYPOINTS = frozenset(
    {"commit", "lock", "claim", "refund", "execute", "initialize", "deposit", "withdraw"}
)
# Tolerance on approve amounts vs the swap's amount_raw (2% headroom for fees)
APPROVE_AMOUNT_TOLERANCE_NUM = 102
APPROVE_AMOUNT_TOLERANCE_DEN = 100


def _zeroize_str(value: Optional[str]) -> None:
    """Best-effort scrub of a secret string (delegates to the wallet helper)."""
    if not value:
        return
    try:
        from bot.services.wallet import _zeroize_str as _wallet_zeroize

        _wallet_zeroize(value)
    except Exception:  # pragma: no cover - zeroize is best-effort
        pass


def _to_int(value) -> int:
    """Normalize int / decimal-str / hex-str to an int felt."""
    if isinstance(value, int):
        return value
    s = str(value).strip()
    return int(s, 16) if s.lower().startswith("0x") else int(s)


def _utcnow():
    return datetime.now(timezone.utc)


class BtcBridge:
    """Orchestrates Atomiq swaps end-to-end and persists BtcSwap state."""

    def __init__(self, api: Optional[AtomiqAPI] = None, wallet_service=None):
        self.api = api or atomiq_api
        self._wallet_service = wallet_service
        # token id (e.g. "STARKNET-WBTC") -> contract address int, learned
        # from getSupportedTokens and cached for the process lifetime.
        self._token_addr_cache: dict = {}

    @property
    def wallet_service(self):
        if self._wallet_service is None:
            from bot.services.wallet import WalletService

            self._wallet_service = WalletService()
        return self._wallet_service

    # ------------------------------------------------------------------
    # Deposits (Lightning → Starknet)
    # ------------------------------------------------------------------

    async def start_lightning_deposit(
        self,
        user_id: int,
        wallet,
        sats: int,
        dst_token: Optional[str] = None,
    ) -> dict:
        """Create a Lightning → Starknet deposit and return the invoice to pay.

        Generates the 32-byte claim secret, passes paymentHash=sha256(secret)
        to createSwap (dstAddress = the user's Starknet wallet), persists the
        encrypted secret, and extracts the BOLT11 invoice from the
        SendToAddress action (polling status once if the create response does
        not carry currentAction).
        """
        dst_token = dst_token or settings.btc_deposit_default_token
        if sats <= 0:
            raise BtcBridgeError("Deposit amount must be positive")

        limits = await self.api.get_swap_limits(LIGHTNING_BTC, dst_token)
        self._validate_deposit_limits(sats, limits)

        secret = _secrets.token_bytes(32)
        secret_hex = secret.hex()
        payment_hash = hashlib.sha256(secret).hexdigest()

        swap = await self.api.create_swap(
            src_token=LIGHTNING_BTC,
            dst_token=dst_token,
            dst_address=wallet.address,
            amount=str(sats),
            amount_type="EXACT_IN",
            payment_hash=payment_hash,
        )
        swap_id = swap.get("swapId")
        if not swap_id:
            raise BtcBridgeError("Atomiq createSwap returned no swapId")

        invoice = self._extract_invoice(swap)
        if not invoice:
            # The create response may omit currentAction — poll status once.
            status = await self.api.get_swap_status(swap_id)
            invoice = self._extract_invoice(status)
        if not invoice:
            raise BtcBridgeError("Atomiq did not return a Lightning invoice for the deposit")

        secret_encrypted = encrypt_private_key(secret_hex, settings.encryption_key)
        _zeroize_str(secret_hex)

        quote = swap.get("quote") or {}
        state = swap.get("state") or {}
        record_id = self._persist_swap(
            user_id=user_id,
            wallet_id=getattr(wallet, "id", None),
            swap_id=swap_id,
            direction="ln_in",
            src_token=LIGHTNING_BTC,
            dst_token=dst_token,
            amount_raw=str(sats),
            quote_output_raw=self._raw_amount(quote.get("outputAmount")),
            dst_address=wallet.address,
            secret_encrypted=secret_encrypted,
            state=state.get("name"),
            atomiq_state_num=state.get("number"),
            invoice=invoice,
        )

        return {
            "btc_swap_id": record_id,
            "swap_id": swap_id,
            "invoice": invoice,
            "quote": quote,
            "limits": limits,
            "fees": (quote or {}).get("fees"),
        }

    # ------------------------------------------------------------------
    # Withdrawals (Starknet → BTC / Lightning)
    # ------------------------------------------------------------------

    async def start_withdrawal(
        self,
        user_id: int,
        wallet,
        destination: str,
        sats: Optional[int] = None,
        src_token: Optional[str] = None,
    ) -> dict:
        """Create a Starknet → BTC/Lightning withdrawal.

        Routes by parseAddress: BITCOIN → "btc_out" (EXACT_OUT, amount
        required, min ~11,548 sats); LIGHTNING (BOLT11) → "ln_out" (EXACT_OUT,
        no amount param — the invoice encodes it).
        """
        src_token = src_token or settings.btc_deposit_default_token
        parsed = await self.api.parse_address(destination)
        addr_type = (parsed.get("type") or "").upper()

        if addr_type == "BITCOIN":
            direction = "btc_out"
            dst_token = BITCOIN_BTC
            if sats is None:
                raise BtcBridgeError("On-chain BTC withdrawals require an amount in sats")
            if sats < MIN_BTC_OUT_SATS:
                raise BtcBridgeError(
                    f"On-chain BTC withdrawals must be at least {MIN_BTC_OUT_SATS} sats"
                )
            amount: Optional[str] = str(sats)
        elif addr_type == "LIGHTNING":
            direction = "ln_out"
            dst_token = LIGHTNING_BTC
            # BOLT11 invoices encode the amount; EXACT_OUT with no amount param.
            amount = None
        else:
            raise BtcBridgeError(
                f"Unsupported withdrawal destination type: {addr_type or 'unknown'}"
            )

        swap = await self.api.create_swap(
            src_token=src_token,
            dst_token=dst_token,
            dst_address=destination,
            amount=amount,
            amount_type="EXACT_OUT",
            src_address=wallet.address,
        )
        swap_id = swap.get("swapId")
        if not swap_id:
            raise BtcBridgeError("Atomiq createSwap returned no swapId")

        quote = swap.get("quote") or {}
        state = swap.get("state") or {}
        record_id = self._persist_swap(
            user_id=user_id,
            wallet_id=getattr(wallet, "id", None),
            swap_id=swap_id,
            direction=direction,
            src_token=src_token,
            dst_token=dst_token,
            amount_raw=amount or self._raw_amount(quote.get("outputAmount")),
            quote_output_raw=self._raw_amount(quote.get("outputAmount")),
            dst_address=destination,
            state=state.get("name"),
            atomiq_state_num=state.get("number"),
        )

        return {
            "btc_swap_id": record_id,
            "swap_id": swap_id,
            "direction": direction,
            "quote": quote,
            "fees": (quote or {}).get("fees"),
        }

    # ------------------------------------------------------------------
    # Progression
    # ------------------------------------------------------------------

    async def advance_swap(self, btc_swap_id: int) -> Optional[float]:
        """Poll one swap and act on its currentAction.

        Returns the suggested seconds until the next poll, or None when the
        swap reached a terminal state (finished).
        """
        row = self._load_swap(btc_swap_id)
        if row is None or row["finished"]:
            return None

        try:
            status = await self.api.get_swap_status(row["swap_id"])

            # Secret reveal (LN-in claim): decrypt, send, zeroize.
            if status.get("requiresSecretReveal") and row["secret_encrypted"]:
                secret_hex = None
                try:
                    secret_hex = decrypt_private_key(
                        row["secret_encrypted"], settings.encryption_key
                    )
                    status = await self.api.get_swap_status(row["swap_id"], secret=secret_hex)
                finally:
                    _zeroize_str(secret_hex)
        except AtomiqClientError as e:
            # 4xx: the request itself is rejected — retrying cannot help.
            self._mark_failed(btc_swap_id, str(e))
            logger.error("Atomiq swap %s failed with 4xx: %s", row["swap_id"], str(e)[:300])
            return None

        updates: dict = {}
        state = status.get("state") or {}
        if state.get("name"):
            updates["state"] = state.get("name")
        if state.get("number") is not None:
            updates["atomiq_state_num"] = state.get("number")
        quote = status.get("quote") or {}
        out_raw = self._raw_amount(quote.get("outputAmount"))
        if out_raw:
            updates["quote_output_raw"] = out_raw
            # ln_out swaps are created without an amount (BOLT11 encodes it);
            # backfill amount_raw from the first non-null outputAmount we see.
            if row["amount_raw"] is None:
                updates["amount_raw"] = out_raw
                row["amount_raw"] = out_raw

        # Terminal?
        if status.get("isFinished"):
            updates["finished"] = True
            updates["success"] = bool(status.get("isSuccess"))
            self._update_swap(btc_swap_id, updates)
            logger.info(
                "Atomiq swap %s finished (success=%s, state=%s)",
                row["swap_id"],
                updates["success"],
                updates.get("state"),
            )
            return None

        next_poll = DEFAULT_POLL_SECONDS
        action = status.get("currentAction") or {}
        action_type = action.get("type")

        if action_type == "SendToAddress":
            # Waiting on the user's Lightning payment; capture the invoice if
            # we somehow missed it at create time.
            if not row["invoice"]:
                invoice = self._extract_invoice(status)
                if invoice:
                    updates["invoice"] = invoice
        elif action_type == "SignSmartChainTransaction":
            # Persist state/quote updates BEFORE executing so the idempotency
            # record inside _handle_smart_chain_action is not overwritten.
            self._update_swap(btc_swap_id, updates)
            updates = {}
            state_num = state.get("number")
            await self._handle_smart_chain_action(
                row,
                action,
                state_num if state_num is not None else row["atomiq_state_num"],
            )
            # Re-poll quickly so the server sees our on-chain execution.
            next_poll = 5.0
        elif action_type == "Wait":
            try:
                next_poll = float(action.get("pollTimeSeconds") or DEFAULT_POLL_SECONDS)
            except (TypeError, ValueError):
                next_poll = DEFAULT_POLL_SECONDS

        self._update_swap(btc_swap_id, updates)
        return next_poll

    async def _handle_smart_chain_action(self, row: dict, action: dict, state_num) -> list:
        """Execute SignSmartChainTransaction txs with the user's account.

        Per the design assumption in the module docstring, INVOKE actions are
        executed DIRECTLY on-chain (execute_v3, auto_estimate) — we do not
        round-trip them through submitTransaction. DEPLOY_ACCOUNT actions are
        satisfied by our own counterfactual deploy path.

        Safety:
        - Every call is validated against the escrow allowlist / approve
          rules BEFORE anything is signed (AtomiqValidationError on failure).
        - Idempotent per Atomiq state: if we already recorded a tx hash for
          this atomiq_state_num, we skip execution and reuse it.
        - The {tx_hash, atomiq_state_num} record is persisted IMMEDIATELY
          after on-chain execution, before any further API calls.
        """
        # Idempotency: already executed for this server state? Reuse.
        existing_hash = self._recorded_hash_for_state(row, state_num)
        if existing_hash is not None:
            logger.info(
                "Atomiq swap %s: reusing tx %s for state %s (idempotent skip)",
                row["swap_id"],
                existing_hash,
                state_num,
            )
            return [existing_hash]

        wallet = (
            self.wallet_service.get_wallet_by_id(row["wallet_id"]) if row["wallet_id"] else None
        )
        if wallet is None:
            raise BtcBridgeError(f"Wallet {row['wallet_id']} not found for swap {row['swap_id']}")

        tx_hashes: list = []
        invoke_calls: list = []
        for tx_entry in action.get("txs") or []:
            tx_type = (tx_entry.get("type") or "INVOKE").upper()
            if tx_type == "DEPLOY_ACCOUNT":
                await self.wallet_service.ensure_starknet_deployed(wallet)
            elif tx_type == "INVOKE":
                invoke_calls.extend(self.parse_invoke_calls(tx_entry.get("tx") or {}))
            else:
                logger.warning(
                    "Atomiq swap %s: unsupported smart-chain tx type %s — skipping",
                    row["swap_id"],
                    tx_type,
                )

        if invoke_calls:
            # Validate BEFORE signing/executing anything.
            await self._validate_calls(row, invoke_calls)

            private_key = self.wallet_service.get_private_key(wallet)
            try:
                from bot.services.starknet.client import get_starknet_account

                account = await get_starknet_account(private_key, wallet.address)
                tx_hash = await self._execute_invoke(account, invoke_calls)
            finally:
                _zeroize_str(private_key)
            # Persist immediately (own session/commit) before any further
            # API calls, so a crash cannot lead to double execution.
            self._record_tx_hash(row, tx_hash, state_num)
            tx_hashes.append(tx_hash)
            logger.info("Atomiq swap %s: executed escrow invoke %s", row["swap_id"], tx_hash)
        return tx_hashes

    # ------------------------------------------------------------------
    # Call validation (escrow allowlist, approve amounts, pinned escrow)
    # ------------------------------------------------------------------

    @staticmethod
    def _configured_escrow_allowlist() -> set:
        """Parse settings.atomiq_escrow_contracts (list or comma string) to ints."""
        raw = getattr(settings, "atomiq_escrow_contracts", "") or ""
        if isinstance(raw, str):
            items = [x.strip() for x in raw.split(",")]
        else:
            items = [str(x).strip() for x in raw]
        out = set()
        for item in items:
            if not item:
                continue
            try:
                out.add(_to_int(item))
            except ValueError:
                logger.warning("Invalid atomiq_escrow_contracts entry ignored: %s", item[:80])
        return out

    async def _known_token_addresses(self, row: dict) -> set:
        """Token contract addresses an `approve` may target.

        Union of the static bot.config.starknet_addresses token constants and
        the addresses Atomiq's getSupportedTokens maps to the swap's own
        src/dst token ids (cached per process).
        """
        addresses: set = set()
        try:
            from bot.config import starknet_addresses as _sa

            for name in dir(_sa):
                val = getattr(_sa, name)
                if (
                    not name.startswith("_")
                    and isinstance(val, str)
                    and val.lower().startswith("0x")
                ):
                    try:
                        addresses.add(_to_int(val))
                    except ValueError:
                        pass
        except Exception:  # pragma: no cover - static config should import
            logger.warning("Could not load starknet_addresses for approve validation")

        wanted = {t for t in (row.get("src_token"), row.get("dst_token")) if t}
        missing = wanted - set(self._token_addr_cache)
        if missing:
            for side in ("INPUT", "OUTPUT"):
                try:
                    data = await self.api.get_supported_tokens(side)
                except AtomiqError as e:
                    logger.warning("getSupportedTokens(%s) failed: %s", side, str(e)[:200])
                    continue
                for token_id, addr in self._iter_token_addresses(data):
                    if token_id in wanted and token_id not in self._token_addr_cache:
                        try:
                            self._token_addr_cache[token_id] = _to_int(addr)
                        except (TypeError, ValueError):
                            pass
        for token_id in wanted:
            addr_int = self._token_addr_cache.get(token_id)
            if addr_int is not None:
                addresses.add(addr_int)
        return addresses

    @staticmethod
    def _iter_token_addresses(data):
        """Yield (token_id, address) pairs from a getSupportedTokens payload.

        Tolerant of {"tokens": [...]}, plain lists, and id→info mappings.
        """
        if isinstance(data, dict) and "tokens" in data:
            data = data["tokens"]
        if isinstance(data, dict):
            for token_id, info in data.items():
                addr = info.get("address") if isinstance(info, dict) else info
                if addr:
                    yield str(token_id), addr
            return
        if isinstance(data, list):
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                token_id = entry.get("id") or entry.get("token") or entry.get("ticker")
                addr = entry.get("address") or entry.get("contractAddress")
                if token_id and addr:
                    yield str(token_id), addr

    async def _validate_calls(self, row: dict, calls: list) -> None:
        """Validate normalized INVOKE calls; raise AtomiqValidationError on any issue.

        Rules per call (`to` is an int):
        a) configured allowlist → allowed;
        b) entrypoint == "approve" → `to` must be a known token contract for
           this swap AND the u256 amount must be ≤ amount_raw * 1.02;
        c) otherwise → entrypoint must be in ALLOWED_ESCROW_ENTRYPOINTS and
           the contract must match the swap's pinned escrow address (first
           seen wins, persisted; any change is rejected).
        """
        allowlist = self._configured_escrow_allowlist()
        token_addresses: Optional[set] = None  # lazy — only fetched if an approve appears
        escrow_pinned = None
        if row.get("escrow_address"):
            try:
                escrow_pinned = _to_int(row["escrow_address"])
            except ValueError:
                escrow_pinned = None
        newly_pinned = None

        for call in calls:
            to = call["to"]
            entrypoint = call["entrypoint"]
            if to in allowlist:
                continue
            if entrypoint == "approve":
                if token_addresses is None:
                    token_addresses = await self._known_token_addresses(row)
                if to not in token_addresses:
                    raise AtomiqValidationError(
                        f"Atomiq swap {row['swap_id']}: approve targets unknown "
                        f"token contract {hex(to)}"
                    )
                self._validate_approve_amount(row, call)
                continue
            # Non-approve, non-allowlisted: must be the swap's escrow contract.
            if entrypoint is None or entrypoint not in ALLOWED_ESCROW_ENTRYPOINTS:
                raise AtomiqValidationError(
                    f"Atomiq swap {row['swap_id']}: entrypoint "
                    f"{entrypoint or call['selector']} not in the allowed escrow set"
                )
            effective = escrow_pinned if escrow_pinned is not None else newly_pinned
            if effective is None:
                newly_pinned = to
            elif to != effective:
                raise AtomiqValidationError(
                    f"Atomiq swap {row['swap_id']}: escrow contract changed "
                    f"mid-swap ({hex(effective)} → {hex(to)})"
                )

        if escrow_pinned is None and newly_pinned is not None:
            self._update_swap(row["id"], {"escrow_address": hex(newly_pinned)})
            row["escrow_address"] = hex(newly_pinned)

    @staticmethod
    def _validate_approve_amount(row: dict, call: dict) -> None:
        """Reject approve amounts above amount_raw * 1.02 (u256 low/high)."""
        amount_raw = row.get("amount_raw")
        if amount_raw is None:
            return  # nothing to compare against yet (pre-backfill ln_out)
        calldata = call["calldata"]
        if len(calldata) < 3:
            raise AtomiqValidationError(
                f"Atomiq swap {row['swap_id']}: malformed approve calldata"
            )
        amount = calldata[1] + (calldata[2] << 128)
        max_allowed = (
            int(amount_raw) * APPROVE_AMOUNT_TOLERANCE_NUM
        ) // APPROVE_AMOUNT_TOLERANCE_DEN
        if amount > max_allowed:
            raise AtomiqValidationError(
                f"Atomiq swap {row['swap_id']}: approve amount {amount} exceeds "
                f"swap amount {amount_raw} (+2% tolerance = {max_allowed})"
            )

    # ------------------------------------------------------------------
    # Idempotency helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _recorded_hash_for_state(row: dict, state_num) -> Optional[str]:
        """Return the tx hash already recorded for this atomiq_state_num, if any."""
        if state_num is None or not row.get("tx_hashes"):
            return None
        try:
            entries = json.loads(row["tx_hashes"])
        except (TypeError, ValueError):
            return None
        for entry in entries:
            if isinstance(entry, dict) and entry.get("atomiq_state_num") == state_num:
                return entry.get("tx_hash")
        return None

    def _record_tx_hash(self, row: dict, tx_hash: str, state_num) -> None:
        """Append {tx_hash, atomiq_state_num} to the row (own session/commit)."""
        with get_session() as session:
            db_row = session.query(BtcSwap).filter(BtcSwap.id == row["id"]).first()
            if db_row is None:  # pragma: no cover - row deleted mid-flight
                return
            try:
                entries = json.loads(db_row.tx_hashes) if db_row.tx_hashes else []
            except (TypeError, ValueError):
                entries = []
            entries.append({"tx_hash": tx_hash, "atomiq_state_num": state_num})
            db_row.tx_hashes = json.dumps(entries)
            db_row.updated_at = _utcnow()
        row["tx_hashes"] = json.dumps(entries)

    @staticmethod
    def parse_invoke_calls(tx: dict) -> list:
        """Normalize an INVOKE tx payload to plain call dicts (pure, testable).

        Accepts {"calls": [...]} or a single call dict; each call may use
        contractAddress|to, entrypoint|selector, and hex/decimal calldata.
        Returns [{"to": int, "entrypoint": str|None, "selector": int|None,
        "calldata": [int, ...]}].
        """
        raw_calls = tx.get("calls")
        if raw_calls is None:
            raw_calls = [tx] if tx else []
        calls = []
        for c in raw_calls:
            to = c.get("contractAddress", c.get("to"))
            if to is None:
                raise BtcBridgeError("Atomiq INVOKE call is missing a contract address")
            selector = c.get("selector")
            entrypoint = c.get("entrypoint")
            if selector is None and entrypoint is None:
                raise BtcBridgeError("Atomiq INVOKE call has neither selector nor entrypoint")
            calls.append(
                {
                    "to": _to_int(to),
                    "entrypoint": entrypoint,
                    "selector": _to_int(selector) if selector is not None else None,
                    "calldata": [_to_int(x) for x in (c.get("calldata") or [])],
                }
            )
        return calls

    @staticmethod
    async def _execute_invoke(account, calls_raw: list) -> str:
        """Sign+send the normalized calls as one v3 multicall (lazy starknet_py)."""
        from starknet_py.hash.selector import get_selector_from_name
        from starknet_py.net.client_models import Call

        calls = [
            Call(
                to_addr=c["to"],
                selector=(
                    c["selector"]
                    if c["selector"] is not None
                    else get_selector_from_name(c["entrypoint"])
                ),
                calldata=c["calldata"],
            )
            for c in calls_raw
        ]
        response = await account.execute_v3(calls=calls, auto_estimate=True)
        return hex(response.transaction_hash)

    # ------------------------------------------------------------------
    # Startup reconciliation
    # ------------------------------------------------------------------

    async def resume_pending(self) -> list:
        """Load unfinished swaps for the poller and reconcile with the server.

        Returns the list of unfinished BtcSwap ids. listPendingSwaps is used
        best-effort to log swaps the server tracks that we do not (e.g. rows
        lost to a partial write) — they are not auto-imported.
        """
        with get_session() as session:
            rows = (
                session.query(BtcSwap.id, BtcSwap.swap_id)
                .filter(BtcSwap.finished == False)  # noqa: E712
                .all()
            )
        ids = [r[0] for r in rows]
        known_swap_ids = {r[1] for r in rows}

        # Reconcile per distinct Starknet signer: the user's wallet address is
        # the on-chain party for both deposits (claimer) and withdrawals
        # (escrow committer).
        with get_session() as session:
            from bot.models.user import Wallet

            wallet_rows = (
                session.query(Wallet.address)
                .join(BtcSwap, BtcSwap.wallet_id == Wallet.id)
                .filter(BtcSwap.finished == False)  # noqa: E712
                .all()
            )
            signers = {w[0] for w in wallet_rows if w[0]}

        for signer in signers:
            try:
                pending = await self.api.list_pending_swaps(signer)
            except AtomiqError as e:
                logger.warning("Atomiq listPendingSwaps failed for %s: %s", signer, str(e)[:200])
                continue
            for entry in pending:
                sid = entry.get("swapId") if isinstance(entry, dict) else entry
                if sid and sid not in known_swap_ids:
                    logger.warning(
                        "Atomiq reports pending swap %s for %s that we do not track", sid, signer
                    )
        return ids

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _raw_amount(api_amount) -> Optional[str]:
        """Extract the rawAmount string from an ApiAmount dict (or pass through)."""
        if api_amount is None:
            return None
        if isinstance(api_amount, dict):
            raw = api_amount.get("rawAmount", api_amount.get("amount"))
            return str(raw) if raw is not None else None
        return str(api_amount)

    @staticmethod
    def _persist_swap(**fields) -> int:
        with get_session() as session:
            record = BtcSwap(**fields)
            session.add(record)
            session.flush()
            return record.id

    @staticmethod
    def _load_swap(btc_swap_id: int) -> Optional[dict]:
        """Phase-1 read: load to a plain dict and release the connection."""
        with get_session() as session:
            row = session.query(BtcSwap).filter(BtcSwap.id == btc_swap_id).first()
            if row is None:
                return None
            return {
                "id": row.id,
                "user_id": row.user_id,
                "wallet_id": row.wallet_id,
                "swap_id": row.swap_id,
                "direction": row.direction,
                "src_token": row.src_token,
                "dst_token": row.dst_token,
                "amount_raw": row.amount_raw,
                "secret_encrypted": row.secret_encrypted,
                "invoice": row.invoice,
                "tx_hashes": row.tx_hashes,
                "atomiq_state_num": row.atomiq_state_num,
                "escrow_address": row.escrow_address,
                "finished": row.finished,
            }

    @classmethod
    def _mark_failed(cls, btc_swap_id: int, error: str) -> None:
        cls._update_swap(
            btc_swap_id,
            {"finished": True, "success": False, "last_error": str(error)[:1000]},
        )

    @staticmethod
    def _validate_deposit_limits(sats: int, limits: dict) -> None:
        """Validate the deposit amount against the fetched LN-in input limits."""

        def _limit(key) -> Optional[int]:
            raw = BtcBridge._raw_amount((limits.get("input") or {}).get(key))
            try:
                return int(raw) if raw is not None else None
            except (TypeError, ValueError):
                return None

        min_sats, max_sats = _limit("min"), _limit("max")
        if (min_sats is not None and sats < min_sats) or (
            max_sats is not None and sats > max_sats
        ):
            raise ValueError(
                f"Deposit amount {sats} sats is outside the allowed range "
                f"({min_sats if min_sats is not None else '?'}–"
                f"{max_sats if max_sats is not None else '?'} sats)"
            )

    @staticmethod
    def _update_swap(btc_swap_id: int, updates: dict) -> None:
        if not updates:
            return
        updates["updated_at"] = _utcnow()
        with get_session() as session:
            session.query(BtcSwap).filter(BtcSwap.id == btc_swap_id).update(updates)

    @staticmethod
    def _extract_invoice(payload: dict) -> Optional[str]:
        """Pull the BOLT11 invoice from a SendToAddress currentAction."""
        action = payload.get("currentAction") or {}
        if action.get("type") != "SendToAddress":
            return None
        txs = action.get("txs") or []
        if not txs:
            return None
        return txs[0].get("address")


# Global instance
btc_bridge = BtcBridge()
