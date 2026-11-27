"""Suwappu Bank namespace: ``client.bank.*``, mapped 1:1 to ``/v1/agent/bank/*``.

Mirrors packages/sdk/src/bank.ts. Method arguments are snake_case and are sent
as the camelCase fields the API defines; nested values (``recipient``, ``mandate``,
``milestones`` ...) are passed as camelCase dicts, see ``suwappu.bank_types``.
Money is a minor-unit string, never a float.

Money-moving methods REQUIRE ``idempotency_key`` (8-128 chars of ``A-Za-z0-9_.:-``),
sent as both the body field and the ``Idempotency-Key`` header. Reads and keyed
calls are retried on 429 and 503 ``LOCK_BUSY`` with the SAME key, honouring
``Retry-After`` with bounded backoff (``client.bank.retry``). Calls without a key
(the route has none) are never retried automatically. Failures raise
``SuwappuBankError``.
"""

from __future__ import annotations

import asyncio
import json as _json
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from suwappu.bank_types import (
    BankAgentMandate,
    BankCollateral,
    BankEscrowMilestone,
    BankInvoiceLineItem,
    BankOwnerRef,
    BankPayrollRunItem,
    BankPayrollScheduleItem,
    BankRampProvider,
    BankRecord,
    BankRemitRecipient,
    BankToExternal,
)
from suwappu.client import SuwappuApiError

if TYPE_CHECKING:
    from suwappu.client import SuwappuClient

_IDEM_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,128}$")
_UNSET: Any = None


def _enc(v: Any) -> str:
    return quote(str(v), safe="")


def _camel(name: str) -> str:
    name = name.rstrip("_")  # all_ -> all, from_ -> from
    head, *rest = name.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def _body(**kw: Any) -> dict[str, Any]:
    """snake_case kwargs -> camelCase JSON body, dropping None."""
    return {_camel(k): v for k, v in kw.items() if v is not None}


def _params(**kw: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in kw.items():
        if v is None:
            continue
        out[_camel(k)] = ("true" if v else "false") if isinstance(v, bool) else str(v)
    return out


class SuwappuBankError(SuwappuApiError):
    """Typed error for ``client.bank.*`` calls.

    ``code`` is the Bank API error code (e.g. ``INSUFFICIENT_FUNDS``, ``POLICY_BLOCKED``,
    ``LOCK_BUSY``). ``missing`` names the external input when ``code == "NOT_CONFIGURED"``.
    """

    def __init__(
        self,
        status: int,
        body: str,
        *,
        code: str | None = None,
        detail: str | None = None,
        missing: str | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(status, body, code=code, message=detail)
        self.detail = detail if detail is not None else body
        self.missing = missing
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        """True when safe to retry with the SAME idempotency key (429, or 503 LOCK_BUSY)."""
        return self.status == 429 or (self.status == 503 and self.code == "LOCK_BUSY")


@dataclass
class BankRetryOptions:
    """Bounded retry policy for 429 / 503 LOCK_BUSY. Mutable: ``client.bank.retry.max_retries = 5``."""

    max_retries: int = 3
    base_delay_s: float = 0.5
    max_delay_s: float = 10.0


def _error_from_response(
    status: int, text: str, retry_after_header: str | None
) -> SuwappuBankError:
    code: str | None = None
    detail: str | None = None
    missing: str | None = None
    try:
        parsed = _json.loads(text)
        if isinstance(parsed, dict):
            if isinstance(parsed.get("error_code"), str):
                code = parsed["error_code"]
            if isinstance(parsed.get("message"), str):
                detail = parsed["message"]
            if isinstance(parsed.get("missing"), str):
                missing = parsed["missing"]
    except ValueError:
        pass
    retry_after: float | None = None
    try:
        if retry_after_header is not None:
            ra = float(retry_after_header)
            if ra >= 0:
                retry_after = ra
    except ValueError:
        pass
    return SuwappuBankError(
        status, text, code=code, detail=detail, missing=missing, retry_after=retry_after
    )


class _Sub:
    def __init__(self, bank: BankNamespace) -> None:
        self._b = bank


# ---------------------------------------------------------------- accounts
class _AccountsNamespace(_Sub):
    async def open(
        self,
        *,
        asset: str,
        chain: str,
        kind: str | None = None,
        label: str | None = None,
        segment_profile: str | None = None,
    ) -> dict[str, Any]:
        """POST /accounts. ``kind``: checking|savings|credit|treasury (default checking).
        Returns ``{"success": True, "account": BankAccount}``."""
        return await self._b._call(
            "POST",
            "/accounts",
            json=_body(
                kind=kind, asset=asset, chain=chain, label=label, segment_profile=segment_profile
            ),
        )

    async def list(self) -> dict[str, Any]:
        """GET /accounts -> ``{"accounts": list[BankAccount]}``."""
        return await self._b._call("GET", "/accounts")

    async def get(self, account_id: str) -> dict[str, Any]:
        """GET /accounts/:id -> ``{"account": BankAccount}``."""
        return await self._b._call("GET", f"/accounts/{_enc(account_id)}")

    async def statement(
        self, account_id: str, *, limit: int | None = None, cursor: str | None = None
    ) -> dict[str, Any]:
        """GET /accounts/:id/statement -> BankStatementPage (+ ``success``)."""
        return await self._b._call(
            "GET",
            f"/accounts/{_enc(account_id)}/statement",
            params=_params(limit=limit, cursor=cursor),
        )

    async def reconcile(self, account_id: str) -> dict[str, Any]:
        """GET /accounts/:id/reconcile -> BankReconcileReport (+ ``success``)."""
        return await self._b._call("GET", f"/accounts/{_enc(account_id)}/reconcile")


# --------------------------------------------------------------- transfers
class _TransfersNamespace(_Sub):
    async def create(
        self,
        *,
        idempotency_key: str,
        from_account_id: str,
        to_account_id: str | None = None,
        to_external: BankToExternal | None = None,
        amount_minor: str | None = None,
        amount: str | None = None,
        memo: str | None = None,
    ) -> dict[str, Any]:
        """POST /transfers. ``idempotency_key`` REQUIRED. Exactly one of ``amount_minor`` /
        ``amount`` and exactly one of ``to_account_id`` / ``to_external``.
        Returns ``{"transfer": BankTransfer}``; poll ``get`` until the status is terminal."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/transfers",
            json=_body(
                idempotency_key=key,
                from_account_id=from_account_id,
                to_account_id=to_account_id,
                to_external=to_external,
                amount_minor=amount_minor,
                amount=amount,
                memo=memo,
            ),
            idempotency_key=key,
        )

    async def get(self, transfer_id: str) -> dict[str, Any]:
        """GET /transfers/:id -> ``{"transfer": BankTransfer}``."""
        return await self._b._call("GET", f"/transfers/{_enc(transfer_id)}")

    async def list(
        self,
        *,
        account_id: str | None = None,
        status: str | None = None,
        limit: int | None = None,
        before: str | None = None,
    ) -> dict[str, Any]:
        """GET /transfers -> ``{"transfers": list[BankTransfer]}``."""
        return await self._b._call(
            "GET",
            "/transfers",
            params=_params(account_id=account_id, status=status, limit=limit, before=before),
        )


class _AssetsNamespace(_Sub):
    async def __call__(
        self, *, chain: str | None = None, currency: str | None = None
    ) -> dict[str, Any]:
        """``bank.assets()`` is shorthand for ``bank.assets.list()``."""
        return await self.list(chain=chain, currency=currency)

    async def list(
        self, *, chain: str | None = None, currency: str | None = None
    ) -> dict[str, Any]:
        """GET /assets -> ``{"assets": list[BankAsset]}``."""
        return await self._b._call("GET", "/assets", params=_params(chain=chain, currency=currency))


# ---------------------------------------------------------------------- fx
class _FxNamespace(_Sub):
    async def quote(
        self,
        *,
        from_account_id: str,
        to_account_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        slippage: float | None = None,
        require_direct: bool | None = None,
    ) -> BankRecord:
        """POST /fx/quote. ``slippage`` is a fraction 0.0001-0.05 (not money)."""
        return await self._b._call(
            "POST",
            "/fx/quote",
            json=_body(
                from_account_id=from_account_id,
                to_account_id=to_account_id,
                amount_minor=amount_minor,
                amount=amount,
                slippage=slippage,
                require_direct=require_direct,
            ),
        )

    async def execute(
        self,
        *,
        idempotency_key: str,
        from_account_id: str,
        to_account_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        slippage: float | None = None,
        require_direct: bool | None = None,
        min_to_minor: str | None = None,
    ) -> BankRecord:
        """POST /fx/execute. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/fx/execute",
            json=_body(
                idempotency_key=key,
                from_account_id=from_account_id,
                to_account_id=to_account_id,
                amount_minor=amount_minor,
                amount=amount,
                slippage=slippage,
                require_direct=require_direct,
                min_to_minor=min_to_minor,
            ),
            idempotency_key=key,
        )


# -------------------------------------------------------------------- earn
class _EarnNamespace(_Sub):
    async def vaults(self, *, asset: str, chain: str) -> BankRecord:
        """GET /earn/vaults"""
        return await self._b._call("GET", "/earn/vaults", params=_params(asset=asset, chain=chain))

    async def positions(self) -> BankRecord:
        """GET /earn/positions"""
        return await self._b._call("GET", "/earn/positions")

    async def history(
        self, *, account_id: str | None = None, limit: int | None = None
    ) -> BankRecord:
        """GET /earn/history"""
        return await self._b._call(
            "GET", "/earn/history", params=_params(account_id=account_id, limit=limit)
        )

    async def deposit(
        self,
        *,
        idempotency_key: str,
        account_id: str,
        vault: str,
        amount_minor: str | None = None,
        amount: str | None = None,
    ) -> BankRecord:
        """POST /earn/deposit. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/earn/deposit",
            json=_body(
                idempotency_key=key,
                account_id=account_id,
                vault=vault,
                amount_minor=amount_minor,
                amount=amount,
            ),
            idempotency_key=key,
        )

    async def withdraw(
        self,
        *,
        idempotency_key: str,
        account_id: str,
        vault: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        all_: bool | None = None,
    ) -> BankRecord:
        """POST /earn/withdraw. ``idempotency_key`` REQUIRED. One of amount_minor / amount / all_=True."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/earn/withdraw",
            json=_body(
                idempotency_key=key,
                account_id=account_id,
                vault=vault,
                amount_minor=amount_minor,
                amount=amount,
                all_=all_,
            ),
            idempotency_key=key,
        )

    async def settings(self) -> BankRecord:
        """GET /earn/settings"""
        return await self._b._call("GET", "/earn/settings")

    async def set_settings(
        self,
        *,
        account_id: str,
        vault: str,
        enabled: bool | None = None,
        floor_minor: str | None = None,
        floor: str | None = None,
        min_sweep_minor: str | None = None,
    ) -> BankRecord:
        """PUT /earn/settings (auto-sweep; no idempotency key on this route, not auto-retried)."""
        return await self._b._call(
            "PUT",
            "/earn/settings",
            json=_body(
                account_id=account_id,
                vault=vault,
                enabled=enabled,
                floor_minor=floor_minor,
                floor=floor,
                min_sweep_minor=min_sweep_minor,
            ),
        )


# ------------------------------------------------------------------ credit
class _CreditNamespace(_Sub):
    async def markets(
        self,
        *,
        chain: str | None = None,
        asset: str | None = None,
        collateral: str | None = None,
    ) -> BankRecord:
        """GET /credit/markets"""
        return await self._b._call(
            "GET",
            "/credit/markets",
            params=_params(chain=chain, asset=asset, collateral=collateral),
        )

    async def lines(self) -> BankRecord:
        """GET /credit/lines"""
        return await self._b._call("GET", "/credit/lines")

    async def line(self, line_id: str) -> BankRecord:
        """GET /credit/lines/:id"""
        return await self._b._call("GET", f"/credit/lines/{_enc(line_id)}")

    async def open_line(
        self,
        *,
        idempotency_key: str,
        account_id: str,
        market_id: str,
        collateral: BankCollateral,
    ) -> BankRecord:
        """POST /credit/lines. ``idempotency_key`` REQUIRED. ``market_id`` is a Morpho bytes32 id."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/credit/lines",
            json=_body(
                idempotency_key=key,
                account_id=account_id,
                market_id=market_id,
                collateral=collateral,
            ),
            idempotency_key=key,
        )

    async def _amount_call(
        self,
        path: str,
        idempotency_key: str,
        line_id: str,
        amount_minor: str | None,
        amount: str | None,
        all_: bool | None,
    ) -> BankRecord:
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            path,
            json=_body(
                idempotency_key=key,
                line_id=line_id,
                amount_minor=amount_minor,
                amount=amount,
                all_=all_,
            ),
            idempotency_key=key,
        )

    async def draw(
        self,
        *,
        idempotency_key: str,
        line_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        all_: bool | None = None,
    ) -> BankRecord:
        """POST /credit/draw. ``idempotency_key`` REQUIRED."""
        return await self._amount_call(
            "/credit/draw", idempotency_key, line_id, amount_minor, amount, all_
        )

    async def repay(
        self,
        *,
        idempotency_key: str,
        line_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        all_: bool | None = None,
    ) -> BankRecord:
        """POST /credit/repay. ``idempotency_key`` REQUIRED."""
        return await self._amount_call(
            "/credit/repay", idempotency_key, line_id, amount_minor, amount, all_
        )

    async def withdraw_collateral(
        self,
        *,
        idempotency_key: str,
        line_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        all_: bool | None = None,
    ) -> BankRecord:
        """POST /credit/withdraw-collateral. ``idempotency_key`` REQUIRED."""
        return await self._amount_call(
            "/credit/withdraw-collateral", idempotency_key, line_id, amount_minor, amount, all_
        )

    async def events(
        self,
        *,
        line_id: str | None = None,
        since: str | None = None,
        limit: int | None = None,
    ) -> BankRecord:
        """GET /credit/events"""
        return await self._b._call(
            "GET", "/credit/events", params=_params(line_id=line_id, since=since, limit=limit)
        )

    async def refunds_pending(self) -> BankRecord:
        """GET /credit/refunds/pending"""
        return await self._b._call("GET", "/credit/refunds/pending")

    async def score(self, *, asset: str | None = None, chain: str | None = None) -> BankRecord:
        """GET /credit/score"""
        return await self._b._call("GET", "/credit/score", params=_params(asset=asset, chain=chain))

    async def unsecured(self, *, idempotency_key: str, account_id: str) -> BankRecord:
        """POST /credit/unsecured. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/credit/unsecured",
            json=_body(idempotency_key=key, account_id=account_id),
            idempotency_key=key,
        )

    async def receivables_accept(
        self, *, idempotency_key: str, account_id: str, invoice_id: str
    ) -> BankRecord:
        """POST /credit/receivables/accept. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/credit/receivables/accept",
            json=_body(idempotency_key=key, account_id=account_id, invoice_id=invoice_id),
            idempotency_key=key,
        )

    async def receivables_finance(
        self, *, idempotency_key: str, account_id: str, invoice_id: str
    ) -> BankRecord:
        """POST /credit/receivables/finance. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/credit/receivables/finance",
            json=_body(idempotency_key=key, account_id=account_id, invoice_id=invoice_id),
            idempotency_key=key,
        )


# ------------------------------------------------------------------- ramps
class _RampsNamespace(_Sub):
    async def rails(self) -> BankRecord:
        """GET /ramps/rails"""
        return await self._b._call("GET", "/ramps/rails")

    async def providers(self) -> BankRecord:
        """GET /ramps/providers"""
        return await self._b._call("GET", "/ramps/providers")

    async def quote(
        self,
        *,
        direction: str,
        rail: str,
        asset: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        currency: str | None = None,
    ) -> BankRecord:
        """POST /ramps/quote. ``direction``: offramp|onramp."""
        return await self._b._call(
            "POST",
            "/ramps/quote",
            json=_body(
                direction=direction,
                rail=rail,
                asset=asset,
                amount_minor=amount_minor,
                amount=amount,
                currency=currency,
            ),
        )

    async def kyc(
        self,
        *,
        email: str,
        full_name: str,
        provider: BankRampProvider | None = None,
        type: str | None = None,
    ) -> BankRecord:
        """POST /ramps/kyc"""
        return await self._b._call(
            "POST",
            "/ramps/kyc",
            json=_body(provider=provider, email=email, full_name=full_name, type=type),
        )

    async def kyc_status(self, provider: BankRampProvider) -> BankRecord:
        """GET /ramps/kyc/:provider"""
        return await self._b._call("GET", f"/ramps/kyc/{_enc(provider)}")

    async def create_external_account(
        self,
        *,
        account_type: str,
        owner_name: str,
        account: dict[str, str],
        provider: BankRampProvider | None = None,
        bank_name: str | None = None,
        label: str | None = None,
        address: dict[str, str] | None = None,
    ) -> BankRecord:
        """POST /ramps/external-accounts. ``account_type``: us|iban|clabe."""
        return await self._b._call(
            "POST",
            "/ramps/external-accounts",
            json=_body(
                provider=provider,
                account_type=account_type,
                owner_name=owner_name,
                bank_name=bank_name,
                label=label,
                account=account,
                address=address,
            ),
        )

    async def list_external_accounts(self) -> BankRecord:
        """GET /ramps/external-accounts"""
        return await self._b._call("GET", "/ramps/external-accounts")

    async def create_virtual_account(
        self,
        *,
        account_id: str,
        source_currency: str,
        provider: BankRampProvider | None = None,
    ) -> BankRecord:
        """POST /ramps/virtual-accounts. ``source_currency``: usd|eur|mxn|brl|cop|gbp."""
        return await self._b._call(
            "POST",
            "/ramps/virtual-accounts",
            json=_body(provider=provider, account_id=account_id, source_currency=source_currency),
        )

    async def list_virtual_accounts(self) -> BankRecord:
        """GET /ramps/virtual-accounts"""
        return await self._b._call("GET", "/ramps/virtual-accounts")

    async def offramp(
        self,
        *,
        idempotency_key: str,
        from_account_id: str,
        external_account_id: str,
        amount_minor: str,
        provider: BankRampProvider | None = None,
    ) -> BankRecord:
        """POST /ramps/offramp. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/ramps/offramp",
            json=_body(
                idempotency_key=key,
                provider=provider,
                from_account_id=from_account_id,
                external_account_id=external_account_id,
                amount_minor=amount_minor,
            ),
            idempotency_key=key,
        )

    async def list_transfers(self, *, limit: int | None = None) -> BankRecord:
        """GET /ramps/transfers"""
        return await self._b._call("GET", "/ramps/transfers", params=_params(limit=limit))

    async def get_transfer(self, transfer_id: str) -> BankRecord:
        """GET /ramps/transfers/:id"""
        return await self._b._call("GET", f"/ramps/transfers/{_enc(transfer_id)}")


# -------------------------------------------------------------- remittance
class _RemittanceNamespace(_Sub):
    async def quote(
        self,
        *,
        from_account_id: str,
        amount_minor: str | None = None,
        amount: str | None = None,
        rail: str | None = None,
        currency: str | None = None,
    ) -> BankRecord:
        """POST /remittance/quote"""
        return await self._b._call(
            "POST",
            "/remittance/quote",
            json=_body(
                from_account_id=from_account_id,
                amount_minor=amount_minor,
                amount=amount,
                rail=rail,
                currency=currency,
            ),
        )

    async def send(
        self,
        *,
        idempotency_key: str,
        from_account_id: str,
        recipient: BankRemitRecipient,
        amount_minor: str | None = None,
        amount: str | None = None,
        memo: str | None = None,
        auto_earn: bool | None = None,
    ) -> BankRecord:
        """POST /remittance/send. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/remittance/send",
            json=_body(
                idempotency_key=key,
                from_account_id=from_account_id,
                recipient=recipient,
                amount_minor=amount_minor,
                amount=amount,
                memo=memo,
                auto_earn=auto_earn,
            ),
            idempotency_key=key,
        )

    async def claim_preview(self, token: str) -> BankRecord:
        """GET /remittance/claim/:token"""
        return await self._b._call("GET", f"/remittance/claim/{_enc(token)}")

    async def claim(
        self,
        token: str,
        *,
        account_id: str | None = None,
        choice: str | None = None,
        external_account_id: str | None = None,
    ) -> BankRecord:
        """POST /remittance/claim/:token (no idempotency key on the route; not auto-retried).
        ``choice``: keep|cashout."""
        return await self._b._call(
            "POST",
            f"/remittance/claim/{_enc(token)}",
            json=_body(
                account_id=account_id, choice=choice, external_account_id=external_account_id
            ),
        )

    async def cancel(self, remittance_id: str) -> BankRecord:
        """POST /remittance/:id/cancel"""
        return await self._b._call("POST", f"/remittance/{_enc(remittance_id)}/cancel")

    async def list(self, *, limit: int | None = None) -> BankRecord:
        """GET /remittance"""
        return await self._b._call("GET", "/remittance", params=_params(limit=limit))

    async def get(self, remittance_id: str) -> BankRecord:
        """GET /remittance/:id"""
        return await self._b._call("GET", f"/remittance/{_enc(remittance_id)}")

    async def identity(self) -> BankRecord:
        """GET /remittance/identity"""
        return await self._b._call("GET", "/remittance/identity")

    async def corridors(self) -> BankRecord:
        """GET /remittance/corridors"""
        return await self._b._call("GET", "/remittance/corridors")


# ------------------------------------------------------------------- cards
class _CardsNamespace(_Sub):
    async def issue(
        self,
        *,
        idempotency_key: str,
        account_id: str,
        type: str | None = None,
        provider: str | None = None,
        label: str | None = None,
        rules: dict[str, Any] | None = None,
        org_id: str | None = None,
        member_id: str | None = None,
        team_id: str | None = None,
        expense_category: str | None = None,
        memo: str | None = None,
        terms_accepted: bool | None = None,
        cardholder: dict[str, Any] | None = None,
        shipping: dict[str, Any] | None = None,
    ) -> BankRecord:
        """POST /cards. ``idempotency_key`` REQUIRED. ``type``: virtual|physical;
        ``provider``: stripe|rain. ``cardholder`` / ``shipping`` are camelCase dicts."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/cards",
            json=_body(
                idempotency_key=key,
                account_id=account_id,
                type=type,
                provider=provider,
                label=label,
                rules=rules,
                org_id=org_id,
                member_id=member_id,
                team_id=team_id,
                expense_category=expense_category,
                memo=memo,
                terms_accepted=terms_accepted,
                cardholder=cardholder,
                shipping=shipping,
            ),
            idempotency_key=key,
        )

    async def list(
        self,
        *,
        account_id: str | None = None,
        member_id: str | None = None,
        org_id: str | None = None,
    ) -> BankRecord:
        """GET /cards"""
        return await self._b._call(
            "GET",
            "/cards",
            params=_params(account_id=account_id, member_id=member_id, org_id=org_id),
        )

    async def get(self, card_id: str) -> BankRecord:
        """GET /cards/:id"""
        return await self._b._call("GET", f"/cards/{_enc(card_id)}")

    async def reveal_config(self, *, provider: str | None = None) -> BankRecord:
        """GET /cards/reveal-config. ``provider``: stripe|rain."""
        return await self._b._call("GET", "/cards/reveal-config", params=_params(provider=provider))

    async def freeze(self, card_id: str) -> BankRecord:
        """POST /cards/:id/freeze"""
        return await self._b._call("POST", f"/cards/{_enc(card_id)}/freeze")

    async def unfreeze(self, card_id: str) -> BankRecord:
        """POST /cards/:id/unfreeze"""
        return await self._b._call("POST", f"/cards/{_enc(card_id)}/unfreeze")

    async def cancel(self, card_id: str) -> BankRecord:
        """POST /cards/:id/cancel"""
        return await self._b._call("POST", f"/cards/{_enc(card_id)}/cancel")

    async def set_rules(self, card_id: str, rules: dict[str, Any]) -> BankRecord:
        """PUT /cards/:id/rules"""
        return await self._b._call("PUT", f"/cards/{_enc(card_id)}/rules", json={"rules": rules})

    async def simulate(
        self,
        card_id: str,
        *,
        amount_minor: str,
        merchant_name: str | None = None,
        merchant_id: str | None = None,
        mcc: str | None = None,
        country: str | None = None,
        at: str | None = None,
        rules: dict[str, Any] | None = None,
    ) -> BankRecord:
        """POST /cards/:id/simulate: dry-run an authorization against the card's rules."""
        return await self._b._call(
            "POST",
            f"/cards/{_enc(card_id)}/simulate",
            json=_body(
                amount_minor=amount_minor,
                merchant_name=merchant_name,
                merchant_id=merchant_id,
                mcc=mcc,
                country=country,
                at=at,
                rules=rules,
            ),
        )

    async def transactions(self, card_id: str, *, limit: int | None = None) -> BankRecord:
        """GET /cards/:id/transactions"""
        return await self._b._call(
            "GET", f"/cards/{_enc(card_id)}/transactions", params=_params(limit=limit)
        )

    async def authorizations(self, card_id: str, *, limit: int | None = None) -> BankRecord:
        """GET /cards/:id/authorizations"""
        return await self._b._call(
            "GET", f"/cards/{_enc(card_id)}/authorizations", params=_params(limit=limit)
        )


# ---------------------------------------------------------------- payments
class _InvoicesNamespace(_Sub):
    async def create(
        self,
        *,
        payee_account_id: str,
        payer: BankOwnerRef | None = None,
        amount_minor: str | None = None,
        line_items: list[BankInvoiceLineItem] | None = None,
        due_at: str | None = None,
        memo: str | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        publish: bool | None = None,
    ) -> BankRecord:
        """POST /payments/invoices. ``idempotency_key`` is optional here (as in the TypeScript
        SDK); the call is retried automatically only when a key is given."""
        key = None if idempotency_key is None else self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/payments/invoices",
            json=_body(
                payee_account_id=payee_account_id,
                payer=payer,
                amount_minor=amount_minor,
                line_items=line_items,
                due_at=due_at,
                memo=memo,
                metadata=metadata,
                idempotency_key=key,
                publish=publish,
            ),
            idempotency_key=key,
        )

    async def list(self, *, role: str | None = None, status: str | None = None) -> BankRecord:
        """GET /payments/invoices. ``role``: payer|payee."""
        return await self._b._call(
            "GET", "/payments/invoices", params=_params(role=role, status=status)
        )

    async def get(self, invoice_id: str) -> BankRecord:
        """GET /payments/invoices/:id"""
        return await self._b._call("GET", f"/payments/invoices/{_enc(invoice_id)}")

    async def pay(
        self,
        *,
        idempotency_key: str,
        from_account_id: str,
        invoice_id: str | None = None,
        slug: str | None = None,
        amount_minor: str | None = None,
    ) -> BankRecord:
        """POST /payments/invoices/pay. ``idempotency_key`` REQUIRED; ``invoice_id`` or ``slug``."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/payments/invoices/pay",
            json=_body(
                idempotency_key=key,
                from_account_id=from_account_id,
                invoice_id=invoice_id,
                slug=slug,
                amount_minor=amount_minor,
            ),
            idempotency_key=key,
        )

    async def publish(self, invoice_id: str) -> BankRecord:
        """POST /payments/invoices/:id/publish"""
        return await self._b._call("POST", f"/payments/invoices/{_enc(invoice_id)}/publish")

    async def accept(self, invoice_id: str) -> BankRecord:
        """POST /payments/invoices/:id/accept"""
        return await self._b._call("POST", f"/payments/invoices/{_enc(invoice_id)}/accept")

    async def void(self, invoice_id: str) -> BankRecord:
        """POST /payments/invoices/:id/void"""
        return await self._b._call("POST", f"/payments/invoices/{_enc(invoice_id)}/void")

    async def parse_request(self, uri: str) -> BankRecord:
        """GET /payments/request/parse (EIP-681 payment request URI)"""
        return await self._b._call("GET", "/payments/request/parse", params=_params(uri=uri))


class _EscrowsNamespace(_Sub):
    async def create(
        self,
        *,
        idempotency_key: str,
        payee: BankOwnerRef,
        payer_account_id: str,
        payee_account_id: str,
        amount_minor: str | None = None,
        milestones: list[BankEscrowMilestone] | None = None,
        arbiter: BankOwnerRef | None = None,
        description: str | None = None,
        deliver_by: str | None = None,
        auto_release_seconds: int | None = None,
    ) -> BankRecord:
        """POST /escrows. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/escrows",
            json=_body(
                idempotency_key=key,
                payee=payee,
                payer_account_id=payer_account_id,
                payee_account_id=payee_account_id,
                amount_minor=amount_minor,
                milestones=milestones,
                arbiter=arbiter,
                description=description,
                deliver_by=deliver_by,
                auto_release_seconds=auto_release_seconds,
            ),
            idempotency_key=key,
        )

    async def list(self, *, role: str | None = None) -> BankRecord:
        """GET /escrows. ``role``: payer|payee|arbiter."""
        return await self._b._call("GET", "/escrows", params=_params(role=role))

    async def get(self, escrow_id: str) -> BankRecord:
        """GET /escrows/:id"""
        return await self._b._call("GET", f"/escrows/{_enc(escrow_id)}")

    async def deliver(self, escrow_id: str, seq: int, proof: str) -> BankRecord:
        """POST /escrows/:id/milestones/:seq/deliver"""
        return await self._b._call(
            "POST",
            f"/escrows/{_enc(escrow_id)}/milestones/{int(seq)}/deliver",
            json={"proof": proof},
        )

    async def confirm(self, escrow_id: str, seq: int) -> BankRecord:
        """POST /escrows/:id/milestones/:seq/confirm"""
        return await self._b._call(
            "POST", f"/escrows/{_enc(escrow_id)}/milestones/{int(seq)}/confirm"
        )

    async def dispute(self, escrow_id: str, seq: int, reason: str) -> BankRecord:
        """POST /escrows/:id/milestones/:seq/dispute"""
        return await self._b._call(
            "POST",
            f"/escrows/{_enc(escrow_id)}/milestones/{int(seq)}/dispute",
            json={"reason": reason},
        )

    async def resolve(
        self, escrow_id: str, seq: int, *, release_minor: str, note: str | None = None
    ) -> BankRecord:
        """POST /escrows/:id/milestones/:seq/resolve (arbiter)"""
        return await self._b._call(
            "POST",
            f"/escrows/{_enc(escrow_id)}/milestones/{int(seq)}/resolve",
            json=_body(release_minor=release_minor, note=note),
        )

    async def refund(self, escrow_id: str, seq: int) -> BankRecord:
        """POST /escrows/:id/milestones/:seq/refund"""
        return await self._b._call(
            "POST", f"/escrows/{_enc(escrow_id)}/milestones/{int(seq)}/refund"
        )


class _StreamsNamespace(_Sub):
    async def create(
        self,
        *,
        idempotency_key: str,
        payer_account_id: str,
        payee_account_id: str,
        kind: str,
        cap_minor: str,
        rate_minor: str | None = None,
        period_seconds: int | None = None,
        unit_price_minor: str | None = None,
        dust_minor: str | None = None,
        ewa_bps: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> BankRecord:
        """POST /streams. ``idempotency_key`` REQUIRED. ``kind``: rate|metered."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/streams",
            json=_body(
                idempotency_key=key,
                payer_account_id=payer_account_id,
                payee_account_id=payee_account_id,
                kind=kind,
                rate_minor=rate_minor,
                period_seconds=period_seconds,
                unit_price_minor=unit_price_minor,
                cap_minor=cap_minor,
                dust_minor=dust_minor,
                ewa_bps=ewa_bps,
                metadata=metadata,
            ),
            idempotency_key=key,
        )

    async def list(self, *, role: str | None = None) -> BankRecord:
        """GET /streams. ``role``: payer|payee."""
        return await self._b._call("GET", "/streams", params=_params(role=role))

    async def get(self, stream_id: str) -> BankRecord:
        """GET /streams/:id"""
        return await self._b._call("GET", f"/streams/{_enc(stream_id)}")

    async def pause(self, stream_id: str) -> BankRecord:
        """POST /streams/:id/pause"""
        return await self._b._call("POST", f"/streams/{_enc(stream_id)}/pause")

    async def resume(self, stream_id: str) -> BankRecord:
        """POST /streams/:id/resume"""
        return await self._b._call("POST", f"/streams/{_enc(stream_id)}/resume")

    async def cancel(self, stream_id: str) -> BankRecord:
        """POST /streams/:id/cancel"""
        return await self._b._call("POST", f"/streams/{_enc(stream_id)}/cancel")

    async def settle(self, stream_id: str) -> BankRecord:
        """POST /streams/:id/settle"""
        return await self._b._call("POST", f"/streams/{_enc(stream_id)}/settle")

    async def report_usage(self, stream_id: str, *, units: str, idempotency_key: str) -> BankRecord:
        """POST /streams/:id/usage. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            f"/streams/{_enc(stream_id)}/usage",
            json=_body(units=units, idempotency_key=key),
            idempotency_key=key,
        )


class _PaymentsNamespace:
    def __init__(self, bank: BankNamespace) -> None:
        self.invoices = _InvoicesNamespace(bank)
        self.escrows = _EscrowsNamespace(bank)
        self.streams = _StreamsNamespace(bank)


# ----------------------------------------------------------------- payroll
class _PayrollNamespace(_Sub):
    async def create_payee(
        self,
        *,
        kind: str,
        name: str,
        method: str,
        currency: str,
        account_id: str | None = None,
        address: str | None = None,
        chain: str | None = None,
        rail_account_id: str | None = None,
        rail: str | None = None,
        linked_owner: BankOwnerRef | None = None,
        tax: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> BankRecord:
        """POST /payroll/payees. ``kind``: worker|contractor; ``method``: bank_account|wallet|local_rail."""
        return await self._b._call(
            "POST",
            "/payroll/payees",
            json=_body(
                kind=kind,
                name=name,
                method=method,
                account_id=account_id,
                address=address,
                chain=chain,
                rail_account_id=rail_account_id,
                rail=rail,
                currency=currency,
                linked_owner=linked_owner,
                tax=tax,
                metadata=metadata,
            ),
        )

    async def list_payees(self) -> BankRecord:
        """GET /payroll/payees"""
        return await self._b._call("GET", "/payroll/payees")

    async def archive_payee(self, payee_id: str) -> BankRecord:
        """POST /payroll/payees/:id/archive"""
        return await self._b._call("POST", f"/payroll/payees/{_enc(payee_id)}/archive")

    async def create_run(
        self,
        *,
        funding_account_id: str,
        items: list[BankPayrollRunItem],
        label: str | None = None,
        pool_id: str | None = None,
    ) -> BankRecord:
        """POST /payroll/runs (no idempotency key on the route; not auto-retried)."""
        return await self._b._call(
            "POST",
            "/payroll/runs",
            json=_body(
                funding_account_id=funding_account_id, label=label, pool_id=pool_id, items=items
            ),
        )

    async def list_runs(self) -> BankRecord:
        """GET /payroll/runs"""
        return await self._b._call("GET", "/payroll/runs")

    async def get_run(self, run_id: str) -> BankRecord:
        """GET /payroll/runs/:id"""
        return await self._b._call("GET", f"/payroll/runs/{_enc(run_id)}")

    async def approve_run(self, run_id: str) -> BankRecord:
        """POST /payroll/runs/:id/approve"""
        return await self._b._call("POST", f"/payroll/runs/{_enc(run_id)}/approve")

    async def execute_run(self, run_id: str) -> BankRecord:
        """POST /payroll/runs/:id/execute (no idempotency key on the route; not auto-retried)."""
        return await self._b._call("POST", f"/payroll/runs/{_enc(run_id)}/execute")

    async def retry_run(self, run_id: str) -> BankRecord:
        """POST /payroll/runs/:id/retry"""
        return await self._b._call("POST", f"/payroll/runs/{_enc(run_id)}/retry")

    async def run_receipts(self, run_id: str) -> BankRecord:
        """GET /payroll/runs/:id/receipts"""
        return await self._b._call("GET", f"/payroll/runs/{_enc(run_id)}/receipts")

    async def my_payouts(self) -> BankRecord:
        """GET /payroll/my-payouts"""
        return await self._b._call("GET", "/payroll/my-payouts")

    async def create_schedule(
        self,
        *,
        funding_account_id: str,
        name: str,
        frequency: str,
        timezone: str,
        items: list[BankPayrollScheduleItem],
        day_of_week: int | None = None,
        day_of_month: int | None = None,
        local_time: str | None = None,
        pool_id: str | None = None,
        auto_approve: bool | None = None,
    ) -> BankRecord:
        """POST /payroll/schedules. ``frequency``: weekly|biweekly|monthly; ``local_time`` HH:MM."""
        return await self._b._call(
            "POST",
            "/payroll/schedules",
            json=_body(
                funding_account_id=funding_account_id,
                name=name,
                frequency=frequency,
                timezone=timezone,
                day_of_week=day_of_week,
                day_of_month=day_of_month,
                local_time=local_time,
                items=items,
                pool_id=pool_id,
                auto_approve=auto_approve,
            ),
        )

    async def list_schedules(self) -> BankRecord:
        """GET /payroll/schedules"""
        return await self._b._call("GET", "/payroll/schedules")

    async def set_schedule_status(self, schedule_id: str, status: str) -> BankRecord:
        """POST /payroll/schedules/:id/status. ``status``: active|paused|cancelled."""
        return await self._b._call(
            "POST", f"/payroll/schedules/{_enc(schedule_id)}/status", json={"status": status}
        )

    async def create_pool(
        self,
        *,
        account_id: str | None = None,
        asset: str | None = None,
        chain: str | None = None,
        default_payer_limit_minor: str | None = None,
        payer_limits: dict[str, str] | None = None,
    ) -> BankRecord:
        """POST /payroll/pools"""
        return await self._b._call(
            "POST",
            "/payroll/pools",
            json=_body(
                account_id=account_id,
                asset=asset,
                chain=chain,
                default_payer_limit_minor=default_payer_limit_minor,
                payer_limits=payer_limits,
            ),
        )

    async def list_pools(self) -> BankRecord:
        """GET /payroll/pools"""
        return await self._b._call("GET", "/payroll/pools")

    async def pool_receivables(
        self, *, role: str | None = None, pool_id: str | None = None
    ) -> BankRecord:
        """GET /payroll/pools/receivables. ``role``: payer|operator."""
        return await self._b._call(
            "GET", "/payroll/pools/receivables", params=_params(role=role, pool_id=pool_id)
        )

    async def get_pool(self, pool_id: str) -> BankRecord:
        """GET /payroll/pools/:id"""
        return await self._b._call("GET", f"/payroll/pools/{_enc(pool_id)}")

    async def set_pool_payer_limit(
        self, pool_id: str, *, payer: BankOwnerRef, limit_minor: str
    ) -> BankRecord:
        """POST /payroll/pools/:id/limits"""
        return await self._b._call(
            "POST",
            f"/payroll/pools/{_enc(pool_id)}/limits",
            json=_body(payer=payer, limit_minor=limit_minor),
        )


# ---------------------------------------------------------------- business
class _OrgsNamespace(_Sub):
    async def create(self, *, name: str, reporting_currency: str | None = None) -> BankRecord:
        """POST /orgs"""
        return await self._b._call(
            "POST", "/orgs", json=_body(name=name, reporting_currency=reporting_currency)
        )

    async def list(self) -> BankRecord:
        """GET /orgs"""
        return await self._b._call("GET", "/orgs")

    async def get(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}")

    async def update(
        self, org_id: str, *, name: str | None = None, reporting_currency: str | None = None
    ) -> BankRecord:
        """PATCH /orgs/:orgId"""
        return await self._b._call(
            "PATCH",
            f"/orgs/{_enc(org_id)}",
            json=_body(name=name, reporting_currency=reporting_currency),
        )

    async def audit(self, org_id: str, *, limit: int | None = None) -> BankRecord:
        """GET /orgs/:orgId/audit"""
        return await self._b._call(
            "GET", f"/orgs/{_enc(org_id)}/audit", params=_params(limit=limit)
        )

    async def accept_invite(self, token: str) -> BankRecord:
        """POST /org-invites/accept"""
        return await self._b._call("POST", "/org-invites/accept", json={"token": token})

    async def list_accounts(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/accounts"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/accounts")

    async def open_account(
        self,
        org_id: str,
        *,
        asset: str,
        chain: str,
        kind: str | None = None,
        label: str | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/accounts. ``kind``: checking|savings|treasury."""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/accounts",
            json=_body(kind=kind, asset=asset, chain=chain, label=label),
        )

    async def transfer(
        self,
        org_id: str,
        *,
        idempotency_key: str,
        from_account_id: str,
        amount_minor: str,
        memo: str | None = None,
        category_id: str | None = None,
        approval_token: str | None = None,
        to_account_id: str | None = None,
        to_external: BankToExternal | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/transfers. ``idempotency_key`` REQUIRED; approval policies apply."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/transfers",
            json=_body(
                idempotency_key=key,
                from_account_id=from_account_id,
                amount_minor=amount_minor,
                memo=memo,
                category_id=category_id,
                approval_token=approval_token,
                to_account_id=to_account_id,
                to_external=to_external,
            ),
            idempotency_key=key,
        )

    async def list_card_budgets(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/card-budgets"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/card-budgets")

    async def set_card_budget(
        self,
        org_id: str,
        *,
        scope: str,
        scope_id: str,
        monthly_cap_minor: str | None = None,
        per_tx_cap_minor: str | None = None,
        category_budgets: dict[str, str] | None = None,
        clear_monthly_cap: bool = False,
        clear_per_tx_cap: bool = False,
    ) -> BankRecord:
        """PUT /orgs/:orgId/card-budgets. ``scope``: member|team. Pass ``clear_*=True`` to
        send an explicit null (the API accepts null caps)."""
        body = _body(
            scope=scope,
            scope_id=scope_id,
            monthly_cap_minor=monthly_cap_minor,
            per_tx_cap_minor=per_tx_cap_minor,
            category_budgets=category_budgets,
        )
        if clear_monthly_cap:
            body["monthlyCapMinor"] = None
        if clear_per_tx_cap:
            body["perTxCapMinor"] = None
        return await self._b._call("PUT", f"/orgs/{_enc(org_id)}/card-budgets", json=body)


class _MembersNamespace(_Sub):
    async def list(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/members"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/members")

    async def update(
        self,
        org_id: str,
        user_id: int,
        *,
        role: str | None = None,
        team: str | None = None,
        clear_team: bool = False,
    ) -> BankRecord:
        """PATCH /orgs/:orgId/members/:userId. ``clear_team=True`` sends ``team: null``."""
        body = _body(role=role, team=team)
        if clear_team:
            body["team"] = None
        return await self._b._call(
            "PATCH", f"/orgs/{_enc(org_id)}/members/{int(user_id)}", json=body
        )

    async def remove(self, org_id: str, user_id: int) -> BankRecord:
        """DELETE /orgs/:orgId/members/:userId"""
        return await self._b._call("DELETE", f"/orgs/{_enc(org_id)}/members/{int(user_id)}")

    async def invite(
        self,
        org_id: str,
        *,
        role: str,
        team: str | None = None,
        email: str | None = None,
        telegram_id: int | None = None,
        ttl_hours: int | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/invites"""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/invites",
            json=_body(
                role=role, team=team, email=email, telegram_id=telegram_id, ttl_hours=ttl_hours
            ),
        )

    async def revoke_invite(self, org_id: str, invite_id: str) -> BankRecord:
        """DELETE /orgs/:orgId/invites/:inviteId"""
        return await self._b._call("DELETE", f"/orgs/{_enc(org_id)}/invites/{_enc(invite_id)}")


class _ApprovalsNamespace(_Sub):
    async def list_policies(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/approval-policies"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/approval-policies")

    async def create_policy(
        self,
        org_id: str,
        *,
        rule_type: str,
        approver_roles: list[str],
        threshold_minor: str | None = None,
        required_approvals: int | None = None,
        expiry_hours: int | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/approval-policies. ``rule_type``: transfer_over|new_payee|payroll_run."""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/approval-policies",
            json=_body(
                rule_type=rule_type,
                threshold_minor=threshold_minor,
                required_approvals=required_approvals,
                approver_roles=approver_roles,
                expiry_hours=expiry_hours,
            ),
        )

    async def delete_policy(self, org_id: str, policy_id: str) -> BankRecord:
        """DELETE /orgs/:orgId/approval-policies/:policyId"""
        return await self._b._call(
            "DELETE", f"/orgs/{_enc(org_id)}/approval-policies/{_enc(policy_id)}"
        )

    async def list_requests(self, org_id: str, *, status: str | None = None) -> BankRecord:
        """GET /orgs/:orgId/approval-requests"""
        return await self._b._call(
            "GET", f"/orgs/{_enc(org_id)}/approval-requests", params=_params(status=status)
        )

    async def request(self, org_id: str, *, action: str, payload: dict[str, Any]) -> BankRecord:
        """POST /orgs/:orgId/approval-requests. ``action``: payroll_run|new_payee."""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/approval-requests",
            json=_body(action=action, payload=payload),
        )

    async def approve(self, request_id: str, *, comment: str | None = None) -> BankRecord:
        """POST /approval-requests/:id/approve"""
        return await self._b._call(
            "POST", f"/approval-requests/{_enc(request_id)}/approve", json=_body(comment=comment)
        )

    async def reject(self, request_id: str, *, comment: str | None = None) -> BankRecord:
        """POST /approval-requests/:id/reject"""
        return await self._b._call(
            "POST", f"/approval-requests/{_enc(request_id)}/reject", json=_body(comment=comment)
        )

    async def issue_token(self, request_id: str) -> BankRecord:
        """POST /approval-requests/:id/token"""
        return await self._b._call("POST", f"/approval-requests/{_enc(request_id)}/token")

    async def cancel(self, request_id: str) -> BankRecord:
        """POST /approval-requests/:id/cancel"""
        return await self._b._call("POST", f"/approval-requests/{_enc(request_id)}/cancel")


class _TreasuryNamespace(_Sub):
    async def consolidated(self, org_id: str, *, reconcile: bool | None = None) -> BankRecord:
        """GET /orgs/:orgId/treasury"""
        return await self._b._call(
            "GET", f"/orgs/{_enc(org_id)}/treasury", params=_params(reconcile=reconcile)
        )

    async def runway(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/treasury/runway"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/treasury/runway")

    async def fx_exposure(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/treasury/fx-exposure"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/treasury/fx-exposure")

    async def list_policies(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/treasury/policies"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/treasury/policies")

    async def set_policy(
        self,
        org_id: str,
        *,
        account_id: str,
        floor_minor: str,
        sweep_enabled: bool | None = None,
        sweep_vault_id: str | None = None,
        min_sweep_minor: str | None = None,
    ) -> BankRecord:
        """PUT /orgs/:orgId/treasury/policies"""
        return await self._b._call(
            "PUT",
            f"/orgs/{_enc(org_id)}/treasury/policies",
            json=_body(
                account_id=account_id,
                floor_minor=floor_minor,
                sweep_enabled=sweep_enabled,
                sweep_vault_id=sweep_vault_id,
                min_sweep_minor=min_sweep_minor,
            ),
        )

    async def sweep_plan(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/treasury/sweep-plan"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/treasury/sweep-plan")

    async def sweep(self, org_id: str, *, idempotency_key: str) -> BankRecord:
        """POST /orgs/:orgId/treasury/sweep. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/treasury/sweep",
            json=_body(idempotency_key=key),
            idempotency_key=key,
        )


class _BillsNamespace(_Sub):
    async def list_vendors(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/vendors"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/vendors")

    async def create_vendor(
        self,
        org_id: str,
        *,
        name: str,
        email: str | None = None,
        pay_address: str | None = None,
        pay_chain: str | None = None,
        category_id: str | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/vendors"""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/vendors",
            json=_body(
                name=name,
                email=email,
                pay_address=pay_address,
                pay_chain=pay_chain,
                category_id=category_id,
            ),
        )

    async def list(self, org_id: str, *, status: str | None = None) -> BankRecord:
        """GET /orgs/:orgId/bills"""
        return await self._b._call(
            "GET", f"/orgs/{_enc(org_id)}/bills", params=_params(status=status)
        )

    async def create(
        self,
        org_id: str,
        *,
        vendor_id: str,
        amount_minor: str,
        asset: str,
        chain: str,
        due_date: str,
        reference: str | None = None,
        category_id: str | None = None,
    ) -> BankRecord:
        """POST /orgs/:orgId/bills. ``due_date`` is an ISO date."""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/bills",
            json=_body(
                vendor_id=vendor_id,
                reference=reference,
                amount_minor=amount_minor,
                asset=asset,
                chain=chain,
                due_date=due_date,
                category_id=category_id,
            ),
        )

    async def schedule(
        self, org_id: str, bill_id: str, *, pay_from_account_id: str, scheduled_for: str
    ) -> BankRecord:
        """POST /orgs/:orgId/bills/:billId/schedule"""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/bills/{_enc(bill_id)}/schedule",
            json=_body(pay_from_account_id=pay_from_account_id, scheduled_for=scheduled_for),
        )

    async def cancel(self, org_id: str, bill_id: str) -> BankRecord:
        """POST /orgs/:orgId/bills/:billId/cancel"""
        return await self._b._call("POST", f"/orgs/{_enc(org_id)}/bills/{_enc(bill_id)}/cancel")

    async def ageing(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/collections/ageing"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/collections/ageing")

    async def list_dunning(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/collections/dunning"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/collections/dunning")

    async def run_dunning(self, org_id: str) -> BankRecord:
        """POST /orgs/:orgId/collections/dunning/run"""
        return await self._b._call("POST", f"/orgs/{_enc(org_id)}/collections/dunning/run")


class _BooksNamespace(_Sub):
    async def list_categories(self, org_id: str) -> BankRecord:
        """GET /orgs/:orgId/books/categories"""
        return await self._b._call("GET", f"/orgs/{_enc(org_id)}/books/categories")

    async def create_category(self, org_id: str, *, code: str, name: str, kind: str) -> BankRecord:
        """POST /orgs/:orgId/books/categories. ``kind``: income|expense|transfer|asset|liability|equity."""
        return await self._b._call(
            "POST",
            f"/orgs/{_enc(org_id)}/books/categories",
            json=_body(code=code, name=name, kind=kind),
        )

    async def list_entries(
        self,
        org_id: str,
        *,
        from_: str | None = None,
        to: str | None = None,
        category_id: str | None = None,
        limit: int | None = None,
    ) -> BankRecord:
        """GET /orgs/:orgId/books/entries"""
        return await self._b._call(
            "GET",
            f"/orgs/{_enc(org_id)}/books/entries",
            params=_params(from_=from_, to=to, category_id=category_id, limit=limit),
        )

    async def categorize(self, org_id: str, entry_id: str, category_id: str | None) -> BankRecord:
        """PATCH /orgs/:orgId/books/entries/:entryId (``None`` clears the category)."""
        return await self._b._call(
            "PATCH",
            f"/orgs/{_enc(org_id)}/books/entries/{_enc(entry_id)}",
            json={"categoryId": category_id},
        )

    async def close(self, org_id: str, through: str) -> BankRecord:
        """POST /orgs/:orgId/books/close"""
        return await self._b._call(
            "POST", f"/orgs/{_enc(org_id)}/books/close", json={"through": through}
        )

    async def journal(
        self, org_id: str, *, from_: str | None = None, to: str | None = None
    ) -> BankRecord:
        """GET /orgs/:orgId/books/journal"""
        return await self._b._call(
            "GET", f"/orgs/{_enc(org_id)}/books/journal", params=_params(from_=from_, to=to)
        )


class _BusinessNamespace:
    def __init__(self, bank: BankNamespace) -> None:
        self.orgs = _OrgsNamespace(bank)
        self.members = _MembersNamespace(bank)
        self.approvals = _ApprovalsNamespace(bank)
        self.treasury = _TreasuryNamespace(bank)
        self.bills = _BillsNamespace(bank)
        self.books = _BooksNamespace(bank)


# ------------------------------------------------------------------ agents
class _AgentsNamespace(_Sub):
    async def open_account(
        self, *, asset: str, chain: str, mandate: BankAgentMandate, label: str | None = None
    ) -> BankRecord:
        """POST /agents/accounts: open an agent account with a spending mandate."""
        return await self._b._call(
            "POST",
            "/agents/accounts",
            json=_body(asset=asset, chain=chain, label=label, mandate=mandate),
        )

    async def mandates(self) -> BankRecord:
        """GET /agents/mandates"""
        return await self._b._call("GET", "/agents/mandates")

    async def revoke_mandate(self, mandate_id: str) -> BankRecord:
        """DELETE /agents/mandates/:id"""
        return await self._b._call("DELETE", f"/agents/mandates/{_enc(mandate_id)}")

    async def pay(
        self,
        *,
        mandate_id: str,
        url: str,
        method: str | None = None,
        body: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> BankRecord:
        """POST /agents/pay: x402 pay-per-call within a mandate. The route has no
        idempotency key, so this call is NOT auto-retried."""
        return await self._b._call(
            "POST",
            "/agents/pay",
            json=_body(mandate_id=mandate_id, url=url, method=method, body=body, headers=headers),
        )

    async def register_resource(
        self,
        *,
        account_id: str,
        title: str,
        upstream_url: str,
        price_minor: str,
        description: str | None = None,
        slug: str | None = None,
    ) -> BankRecord:
        """POST /agents/resources: register a paywalled resource you sell."""
        return await self._b._call(
            "POST",
            "/agents/resources",
            json=_body(
                account_id=account_id,
                title=title,
                description=description,
                upstream_url=upstream_url,
                price_minor=price_minor,
                slug=slug,
            ),
        )

    async def resources(self) -> BankRecord:
        """GET /agents/resources"""
        return await self._b._call("GET", "/agents/resources")

    async def set_resource_enabled(self, resource_id: str, enabled: bool) -> BankRecord:
        """POST /agents/resources/:id/enable|disable"""
        action = "enable" if enabled else "disable"
        return await self._b._call("POST", f"/agents/resources/{_enc(resource_id)}/{action}")

    async def directory(self, *, asset: str | None = None, limit: int | None = None) -> BankRecord:
        """GET /agents/directory"""
        return await self._b._call(
            "GET", "/agents/directory", params=_params(asset=asset, limit=limit)
        )

    async def create_stream(
        self,
        *,
        idempotency_key: str,
        payer_account_id: str,
        payee_account_id: str,
        unit_price_minor: str,
        unit: str,
    ) -> BankRecord:
        """POST /agents/streams. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/agents/streams",
            json=_body(
                idempotency_key=key,
                payer_account_id=payer_account_id,
                payee_account_id=payee_account_id,
                unit_price_minor=unit_price_minor,
                unit=unit,
            ),
            idempotency_key=key,
        )

    async def report_usage(self, *, idempotency_key: str, stream_id: str, units: str) -> BankRecord:
        """POST /agents/streams/usage. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/agents/streams/usage",
            json=_body(idempotency_key=key, stream_id=stream_id, units=units),
            idempotency_key=key,
        )


# ---------------------------------------------------------------- platform
class _PlatformNamespace(_Sub):
    async def set_config(
        self,
        *,
        fee_bps_transfer: int | None = None,
        fee_bps_fx: int | None = None,
        webhook_url: str | None = None,
        clear_webhook_url: bool = False,
    ) -> BankRecord:
        """PUT /platform/config. ``clear_webhook_url=True`` sends ``webhookUrl: null``."""
        body = _body(
            fee_bps_transfer=fee_bps_transfer, fee_bps_fx=fee_bps_fx, webhook_url=webhook_url
        )
        if clear_webhook_url:
            body["webhookUrl"] = None
        return await self._b._call("PUT", "/platform/config", json=body)

    async def get_config(self) -> BankRecord:
        """GET /platform/config"""
        return await self._b._call("GET", "/platform/config")

    async def create_customer(
        self,
        *,
        external_ref: str,
        display_name: str | None = None,
        email: str | None = None,
        country: str | None = None,
    ) -> BankRecord:
        """POST /platform/customers"""
        return await self._b._call(
            "POST",
            "/platform/customers",
            json=_body(
                external_ref=external_ref, display_name=display_name, email=email, country=country
            ),
        )

    async def list_customers(self) -> BankRecord:
        """GET /platform/customers"""
        return await self._b._call("GET", "/platform/customers")

    async def open_account(
        self,
        customer_id: str,
        *,
        asset: str,
        chain: str,
        kind: str | None = None,
        label: str | None = None,
    ) -> BankRecord:
        """POST /platform/customers/:cid/accounts. ``kind``: checking|savings."""
        return await self._b._call(
            "POST",
            f"/platform/customers/{_enc(customer_id)}/accounts",
            json=_body(asset=asset, chain=chain, kind=kind, label=label),
        )

    async def list_accounts(self, customer_id: str) -> BankRecord:
        """GET /platform/customers/:cid/accounts"""
        return await self._b._call("GET", f"/platform/customers/{_enc(customer_id)}/accounts")

    async def transfer(
        self,
        *,
        idempotency_key: str,
        customer_id: str,
        from_account_id: str,
        amount_minor: str,
        memo: str | None = None,
        to_account_id: str | None = None,
        to_external: BankToExternal | None = None,
    ) -> BankRecord:
        """POST /platform/transfers. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/platform/transfers",
            json=_body(
                idempotency_key=key,
                customer_id=customer_id,
                from_account_id=from_account_id,
                amount_minor=amount_minor,
                memo=memo,
                to_account_id=to_account_id,
                to_external=to_external,
            ),
            idempotency_key=key,
        )

    async def list_transfers(self) -> BankRecord:
        """GET /platform/transfers"""
        return await self._b._call("GET", "/platform/transfers")

    async def fx(
        self,
        *,
        idempotency_key: str,
        customer_id: str,
        from_account_id: str,
        to_account_id: str,
        amount_minor: str,
        slippage: float | None = None,
    ) -> BankRecord:
        """POST /platform/fx. ``idempotency_key`` REQUIRED."""
        key = self._b._key(idempotency_key)
        return await self._b._call(
            "POST",
            "/platform/fx",
            json=_body(
                idempotency_key=key,
                customer_id=customer_id,
                from_account_id=from_account_id,
                to_account_id=to_account_id,
                amount_minor=amount_minor,
                slippage=slippage,
            ),
            idempotency_key=key,
        )

    async def usage(self, *, from_: str | None = None, to: str | None = None) -> BankRecord:
        """GET /platform/usage"""
        return await self._b._call("GET", "/platform/usage", params=_params(from_=from_, to=to))

    async def connector_convert(self, *, xml: str | None = None, batch: Any = None) -> BankRecord:
        """POST /platform/connector/convert: ``xml`` (pain.001 -> JSON) or ``batch`` (JSON -> pain.001 XML)."""
        return await self._b._call(
            "POST", "/platform/connector/convert", json=_body(xml=xml, batch=batch)
        )

    async def connector_import_pain001(
        self, *, customer_id: str, xml: str | None = None, batch: Any = None
    ) -> BankRecord:
        """POST /platform/connector/pain001: import a pain.001 credit-transfer batch for a customer."""
        return await self._b._call(
            "POST",
            "/platform/connector/pain001",
            json=_body(customer_id=customer_id, xml=xml, batch=batch),
        )


# ------------------------------------------------------- chains / privacy
class _ChainsNamespace(_Sub):
    async def fee_model(
        self,
        *,
        asset: str,
        chains: list[str],
        amount_minor: str | None = None,
        amount: str | None = None,
    ) -> BankRecord:
        """POST /chains/fee-model. Exactly one of ``amount_minor`` / ``amount``."""
        return await self._b._call(
            "POST",
            "/chains/fee-model",
            json=_body(asset=asset, chains=chains, amount_minor=amount_minor, amount=amount),
        )


class _PrivacyNamespace(_Sub):
    async def meta_address(self) -> BankRecord:
        """POST /privacy/meta-address: private keys are returned ONCE and never stored."""
        return await self._b._call("POST", "/privacy/meta-address")

    async def payout_address(
        self,
        *,
        payee_meta_address: str,
        payout_ref: str,
        token: dict[str, str] | None = None,
    ) -> BankRecord:
        """POST /privacy/payout-address"""
        return await self._b._call(
            "POST",
            "/privacy/payout-address",
            json=_body(payee_meta_address=payee_meta_address, payout_ref=payout_ref, token=token),
        )

    async def announced(self, *, payout_ref: str, tx_hash: str, chain: str) -> BankRecord:
        """POST /privacy/announced"""
        return await self._b._call(
            "POST",
            "/privacy/announced",
            json=_body(payout_ref=payout_ref, tx_hash=tx_hash, chain=chain),
        )

    async def announcements(
        self,
        *,
        chain: str,
        from_block: str,
        to_block: str | None = None,
        cursor: int | None = None,
        limit: int | None = None,
    ) -> BankRecord:
        """GET /privacy/announcements. Pass the returned cursor as the next ``from_block``."""
        return await self._b._call(
            "GET",
            "/privacy/announcements",
            params=_params(
                chain=chain, from_block=from_block, to_block=to_block, cursor=cursor, limit=limit
            ),
        )


class _SegmentsNamespace(_Sub):
    async def list(self) -> BankRecord:
        """GET /segments"""
        return await self._b._call("GET", "/segments")

    async def get(self, segment: str) -> BankRecord:
        """GET /segments/:segment"""
        return await self._b._call("GET", f"/segments/{_enc(segment)}")

    async def account_features(self, account_id: str) -> BankRecord:
        """GET /accounts/:id/features"""
        return await self._b._call("GET", f"/accounts/{_enc(account_id)}/features")

    async def set_account_segment(self, account_id: str, segment: str | None) -> BankRecord:
        """PUT /accounts/:id/segment (``None`` clears the segment)"""
        return await self._b._call(
            "PUT", f"/accounts/{_enc(account_id)}/segment", json={"segment": segment}
        )


class _OpsNamespace(_Sub):
    async def alerts(self) -> BankRecord:
        """GET /ops/alerts: the owner's stuck transfers/ops (read-only)."""
        return await self._b._call("GET", "/ops/alerts")


class BankNamespace:
    """``client.bank``: Suwappu Bank (``/v1/agent/bank/*``, agent API key required)."""

    def __init__(self, client: SuwappuClient) -> None:
        self._c = client
        self.retry = BankRetryOptions()
        self.accounts = _AccountsNamespace(self)
        self.transfers = _TransfersNamespace(self)
        self.assets = _AssetsNamespace(self)
        self.fx = _FxNamespace(self)
        self.earn = _EarnNamespace(self)
        self.credit = _CreditNamespace(self)
        self.ramps = _RampsNamespace(self)
        self.remittance = _RemittanceNamespace(self)
        self.cards = _CardsNamespace(self)
        self.payments = _PaymentsNamespace(self)
        self.payroll = _PayrollNamespace(self)
        self.business = _BusinessNamespace(self)
        self.agents = _AgentsNamespace(self)
        self.platform = _PlatformNamespace(self)
        self.chains = _ChainsNamespace(self)
        self.privacy = _PrivacyNamespace(self)
        self.segments = _SegmentsNamespace(self)
        self.ops = _OpsNamespace(self)

    @staticmethod
    def _key(key: str | None) -> str:
        """Raise TypeError unless ``key`` is a valid idempotency key."""
        if not isinstance(key, str) or not _IDEM_RE.match(key):
            raise TypeError("idempotency_key is required: 8-128 chars of A-Za-z0-9_.:-")
        return key

    async def _call(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """Bank request helper: bank-typed errors + bounded retry. Retries only reads and
        calls that carry an idempotency key, with the same key."""
        headers: dict[str, str] | None = (
            {"Idempotency-Key": idempotency_key} if idempotency_key else None
        )
        safe_to_retry = method == "GET" or bool(idempotency_key)
        attempt = 0
        while True:
            response = await self._c._client.request(
                method,
                f"/v1/agent/bank{path}",
                params=params or None,
                json=json,
                headers=headers,
            )
            if response.status_code < 400:
                return response.json()
            err = _error_from_response(
                response.status_code, response.text, response.headers.get("Retry-After")
            )
            if not safe_to_retry or not err.retryable or attempt >= self.retry.max_retries:
                raise err
            backoff = (
                err.retry_after
                if err.retry_after is not None
                else self.retry.base_delay_s * (2**attempt)
            )
            await asyncio.sleep(min(backoff, self.retry.max_delay_s))
            attempt += 1
