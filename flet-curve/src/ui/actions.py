"""The four things you can do to a pool: deposit, withdraw, swap, stake."""

from __future__ import annotations

import contextlib
import time
from collections.abc import Awaitable, Callable
from decimal import ROUND_CEILING, Decimal

import flet as ft

from curve.abi import FEE_DENOMINATOR, apply_slippage
from curve.api import CurveApi
from curve.confirm import POLL_INTERVAL, wait_for_confirmation
from curve.format import is_dust, token_amount, units_to_float
from curve.gas import (
    fee_in_native,
    format_fee,
    native_for,
    native_price,
    read_fees,
    settlement_price,
)
from curve.http import ApiError
from curve.models import Coin, Pool
from curve.pool import PoolContract
from curve.rewards import CRV_DECIMALS, crv_token
from curve.stake_zaps import stake_zap_for
from curve.zaps import zap_for
from wallet.base import WalletError
from wallet.erc20 import format_units, parse_units

from . import AnyEvent, buttons, theme
from .alarm import Alarm, Band
from .assets import chain_name
from .logos import pool_stack, token_mark
from .status import DONE, FAILED, StatusPanel
from .typography import BODY, LABEL, SMALL

#: How often to ask whether a transaction has been mined.
CONFIRM_INTERVAL = POLL_INTERVAL

#: Between the fields and the buttons under them.
BUTTON_GAP = 24

#: Tolerance used until the pool says otherwise, and whenever it will not.
DEFAULT_SLIPPAGE = 0.5

#: "no fee read yet" -- distinct from None, which is what the deposit and
#: withdraw panels use as their key.
_NOT_READ = object()

#: How much of the pool's own fee to allow as slippage, for an action whose
#: quote is exact.
SLIPPAGE_OF_FEE = 0.2

#: The deposit and withdrawal side, as `a * fee + b`, fitted to what real
#: deposits need: 88 measurements over 44 mainnet pools, run on a fork
#: through titanoboa, bisecting `min_mint` until `add_liquidity` stops
#: reverting.
ESTIMATE_FEE_SHARE = 1.0

#: `b` is what the same fit says is zero -- and it is zero *across pools*,
#: because a cross-section cannot see time.
QUOTE_DRIFT = 0.005

#: The probe trade, as a divisor of what was typed.
IMPACT_PROBE_DIVISOR = 20

#: The smallest probe worth quoting, in the token's own smallest units --
#: applied at **both** ends of the trade.
IMPACT_MIN_PROBE = 10_000

#: How long the chain's fee readings are kept before being asked for again.
FEE_TTL = 12.0

#: One client for the native coin's price, shared by every panel.
_PRICES = CurveApi()


async def _native_usd(chain: str, chain_id: int) -> float:
    """What the chain's coin is worth, or zero if nobody will say."""
    try:
        return await native_price(_PRICES, chain, chain_id)
    except ApiError:
        return 0.0


#: The mark beside an amount on the estimate line.
ESTIMATE_MARK = 16

#: Under this, in percent, the impact is inside the probe's own error.
IMPACT_FLOOR = 0.01

#: Where the number stops being a detail and becomes a reason to type a
#: smaller one.
IMPACT_HIGH = 1.0

def impact_probe(amounts: list[int]) -> list[int] | None:
    """A twentieth of each amount, or None where that cannot be measured."""
    probe = [amount // IMPACT_PROBE_DIVISOR for amount in amounts]
    if not any(probe):
        return None
    if any(
        amount > 0 and value < IMPACT_MIN_PROBE
        for amount, value in zip(amounts, probe, strict=True)
    ):
        return None
    return probe


def price_impact(probe_out: int, out: int) -> float | None:
    """What the size of a trade costs it, in percent."""
    if probe_out < IMPACT_MIN_PROBE or out <= 0:
        return None
    return (probe_out * IMPACT_PROBE_DIVISOR - out) / out * 100


def format_impact(percent: float) -> str:
    """Two decimals, and a floor where the probe's precision runs out."""
    if abs(percent) < IMPACT_FLOOR:
        return f"under {IMPACT_FLOOR:.2f}%"
    return f"{percent:.2f}%"


def slippage_for(
    fee_units: int, multiple: float = SLIPPAGE_OF_FEE, constant: float = 0.0
) -> float:
    """`a * fee + b`, in percent, from a fee in Curve's 1e10 units."""
    return fee_units / FEE_DENOMINATOR * 100 * multiple + constant


def format_slippage(percent: float) -> str:
    """Three significant figures, rounded *up*."""
    if percent <= 0:
        return "0"
    value = Decimal(repr(percent))
    step = Decimal(1).scaleb(value.adjusted() - 2)      # third significant digit
    rounded = value.quantize(step, rounding=ROUND_CEILING)
    text = format(rounded, "f").rstrip("0").rstrip(".")
    return text or "0"


def _stacked(*controls: ft.Control) -> ft.Column:
    """A field with its caption underneath, both as wide as the panel."""
    return ft.Column(
        list(controls),
        spacing=2,
        horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
    )


def _aside(control: ft.Control) -> ft.Row:
    """A control that should keep its own size, pushed to the right."""
    return ft.Row([control], alignment=ft.MainAxisAlignment.END, tight=True)


class ActionTab:
    """Base for the four panels. Subclasses build fields and submit."""

    title = ""
    #: Label for the button that sends the main transaction.
    submit_label = "Confirm"
    #: Past tense, for the line shown once the transaction is mined.
    _done_verb = "Confirmed"

    @property
    def done_verb(self) -> str:
        return self._done_verb
    #: Does this action have a price to protect?
    uses_slippage = True
    #: `a` and `b` for this action. Deposits and withdrawals are quoted
    #: by `calc_token_amount`, which some implementations compute fee-
    #: free.
    fee_multiple = ESTIMATE_FEE_SHARE
    slippage_constant = QUOTE_DRIFT
    #: Does the size of this action move the price it gets?
    shows_impact = False

    @property
    def available(self) -> bool:
        """Is there anything this panel can act on?"""
        return True

    def __init__(
        self,
        page: ft.Page,
        pool: Pool,
        get_contract: Callable[[], PoolContract | None],
        on_done: Callable[[], Awaitable[None]],
    ) -> None:
        self.page = page
        self.pool = pool
        self.get_contract = get_contract
        self.on_done = on_done

        self.slippage = ft.TextField(
            label="Slippage %",
            value=str(DEFAULT_SLIPPAGE),
            width=92,
            dense=True,
            text_size=LABEL,
            label_style=ft.TextStyle(size=LABEL),
            on_change=self._slippage_edited,
        )
        self._slippage_is_theirs = False
        self._fee_read_for: object = _NOT_READ
        #: True from the moment a transaction is built until the last one
        #: in the action has confirmed. Read by everything that touches the
        #: buttons, because a refresh runs concurrently with a send.
        self._sending = False
        self.status_panel = StatusPanel(page)
        self.status = self.status_panel.text
        self.status_spinner = self.status_panel.spinner
        self.estimate = ft.Text("", size=BODY, color=ft.Colors.ON_SURFACE)
        self.impact = ft.Text("", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT)
        self.estimate_line = ft.Row(
            [self.estimate],
            spacing=6,
            run_spacing=4,
            wrap=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )
        self.estimate_panel = self._band(self.estimate_line)
        self.impact_panel = self._band(self.impact, visible=False, kind="impact")
        self.fee = ft.Text("", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT)
        self.fee_panel = self._band(self.fee, visible=False, kind="fee")
        self._pending_approval: tuple[str, str, int] | None = None
        self._fees: tuple[int, int, int, bool] | None = None
        self._fees_read_at = 0.0
        self._alarms = Alarm(self._page_of())
        self._estimate_problem = False
        self._impact_high = False

        self.network_note = ft.Text("", size=SMALL, expand=True)
        self.switch_button = ft.TextButton("Switch", on_click=self._switch_network)
        self.network_panel = ft.Container(
            ft.Row([self.network_note, self.switch_button], spacing=8, tight=True),
            padding=ft.Padding.symmetric(horizontal=10, vertical=8),
            border_radius=8,
            bgcolor=ft.Colors.with_opacity(0.12, ft.Colors.TERTIARY),
            visible=False,
            shadow=theme.panel_shadow(page, inset=True),
        )

        self.approve_button = buttons.Themed(
            "1. Approve",
            page=page,
            on_click=self._approve_clicked,
            visible=False,
            disabled=True,
        )
        self.submit_button = buttons.Themed(
            self.submit_label,
            page=page,
            on_click=self._submit_clicked,
            disabled=True,
        )
        self._approve_box = buttons.shadowed(self.approve_button, page)
        self._submit_box = buttons.shadowed(self.submit_button, page)
        self.control = ft.Column(
            spacing=12, horizontal_alignment=ft.CrossAxisAlignment.STRETCH
        )
        self.frame = ft.Column(
            spacing=BUTTON_GAP,
            horizontal_alignment=ft.CrossAxisAlignment.STRETCH,
        )

    # -- to implement -----------------------------------------------------

    def build(self) -> list[ft.Control]:
        raise NotImplementedError

    async def refresh(self) -> None:
        """Re-read balances and re-quote. Must tolerate no wallet."""

    async def fee_units(self, contract: PoolContract) -> int:
        """The fee this action pays, in Curve's 1e10 units."""
        return await contract.fee()

    def fee_key(self) -> object:
        """What the fee depends on, so it is re-read when that changes."""
        return None

    async def _quote(self, contract: PoolContract, amounts: list[int]) -> int:
        """What this action produces for `amounts`, asked of the pool."""
        raise NotImplementedError

    async def measure_impact(
        self, contract: PoolContract, amounts: list[int], out: int
    ) -> float | None:
        """Quote a twentieth of the same action and compare the two rates."""
        probe = impact_probe(amounts)
        if probe is None:
            return None
        try:
            probe_out = await self._quote(contract, probe)
        except WalletError:
            return None
        return price_impact(probe_out, out)

    def show_estimate(self, text: str, *, problem: bool = False) -> None:
        """The result line -- or the reason there is no result."""
        self.estimate.value = text
        self.estimate.color = ft.Colors.ERROR if problem else ft.Colors.ON_SURFACE
        self.estimate_line.controls = [self.estimate]
        self._estimate_problem = problem and bool(text)
        self._sync_alarm()

    def show_receipts(self, receipts: list[tuple[ft.Control, str]]) -> None:
        """The same line, with each amount behind the mark of its token."""
        if not receipts:
            self.show_estimate("")
            return
        self.estimate.value = "-> " + "  +  ".join(text for _mark, text in receipts)
        self.estimate.color = ft.Colors.ON_SURFACE
        controls: list[ft.Control] = [
            ft.Text("->", size=BODY, color=ft.Colors.ON_SURFACE)
        ]
        for index, (mark, text) in enumerate(receipts):
            if index:
                controls.append(ft.Text("+", size=BODY, color=ft.Colors.ON_SURFACE))
            controls.append(
                ft.Row(
                    [mark, ft.Text(text, size=BODY, color=ft.Colors.ON_SURFACE)],
                    spacing=5,
                    tight=True,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                )
            )
        self.estimate_line.controls = controls
        self._estimate_problem = False
        self._sync_alarm()

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        """The transaction `submit` would send, without sending it."""
        return None

    def prelude(self, contract: PoolContract) -> tuple[str, tuple[str, str]] | None:
        """The transaction that has to go first, and what to call it."""
        if self._pending_approval is None:
            return None
        token, spender, amount = self._pending_approval
        return "to approve first", contract.build_approve(token, spender, amount)

    async def show_gas(self, contract: PoolContract | None) -> None:
        """Price the transaction this panel would send, or say nothing."""
        self.fee_panel.visible = False
        self.fee.value = ""
        if contract is None or not contract.can_send:
            return
        gas, note = 0, ""
        with contextlib.suppress(WalletError):
            built = self.preview(contract)
            if built is not None:
                gas = await contract.estimate_gas(built)
        if gas <= 0:
            with contextlib.suppress(WalletError):
                first = self.prelude(contract)
                if first is not None:
                    note, built = first
                    gas = await contract.estimate_gas(built)
        if gas <= 0:
            return
        fees = await self._chain_fees(contract)
        if fees is None:
            return
        base, price, tip, eip1559 = fees
        per_gas = settlement_price(
            base_fee=base, gas_price=price, node_tip=tip, eip1559=eip1559
        )
        native = native_for(self.pool.chain_id)
        amount = fee_in_native(gas, per_gas)
        usd = await _native_usd(self.pool.chain, self.pool.chain_id)
        self.fee.value = (
            "Network fee "
            + format_fee(amount, native.symbol, amount * usd)
            + (f"  {note}" if note else "")
        )
        self.fee_panel.visible = True

    async def _chain_fees(
        self, contract: PoolContract
    ) -> tuple[int, int, int, bool] | None:
        """The chain's own numbers, at most once a block."""
        now = time.monotonic()
        if self._fees is None or now - self._fees_read_at > FEE_TTL:
            fees = await read_fees(contract.provider)
            if not any(fees[:2]):
                return None
            self._fees, self._fees_read_at = fees, now
        return self._fees

    def show_impact(self, impact: float | None) -> None:
        """Put the measurement on screen, or take the line away entirely."""
        self.impact_panel.visible = impact is not None
        high = impact is not None and impact >= IMPACT_HIGH
        self.impact.value = (
            "" if impact is None else f"Price impact {format_impact(impact)}"
        )
        self.impact.color = ft.Colors.ERROR if high else ft.Colors.ON_SURFACE_VARIANT
        self._impact_high = high
        self._sync_alarm()

    def _band(
        self, text: ft.Control, *, visible: bool = True, kind: str = ""
    ) -> Band:
        return Band(text, self._page_of(), kind=kind, visible=visible)

    def _page_of(self) -> ft.Page:
        return self.page

    def _sync_alarm(self) -> None:
        """Whichever line is worth flashing, or neither."""
        if self._estimate_problem:
            self._alarm(self.estimate_panel)
        elif self._impact_high:
            self._alarm(self.impact_panel)
        else:
            self._alarm(None)

    @property
    def flashing(self) -> Band | None:
        """Which annotation band is pulsing, if any."""
        return self._alarms.panel

    def _alarm(self, panel: Band | None) -> None:
        """Start the pulse on `panel`, or stop whatever is pulsing."""
        self._alarms.point_at(panel)

    async def suggest_slippage(self, contract: PoolContract | None) -> None:
        """Set the tolerance from the pool's own fee, once, quietly."""
        if contract is None or not self.uses_slippage or self._slippage_is_theirs:
            return
        key = self.fee_key()
        if key == self._fee_read_for:
            return
        try:
            fee = await self.fee_units(contract)
        except WalletError:
            return
        self._fee_read_for = key
        if fee <= 0:
            return
        percent = slippage_for(fee, self.fee_multiple, self.slippage_constant)
        self.slippage.value = format_slippage(percent)
        self.slippage.tooltip = (
            f"from this pool's {fee / FEE_DENOMINATOR * 100:.4g}% fee"
        )

    async def submit(self, contract: PoolContract) -> str:
        raise NotImplementedError

    def clear_inputs(self) -> None:
        """Empty the amount fields after a confirmed transaction."""

    async def approval_needed(self, contract: PoolContract) -> tuple[str, str, int] | None:
        """Return `(token, spender, amount)` still needing an allowance."""
        return None

    # -- shared behaviour -------------------------------------------------

    def mount(self) -> ft.Column:
        self.control.controls = [
            self.network_panel,
            *self.build(),
            *([_aside(self.slippage)] if self.uses_slippage else []),
            self.estimate_panel,
            *([self.impact_panel] if self.shows_impact else []),
            self.fee_panel,
        ]
        self.frame.controls = [
            self.control,
            self._approve_box,
            self._submit_box,
            self.status_panel,
        ]
        return self.frame

    async def network_ok(self, contract: PoolContract | None) -> bool:
        """Is the wallet on the network these pools are on?"""
        if contract is None or not self.pool.chain_id:
            self.network_panel.visible = False
            return True
        try:
            current = await contract.provider.chain_id()
        except WalletError:
            self.network_panel.visible = False
            return True
        matched = current == self.pool.chain_id
        self.network_panel.visible = not matched
        if not matched:
            wanted = chain_name(self.pool.chain) or f"chain {self.pool.chain_id}"
            self.network_note.value = (
                f"Your wallet is on another network. Switch it to {wanted} to "
                "read balances or act on this pool."
            )
            self.switch_button.content = f"Switch to {wanted}"
            self.show_estimate("")
            self.show_impact(None)
            self.approve_button.visible = False
            self.submit_button.disabled = True
        return matched

    async def _switch_network(self, _e: AnyEvent) -> None:
        """Ask the wallet to move. It may refuse, or not know the chain."""
        contract = self.get_contract()
        if contract is None:
            return
        try:
            await contract.provider.switch_chain(self.pool.chain_id)
        except WalletError as exc:
            self._failed(exc)
            return
        await self.refresh()

    def _slippage_edited(self, _e: AnyEvent) -> None:
        self._slippage_is_theirs = True

    def slippage_pct(self) -> float:
        try:
            value = float((self.slippage.value or "").strip())
        except ValueError:
            return DEFAULT_SLIPPAGE
        return value if 0 <= value < 100 else DEFAULT_SLIPPAGE

    def with_slippage(self, amount: int) -> int:
        return apply_slippage(amount, self.slippage_pct())

    def _say(
        self, message: str, colour: str | None = None, *, pending: bool = False
    ) -> None:
        """Show a status. `pending` means a spinner and a neutral tint."""
        self.status_panel.say(message, colour, pending=pending)
        self.page.update()

    def _failed(self, error: WalletError) -> None:
        """Report a wallet failure -- or, for a refusal, report nothing."""
        self._say("" if error.rejected_by_user else str(error), FAILED)

    def _busy(self, busy: bool) -> None:
        """Hold the buttons down for the length of an action.

        The flag outlives this call because a `refresh` can land in the
        middle of one: it runs on its own task, and `_sync_approval` sets
        `submit_button.disabled` from the allowance alone. A MAX click or
        an edited amount while the wallet prompt is open was enough to
        re-enable Submit under a transaction that had already been built,
        and the second press builds a second one.
        """
        self._sending = busy
        self.submit_button.disabled = busy
        self.approve_button.disabled = busy
        self.page.update()

    async def _step(self, contract: PoolContract, tx: str, done: str) -> None:
        """Wait for a transaction that is *not* the last one in this action."""
        self._say(f"{done} Waiting for {tx[:14]}… to confirm.", pending=True)
        await wait_for_confirmation(contract.provider, tx, interval=CONFIRM_INTERVAL)

    async def _confirm(self, contract: PoolContract, tx: str, done: str) -> None:
        """Wait for the transaction, then let the panel read the result."""
        self._say(f"Waiting for {tx[:14]}… to confirm.", pending=True)
        await wait_for_confirmation(contract.provider, tx, interval=CONFIRM_INTERVAL)
        self._say(done, DONE)

    def amount_label(self, address: str, amount: int) -> str:
        """`1,000 USDC` -- an amount in the units of whatever token it is."""
        for coin in self.pool.coins:
            if coin.address.lower() == address.lower():
                return (
                    f"{token_amount(units_to_float(amount, coin.decimals))} "
                    f"{coin.symbol}"
                )
        return f"{token_amount(units_to_float(amount, 18))} LP"

    def summary(self) -> str:
        """What the pending transaction does, for the confirmation line."""
        return ""

    def done_message(self) -> str:
        summary = self.summary()
        return f"{self.done_verb} {summary}." if summary else f"{self.done_verb}."

    async def _approve_clicked(self, _e: AnyEvent) -> None:
        contract = self.get_contract()
        if contract is None or not contract.can_send:
            self._say("Connect a wallet first.", ft.Colors.ERROR)
            return
        self._busy(True)
        try:
            pending = await self.approval_needed(contract)
            if pending is None:
                self._say("Already approved.")
            else:
                token, spender, amount = pending
                self._say("Confirm the approval in your wallet…", pending=True)
                tx = await contract.approve(token, spender, amount)
                await self._confirm(
                    contract, tx, f"Approved {self.amount_label(token, amount)}."
                )
        except WalletError as exc:
            self._failed(exc)
        finally:
            self._busy(False)
            await self.refresh()

    async def _submit_clicked(self, _e: AnyEvent) -> None:
        contract = self.get_contract()
        if contract is None or not contract.can_send:
            self._say("Connect a wallet first.", ft.Colors.ERROR)
            return
        self._busy(True)
        try:
            self._say("Confirm in your wallet…", pending=True)
            done = self.done_message()
            tx = await self.submit(contract)
            await self._confirm(contract, tx, done)
            self.clear_inputs()
            await self.on_done()
        except WalletError as exc:
            self._failed(exc)
        finally:
            self._busy(False)
            await self.refresh()

    async def _sync_approval(self, contract: PoolContract | None) -> None:
        """Show or hide the approve step based on the current allowance."""
        if contract is None or not contract.can_send:
            self.approve_button.visible = False
            self.submit_button.disabled = True
            self.submit_button.content = self.submit_label
            return
        try:
            pending = await self.approval_needed(contract)
        except WalletError:
            pending = None
        self._pending_approval = pending
        self.approve_button.visible = pending is not None
        self.approve_button.disabled = pending is None or self._sending
        self.submit_button.content = (
            f"2. {self.submit_label}" if pending is not None else self.submit_label
        )
        self.submit_button.disabled = pending is not None or self._sending


def _max_button(on_click) -> ft.TextButton:
    """The "MAX" affordance that lives inside an amount field."""
    return ft.TextButton(
        "MAX",
        on_click=on_click,
        style=ft.ButtonStyle(
            padding=ft.Padding.symmetric(horizontal=8),
            text_style=ft.TextStyle(size=LABEL, weight=ft.FontWeight.BOLD),
        ),
    )


def _amount_field(
    label: str, on_change, mark: ft.Control | None = None, on_max=None
) -> ft.TextField:
    """An amount input, with the token's mark in front of it."""
    constraints = None
    if mark is not None:
        width = (getattr(mark, "width", None) or 20) + 16
        height = (getattr(mark, "height", None) or 20) + 12
        mark = ft.Container(
            mark,
            width=width,
            height=height,
            padding=ft.Padding.only(left=10),
            alignment=ft.Alignment.CENTER_LEFT,
        )
        constraints = ft.BoxConstraints(min_width=width, min_height=height)
    return ft.TextField(
        label=label,
        hint_text="0.0",
        dense=True,
        on_change=on_change,
        prefix_icon=mark,
        prefix_icon_size_constraints=constraints,
        suffix_icon=_max_button(on_max) if on_max is not None else None,
        suffix_icon_size_constraints=(
            ft.BoxConstraints(min_width=58, min_height=28) if on_max else None
        ),
    )


class _AmountRows:
    """The amount fields for one deposit route, as a block that can hide."""

    def __init__(self, coins, chain: str, on_change, on_max) -> None:
        self.coins = list(coins)
        self.fields: list[ft.TextField] = []
        self.labels: list[ft.Text] = []
        self.balances: list[int] = [0] * len(self.coins)
        rows: list[ft.Control] = []
        for index, coin in enumerate(self.coins):

            def fill(_e: AnyEvent, index: int = index) -> None:
                on_max(self, index)

            field = _amount_field(
                coin.symbol, on_change, token_mark(coin, chain, 20), on_max=fill
            )
            label = ft.Text("", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT)
            self.fields.append(field)
            self.labels.append(label)
            rows.append(_stacked(field, label))
        self.control = ft.Column(
            rows, spacing=12, horizontal_alignment=ft.CrossAxisAlignment.STRETCH
        )

    def amounts(self) -> list[int]:
        out = []
        for field, coin in zip(self.fields, self.coins):
            text = (field.value or "").strip()
            try:
                out.append(parse_units(text, coin.decimals) if text else 0)
            except ValueError:
                out.append(0)
        return out

    def clear(self) -> None:
        for field in self.fields:
            field.value = ""


def underlying_swap_spender(pool: Pool) -> str | None:
    """Who moves the coins for an underlying swap, or None if nobody can."""
    if not pool.has_underlying:
        return None
    if pool.is_stableswap:
        return pool.address
    zap = zap_for(pool)
    return zap.address if zap is not None and zap.swaps else None


def _route_picker(on_change, *, underlying: bool) -> ft.RadioGroup:
    """Underlying or pool tokens: which coins the amounts are denominated in."""
    return ft.RadioGroup(
        value="underlying" if underlying else "pool",
        content=ft.Row(
            [
                ft.Radio(value="underlying", label="Underlying"),
                ft.Radio(value="pool", label="Pool tokens"),
            ]
        ),
        on_change=on_change,
    )


def _coin_options(coins, chain: str) -> list[ft.DropdownOption]:
    """Dropdown entries carrying each coin's mark beside its symbol."""
    return [
        ft.DropdownOption(
            key=str(index),
            text=coin.symbol,
            content=ft.Row(
                [token_mark(coin, chain, 18), ft.Text(coin.symbol, size=BODY)],
                spacing=8,
                tight=True,
            ),
        )
        for index, coin in enumerate(coins)
    ]


class DepositTab(ActionTab):
    """Add liquidity: an amount per coin, quoted as LP tokens out."""

    title = "Deposit"
    submit_label = "Deposit"
    # No `_done_verb`: `done_verb` below is a property, because the line
    # has to say whether the LP was staked as well as minted.
    shows_impact = True

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.zap = zap_for(self.pool)
        self.stake_zap = stake_zap_for(self.pool)
        self.stake_box = ft.Checkbox(
            label="Stake",
            value=False,
            on_change=self._stake_toggled,
            visible=self.pool.has_gauge,
            tooltip=(
                "Deposit and stake in the gauge in one transaction."
                if self.stake_zap is not None
                else "Deposit, then stake what it mints. Two transactions: "
                "this network has no deposit-and-stake zap."
            ),
        )
        self.route = _route_picker(
            self._route_changed, underlying=self.zap is not None
        )
        self.route.visible = self.zap is not None
        self.routes = {
            "pool": _AmountRows(
                self.pool.pool_coins, self.pool.chain, self._changed, self._max_for
            )
        }
        if self.zap is not None:
            self.routes["underlying"] = _AmountRows(
                self.pool.display_coins, self.pool.chain, self._changed, self._max_for
            )
        self._apply_route()
        self._expected_lp = 0
        self._quote_ok = True

    # -- which route is live ----------------------------------------------

    @property
    def underlying(self) -> bool:
        return self.zap is not None and self.route.value == "underlying"

    @property
    def rows(self) -> _AmountRows:
        return self.routes["underlying" if self.underlying else "pool"]

    @property
    def staking(self) -> bool:
        """Is the box ticked, on a pool that has somewhere to stake?"""
        return self.pool.has_gauge and bool(self.stake_box.value)

    @property
    def combined(self) -> bool:
        """Can this go in one transaction rather than two?"""
        return self.staking and self.stake_zap is not None

    @property
    def spender(self) -> str:
        """Who moves the coins: the pool, the deposit zap, or the stake zap."""
        if self.combined and self.stake_zap is not None:
            return self.stake_zap.address
        return self.zap.address if self.underlying and self.zap else self.pool.address

    # The panel's own fields, as the rest of the class and the tests know
    # them -- always those of the live route.
    @property
    def fields(self) -> list[ft.TextField]:
        return self.rows.fields

    @property
    def balance_labels(self) -> list[ft.Text]:
        return self.rows.labels

    @property
    def balances(self) -> list[int]:
        return self.rows.balances

    @balances.setter
    def balances(self, values: list[int]) -> None:
        self.rows.balances = list(values)

    def build(self) -> list[ft.Control]:
        return [
            self.route,
            *(rows.control for rows in self.routes.values()),
            self.stake_box,
        ]

    def _stake_toggled(self, _e: AnyEvent) -> None:
        """Ticking the box changes who gets approved, so re-read that."""
        self.page.run_task(self.refresh)

    def _apply_route(self) -> None:
        """Show the live route's fields and hide the other's."""
        live = "underlying" if self.underlying else "pool"
        for name, rows in self.routes.items():
            rows.control.visible = name == live

    def _route_changed(self, _e: AnyEvent | None) -> None:
        self._apply_route()
        self.page.run_task(self.refresh)

    def _max_for(self, rows: _AmountRows, index: int) -> None:
        """Fill one coin's field with the whole wallet balance."""
        coin = rows.coins[index]
        rows.fields[index].value = format_units(
            rows.balances[index], coin.decimals, precision=coin.decimals
        )
        self.page.run_task(self.refresh)

    def clear_inputs(self) -> None:
        for rows in self.routes.values():
            rows.clear()

    def _amounts(self) -> list[int]:
        return self.rows.amounts()

    def _changed(self, _e: AnyEvent) -> None:
        self.page.run_task(self.refresh)

    def summary(self) -> str:
        rows = self.rows
        parts = [
            self.amount_label(coin.address, amount)
            for coin, amount in zip(rows.coins, rows.amounts())
            if amount > 0
        ]
        return " + ".join(parts)

    async def _quote(self, contract: PoolContract, amounts: list[int]) -> int:
        if self.underlying:
            return await contract.zap_calc_token_amount(amounts, deposit=True)
        return await contract.calc_token_amount(amounts, deposit=True)

    async def fee_units(self, contract: PoolContract) -> int:
        """A zap deposit passes through both pools, so it pays both fees."""
        fee = await contract.fee()
        if self.underlying:
            with contextlib.suppress(WalletError):
                fee += await contract.base_fee()
        return fee

    def fee_key(self) -> object:
        return self.route.value

    async def refresh(self) -> None:
        contract = self.get_contract()
        if not await self.network_ok(contract):
            self.page.update()
            return
        await self.suggest_slippage(contract)
        rows = self.rows
        if contract is not None and contract.can_send:
            for index, coin in enumerate(rows.coins):
                try:
                    rows.balances[index] = await contract.balance_of(coin.address)
                except WalletError:
                    rows.balances[index] = 0
                rows.labels[index].value = (
                    f"Balance: {format_units(rows.balances[index], coin.decimals)}"
                )

        amounts = rows.amounts()
        self._expected_lp = 0
        self._quote_ok = True
        impact: float | None = None
        if contract is not None and any(amounts):
            try:
                self._expected_lp = await self._quote(contract, amounts)
                floor = token_amount(
                    units_to_float(self.with_slippage(self._expected_lp), 18)
                )
                self.show_receipts([
                    (
                        pool_stack(self.pool, ESTIMATE_MARK, limit=4),
                        f"{token_amount(units_to_float(self._expected_lp, 18))} LP"
                        f"  (min {floor})",
                    )
                ])
            except WalletError as exc:
                self.show_estimate(str(exc), problem=True)
                self._quote_ok = False
            else:
                impact = await self.measure_impact(
                    contract, amounts, self._expected_lp
                )
        else:
            self.show_estimate("")
        self.show_impact(impact)

        await self._sync_approval(contract)
        await self.show_gas(contract)
        if contract is not None and (not any(amounts) or not self._quote_ok):
            self.submit_button.disabled = True
        self.page.update()

    async def approval_needed(self, contract: PoolContract) -> tuple[str, str, int] | None:
        # One coin at a time: each ERC-20 needs its own approval, and
        # the UI walks them in order rather than batching, so the
        # button always names a single concrete step.
        if not self._quote_ok:
            return None
        rows = self.rows
        for coin, amount in zip(rows.coins, rows.amounts()):
            if amount <= 0:
                continue
            allowance = await contract.allowance(coin.address, self.spender)
            if allowance < amount:
                self.approve_button.content = f"1. Approve {coin.symbol}"
                return (coin.address, self.spender, amount)
        return None

    @property
    def done_verb(self) -> str:
        return "Deposited and staked" if self.staking else "Deposited"

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        """The deposit as it would be sent, staking and route included."""
        amounts = self.rows.amounts()
        if not any(amounts) or not self._quote_ok or self._expected_lp <= 0:
            return None
        floor = self.with_slippage(self._expected_lp)
        if self.staking:
            return contract.build_deposit_and_stake(
                amounts, floor, underlying=self.underlying
            )
        if self.underlying:
            return contract.build_zap_add_liquidity(amounts, floor)
        return contract.build_add_liquidity(amounts, floor)

    async def submit(self, contract: PoolContract) -> str:
        amounts = self._amounts()
        if not any(amounts):
            raise WalletError("Enter an amount to deposit.")
        expected = await self._quote(contract, amounts)
        floor = self.with_slippage(expected)
        if self.combined:
            return await contract.deposit_and_stake(
                amounts, floor, underlying=self.underlying
            )

        before = await contract.lp_balance() if self.staking else 0
        tx = await (
            contract.zap_add_liquidity(amounts, floor)
            if self.underlying
            else contract.add_liquidity(amounts, floor)
        )
        if not self.staking:
            return tx
        await self._step(contract, tx, "Deposited.")
        minted = await contract.lp_balance() - before
        if minted <= 0:
            raise WalletError(
                "The deposit confirmed but no new LP tokens arrived, so there "
                "is nothing to stake. Check the Stake tab."
            )
        allowance = await contract.allowance(self.pool.lp_token, self.pool.gauge)
        if allowance < minted:
            approval = await contract.approve(
                self.pool.lp_token, self.pool.gauge, minted
            )
            await self._step(contract, approval, "Approved the gauge.")
        return await contract.stake(minted)


class WithdrawTab(ActionTab):
    """Remove liquidity, either balanced or all into one coin."""

    title = "Withdraw"
    submit_label = "Withdraw"
    #: One coin out of a pool is a trade against it in all but name --
    #: the same reasoning that gave the deposit side its measurement,
    #: run backwards.
    shows_impact = True
    # As on the deposit side: a property, because a withdrawal that had
    # to unstake first did two things and should say so.

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.lp_balance = 0
        self.staked = 0
        self.zap = zap_for(self.pool)
        self.use_staked = ft.Checkbox(
            label="Use staked",
            value=False,
            on_change=self._use_staked_toggled,
            visible=False,
            tooltip="Unstake what this withdrawal needs, then withdraw.",
        )
        self._use_staked_is_theirs = False
        self.amount = _amount_field(
            "LP tokens",
            self._changed,
            pool_stack(self.pool, 18, limit=4),
            on_max=self._max,
        )
        self.lp_label = ft.Text("", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT)
        self.route = _route_picker(
            self._route_changed, underlying=self.zap is not None
        )
        self.route.visible = self.zap is not None
        self.balanced_radio = ft.Radio(value="balanced", label="All coins")
        self.mode = ft.RadioGroup(
            value="balanced",
            content=ft.Row([self.balanced_radio, ft.Radio(value="one", label="One coin")]),
            on_change=self._changed,
        )
        self.coin_picker = ft.Dropdown(
            label="Receive",
            options=_coin_options(self.pool.pool_coins, self.pool.chain),
            value="0",
            dense=True,
            visible=False,
            leading_icon=token_mark(self.pool.pool_coins[0], self.pool.chain, 20)
            if self.pool.pool_coins
            else None,
            on_select=self._changed,
        )
        self._quote_ok = True
        self._expected_out = 0
        self._shares: list[int] | None = None
        self._apply_route()

    # -- which route is live ----------------------------------------------

    @property
    def underlying(self) -> bool:
        return self.zap is not None and self.route.value == "underlying"

    @property
    def coins(self) -> list:
        return self.pool.display_coins if self.underlying else self.pool.pool_coins

    def build(self) -> list[ft.Control]:
        return [
            _stacked(self.amount, self.lp_label),
            self.use_staked,
            self.route,
            self.mode,
            self.coin_picker,
        ]

    # -- where the LP comes from ------------------------------------------

    @property
    def drawing_on_gauge(self) -> bool:
        return bool(self.use_staked.value) and self.pool.has_any_gauge

    @property
    def spendable(self) -> int:
        """LP this withdrawal may use: the wallet's, plus the gauge's if asked."""
        return self.lp_balance + (self.staked if self.drawing_on_gauge else 0)

    def _to_unstake(self, amount: int) -> int:
        """How much has to come out of the gauge for `amount` to be spendable."""
        if not self.drawing_on_gauge:
            return 0
        return max(0, min(amount - self.lp_balance, self.staked))

    def _use_staked_toggled(self, _e: AnyEvent) -> None:
        self._use_staked_is_theirs = True
        self._changed(None)

    def _sync_use_staked(self) -> None:
        """Offer the box where it can do something, and pre-tick it once."""
        self.use_staked.visible = self.pool.has_any_gauge and self.staked > 0
        if not self.use_staked.visible:
            self.use_staked.value = False
            return
        if not self._use_staked_is_theirs:
            self.use_staked.value = self.lp_balance <= 0

    def _apply_route(self) -> None:
        """Swap the receive list, and force the single-coin mode on a zap."""
        self.coin_picker.options = _coin_options(self.coins, self.pool.chain)
        self.coin_picker.value = "0"
        self.balanced_radio.disabled = self.underlying
        self.balanced_radio.tooltip = (
            "A zap withdrawal goes into one coin at a time."
            if self.underlying
            else None
        )
        if self.underlying:
            self.mode.value = "one"
        self.coin_picker.visible = self.mode.value == "one"
        coins = self.coins
        if coins:
            self.coin_picker.leading_icon = token_mark(coins[0], self.pool.chain, 20)

    def _route_changed(self, _e: AnyEvent | None) -> None:
        self._apply_route()
        self._changed(None)

    def _max(self, _e: AnyEvent) -> None:
        self.amount.value = format_units(self.spendable, 18, precision=18)
        self.page.run_task(self.refresh)

    def _changed(self, _e: AnyEvent | None) -> None:
        self.coin_picker.visible = self.mode.value == "one"
        coins = self.coins
        index = self._coin_index()
        if 0 <= index < len(coins):
            self.coin_picker.leading_icon = token_mark(coins[index], self.pool.chain, 20)
        self.page.run_task(self.refresh)

    def clear_inputs(self) -> None:
        self.amount.value = ""

    def _lp_amount(self) -> int:
        text = (self.amount.value or "").strip()
        try:
            return parse_units(text, 18) if text else 0
        except ValueError:
            return 0

    def _coin_index(self) -> int:
        try:
            return int(self.coin_picker.value or "0")
        except ValueError:
            return 0

    def summary(self) -> str:
        amount = self._lp_amount()
        if amount <= 0:
            return ""
        label = self.amount_label(self.pool.lp_token, amount)
        if self.mode.value == "one":
            coins = self.coins
            index = self._coin_index()
            if index < len(coins):
                return f"{label} for {coins[index].symbol}"
        return label

    async def fee_units(self, contract: PoolContract) -> int:
        """A zap withdrawal comes back out through both pools."""
        fee = await contract.fee()
        if self.underlying:
            with contextlib.suppress(WalletError):
                fee += await contract.base_fee()
        return fee

    def fee_key(self) -> object:
        return self.route.value

    def prelude(self, contract: PoolContract) -> tuple[str, tuple[str, str]] | None:
        """The unstake a gauge-drawing withdrawal does first."""
        if self.drawing_on_gauge and self._lp_amount() > self.lp_balance:
            short = self._lp_amount() - self.lp_balance
            return "to unstake first", contract.build_unstake(short)
        return super().prelude(contract)

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        """The withdrawal as it would be sent, in whichever mode is live."""
        amount = self._lp_amount()
        if amount <= 0 or not self._quote_ok or amount > self.spendable:
            return None
        if self.mode.value == "one":
            index = self._coin_index()
            if self._expected_out <= 0:
                return None
            floor = self.with_slippage(self._expected_out)
            if self.underlying:
                return contract.build_zap_remove_liquidity_one_coin(
                    amount, index, floor
                )
            return contract.build_remove_liquidity_one_coin(amount, index, floor)
        if self._shares is None:
            return None
        floors = [0] * self.pool.n_coins
        for index, share in enumerate(self._shares[: self.pool.n_coins]):
            floors[index] = self.with_slippage(share) if share else 0
        return contract.build_remove_liquidity(amount, floors)

    async def balanced_shares(
        self, contract: PoolContract, amount: int
    ) -> list[int] | None:
        """What a balanced withdrawal of `amount` pays, coin by coin."""
        if amount <= 0:
            return None
        try:
            reserves = await contract.reserves(self.pool.n_coins)
            supply = await contract.lp_total_supply()
        except WalletError:
            return None
        if not reserves or supply <= 0:
            return None
        return [reserve * amount // supply for reserve in reserves]

    async def _quote(self, contract: PoolContract, amounts: list[int]) -> int:
        """What `[lp]` comes back as, in the coin that is selected."""
        index = self._coin_index()
        return await (
            contract.zap_calc_withdraw_one_coin(amounts[0], index)
            if self.underlying
            else contract.calc_withdraw_one_coin(amounts[0], index)
        )

    async def approval_needed(self, contract: PoolContract) -> tuple[str, str, int] | None:
        """LP tokens the zap has to be allowed to take."""
        if not self.underlying or self.zap is None or not self._quote_ok:
            return None
        amount = self._lp_amount()
        if amount <= 0:
            return None
        allowance = await contract.allowance(self.pool.lp_token, self.zap.address)
        if allowance >= amount:
            return None
        self.approve_button.content = "1. Approve LP"
        return (self.pool.lp_token, self.zap.address, amount)

    async def refresh(self) -> None:
        contract = self.get_contract()
        if not await self.network_ok(contract):
            self.page.update()
            return
        await self.suggest_slippage(contract)
        amount = self._lp_amount()
        if contract is not None and contract.can_send:
            try:
                self.lp_balance = await contract.lp_balance()
                self.staked = await contract.staked_balance()
                self.lp_label.value = (
                    f"Balance: {format_units(self.lp_balance, 18)} LP"
                    + (
                        f"  ·  Staked: {format_units(self.staked, 18)} LP"
                        if self.staked
                        else ""
                    )
                )
            except WalletError:
                self.lp_label.value = ""
        else:
            self.lp_balance = self.staked = 0
            self.lp_label.value = ""
        self._sync_use_staked()

        self.show_estimate("")
        self._quote_ok = True
        self._expected_out = 0
        self._shares = None
        impact = None
        if contract is not None and amount > 0 and self.mode.value == "one":
            index = self._coin_index()
            coins = self.coins
            coin = coins[index] if index < len(coins) else coins[0]
            try:
                out = await self._quote(contract, [amount])
                self._expected_out = out
                floor = token_amount(
                    units_to_float(self.with_slippage(out), coin.decimals)
                )
                self.show_receipts([
                    (
                        token_mark(coin, self.pool.chain, ESTIMATE_MARK),
                        f"{token_amount(units_to_float(out, coin.decimals))}"
                        f" {coin.symbol}  (min {floor})",
                    )
                ])
            except WalletError as exc:
                self.show_estimate(str(exc), problem=True)
                self._quote_ok = False
            else:
                impact = await self.measure_impact(contract, [amount], out)
        elif contract is not None and amount > 0:
            shares = await self.balanced_shares(contract, amount)
            self._shares = shares
            if shares is not None:
                self.show_receipts([
                    (
                        token_mark(coin, self.pool.chain, ESTIMATE_MARK),
                        f"{token_amount(units_to_float(share, coin.decimals))}"
                        f" {coin.symbol}",
                    )
                    for coin, share in zip(self.pool.pool_coins, shares, strict=False)
                ])
        self.show_impact(impact)

        over = (
            contract is not None and contract.can_send and amount > self.spendable
        )
        if over:
            self.show_estimate(
                f"Only {format_units(self.spendable, 18)} LP available"
                + (
                    "."
                    if self.drawing_on_gauge or not self.staked
                    else ", or more with “Use staked”."
                ),
                problem=True,
            )

        await self._sync_approval(contract)
        await self.show_gas(contract)
        if contract is None or amount <= 0 or not self._quote_ok or over:
            self.submit_button.disabled = True
        self.page.update()

    @property
    def done_verb(self) -> str:
        return "Unstaked and withdrew" if self._to_unstake(self._lp_amount()) else "Withdrew"

    async def submit(self, contract: PoolContract) -> str:
        amount = self._lp_amount()
        if amount <= 0:
            raise WalletError("Enter an amount to withdraw.")
        unstaking = self._to_unstake(amount)
        if unstaking > 0:
            tx = await contract.unstake(unstaking)
            await self._step(
                contract, tx, f"Unstaked {self.amount_label(self.pool.lp_token, unstaking)}."
            )
        if self.underlying:
            index = self._coin_index()
            expected = await contract.zap_calc_withdraw_one_coin(amount, index)
            return await contract.zap_remove_liquidity_one_coin(
                amount, index, self.with_slippage(expected)
            )
        if self.mode.value == "one":
            index = self._coin_index()
            expected = await contract.calc_withdraw_one_coin(amount, index)
            return await contract.remove_liquidity_one_coin(
                amount, index, self.with_slippage(expected)
            )
        shares = await self.balanced_shares(contract, amount)
        if shares is None:
            shares = []
            with contextlib.suppress(WalletError):
                supply = await contract.lp_total_supply()
                if supply > 0:
                    shares = [
                        int(coin.balance * 10**coin.decimals) * amount // supply
                        for coin in self.pool.pool_coins
                    ]
        min_amounts = [0] * self.pool.n_coins
        for index, share in enumerate(shares[: self.pool.n_coins]):
            min_amounts[index] = self.with_slippage(share) if share else 0
        return await contract.remove_liquidity(amount, min_amounts)


class SwapTab(ActionTab):
    """Exchange one coin for another inside this pool. No router."""

    title = "Swap"
    submit_label = "Swap"
    _done_verb = "Swapped"
    #: `get_dy` is exact -- the same maths the swap itself runs, fee
    #: included -- so there is no estimator error to give back.
    fee_multiple = SLIPPAGE_OF_FEE
    slippage_constant = 0.0
    shows_impact = True

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.balance = 0
        self._expected_out = 0
        self.underlying_spender = underlying_swap_spender(self.pool)
        self.route = _route_picker(
            self._route_changed, underlying=self.underlying_spender is not None
        )
        self.route.visible = self.underlying_spender is not None
        coins = self.coins
        self.from_coin = ft.Dropdown(
            label="From",
            options=_coin_options(coins, self.pool.chain),
            value="0",
            dense=True,
            expand=True,
            leading_icon=self._mark(0),
            on_select=self._from_selected,
        )
        to_index = 1 if self.pool.n_coins > 1 else 0
        self.to_coin = ft.Dropdown(
            label="To",
            options=_coin_options(coins, self.pool.chain),
            value=str(to_index),
            dense=True,
            expand=True,
            leading_icon=self._mark(to_index),
            on_select=self._to_selected,
        )
        self.flip_button = ft.IconButton(
            ft.Icons.SWAP_HORIZ,
            tooltip="Swap the two coins over",
            on_click=self._flip,
        )
        self.amount = _amount_field(
            "Amount", self._changed, self._mark(0), on_max=self._max
        )
        self.balance_label = ft.Text("", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT)

    @property
    def underlying(self) -> bool:
        return self.underlying_spender is not None and self.route.value == "underlying"

    @property
    def coins(self) -> list:
        return self.pool.display_coins if self.underlying else self.pool.pool_coins

    @property
    def spender(self) -> str:
        """Whoever moves the coin being sold on the live route."""
        if self.underlying and self.underlying_spender:
            return self.underlying_spender
        return self.pool.address

    def _route_changed(self, _e: AnyEvent | None) -> None:
        """Swap both coin lists, and start from the top of the new one."""
        options = _coin_options(self.coins, self.pool.chain)
        self.from_coin.options = options
        self.to_coin.options = _coin_options(self.coins, self.pool.chain)
        self.from_coin.value = "0"
        self.to_coin.value = self._other_index(0)
        self._changed(None)

    def build(self) -> list[ft.Control]:
        return [
            self.route,
            ft.Row(
                [self.from_coin, self.flip_button, self.to_coin],
                spacing=4,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            _stacked(self.amount, self.balance_label),
        ]

    def _indices(self) -> tuple[int, int]:
        try:
            return int(self.from_coin.value or "0"), int(self.to_coin.value or "1")
        except ValueError:
            return 0, 1

    def summary(self) -> str:
        i, j = self._indices()
        coins = self.coins
        dx = self._dx()
        if dx <= 0 or i >= len(coins) or j >= len(coins):
            return ""
        return f"{self.amount_label(coins[i].address, dx)} for {coins[j].symbol}"

    async def fee_units(self, contract: PoolContract) -> int:
        """StableSwap-NG charges per pair, so ask about *this* pair."""
        i, j = self._indices()
        if not self.underlying:
            return await contract.pair_fee(i, j)
        fee = await contract.fee()
        try:
            return fee + await contract.base_fee()
        except WalletError:
            return fee

    def fee_key(self) -> object:
        return (self.route.value, *self._indices())

    async def _quote(self, contract: PoolContract, amounts: list[int]) -> int:
        """`get_dy` on whichever route is live, for `[dx]`."""
        i, j = self._indices()
        return await (
            contract.get_dy_underlying(i, j, amounts[0])
            if self.underlying
            else contract.get_dy(i, j, amounts[0])
        )

    def clear_inputs(self) -> None:
        self.amount.value = ""

    def _dx(self) -> int:
        i, _ = self._indices()
        text = (self.amount.value or "").strip()
        try:
            return parse_units(text, self.coins[i].decimals) if text else 0
        except (ValueError, IndexError):
            return 0

    def _max(self, _e: AnyEvent) -> None:
        """Sell the whole balance of whichever coin is selected."""
        i, _ = self._indices()
        coin = self.coins[i]
        self.amount.value = format_units(
            self.balance, coin.decimals, precision=coin.decimals
        )
        self.page.run_task(self.refresh)

    def _mark(self, index: int, size: float = 20) -> ft.Control | None:
        """The mark for coin `index`, or None when there is no such coin."""
        coins = self.coins
        if not 0 <= index < len(coins):
            return None
        return token_mark(coins[index], self.pool.chain, size)

    def _other_index(self, taken: int) -> str:
        """Any coin but `taken`, for the side that has to give way."""
        for index in range(len(self.coins)):
            if index != taken:
                return str(index)
        return str(taken)

    def _from_selected(self, e: AnyEvent | None) -> None:
        """Picking the coin the other side already holds moves that side."""
        i, j = self._indices()
        if i == j:
            self.to_coin.value = self._other_index(i)
        self._changed(e)

    def _to_selected(self, e: AnyEvent | None) -> None:
        i, j = self._indices()
        if i == j:
            self.from_coin.value = self._other_index(j)
        self._changed(e)

    def _flip(self, e: AnyEvent | None) -> None:
        """Sell what you were buying. The amount stays as typed."""
        self.from_coin.value, self.to_coin.value = (
            self.to_coin.value,
            self.from_coin.value,
        )
        self._changed(e)

    def _changed(self, _e: AnyEvent | None) -> None:
        i, j = self._indices()
        self.from_coin.leading_icon = self._mark(i)
        self.to_coin.leading_icon = self._mark(j)
        self.amount.prefix_icon = self._mark(i)
        self.page.run_task(self.refresh)

    async def refresh(self) -> None:
        contract = self.get_contract()
        if not await self.network_ok(contract):
            self.page.update()
            return
        i, j = self._indices()
        await self.suggest_slippage(contract)
        dx = self._dx()

        if contract is not None and contract.can_send:
            try:
                self.balance = await contract.balance_of(self.coins[i].address)
                self.balance_label.value = (
                    f"Balance: {format_units(self.balance, self.coins[i].decimals)}"
                    f" {self.coins[i].symbol}"
                )
            except WalletError:
                self.balance_label.value = ""

        self._expected_out = 0
        self.show_estimate("")
        impact: float | None = None
        if i == j:
            self.show_estimate("Pick two different coins.")
        elif contract is not None and dx > 0:
            try:
                self._expected_out = await self._quote(contract, [dx])
                out_coin = self.coins[j]
                floor = token_amount(
                    units_to_float(
                        self.with_slippage(self._expected_out), out_coin.decimals
                    )
                )
                self.show_receipts([
                    (
                        token_mark(out_coin, self.pool.chain, ESTIMATE_MARK),
                        f"{token_amount(units_to_float(self._expected_out, out_coin.decimals))}"
                        f" {out_coin.symbol}  (min {floor})",
                    )
                ])
            except WalletError as exc:
                self.show_estimate(str(exc), problem=True)
            else:
                impact = await self.measure_impact(contract, [dx], self._expected_out)
        self.show_impact(impact)

        await self._sync_approval(contract)
        await self.show_gas(contract)
        if contract is not None and (dx <= 0 or i == j):
            self.submit_button.disabled = True
        self.page.update()

    async def approval_needed(self, contract: PoolContract) -> tuple[str, str, int] | None:
        i, _ = self._indices()
        dx = self._dx()
        if dx <= 0:
            return None
        coin = self.coins[i]
        spender = self.spender
        allowance = await contract.allowance(coin.address, spender)
        if allowance < dx:
            self.approve_button.content = f"1. Approve {coin.symbol}"
            return (coin.address, spender, dx)
        return None

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        """The swap as it would be sent, on whichever route is live."""
        i, j = self._indices()
        dx = self._dx()
        if dx <= 0 or i == j or self._expected_out <= 0:
            return None
        floor = self.with_slippage(self._expected_out)
        if self.underlying:
            return contract.build_exchange_underlying(i, j, dx, floor)
        return contract.build_exchange(i, j, dx, floor)

    async def submit(self, contract: PoolContract) -> str:
        i, j = self._indices()
        dx = self._dx()
        if i == j:
            raise WalletError("Pick two different coins.")
        if dx <= 0:
            raise WalletError("Enter an amount to swap.")
        floor = self.with_slippage(await self._quote(contract, [dx]))
        if self.underlying:
            return await contract.exchange_underlying(i, j, dx, floor)
        return await contract.exchange(i, j, dx, floor)


def claimable(amount: int, decimals: int) -> bool:
    """Is this enough to be worth a tab, a line and a transaction?"""
    return not is_dust(units_to_float(amount, decimals))


class ClaimTab(ActionTab):
    """What the gauge owes you, and the one or two transactions to get it."""

    title = "Claim"
    submit_label = "Claim"
    uses_slippage = False
    _done_verb = "Claimed"

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.crv_claimable = 0
        self.extras: list[tuple[str, str, int, int]] = []
        self._meta: dict[str, tuple[str, int]] = {}
        self.rows = ft.Column(spacing=10)
        self.campaign_note = ft.Container()
        self.empty_note = ft.Text(
            "Nothing to claim yet.", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT
        )
        self.read_error = ""

    @property
    def available(self) -> bool:
        """Anything worth claiming, of either kind? See `claimable`."""
        return claimable(self.crv_claimable, CRV_DECIMALS) or any(
            claimable(amount, decimals)
            for _address, _symbol, decimals, amount in self.extras
        )

    def build(self) -> list[ft.Control]:
        if not self.pool.has_any_gauge:
            return [
                ft.Text(
                    "This pool has no gauge, so it pays no rewards.",
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                )
            ]
        return [self.rows, self.campaign_note, self.empty_note]

    def _line(self, address: str, symbol: str, decimals: int, amount: int) -> ft.Control:
        """One reward: its mark, its symbol, and what is owed."""
        coin = Coin(address=address, symbol=symbol, decimals=decimals)
        return ft.Row(
            [
                token_mark(coin, self.pool.chain, 20),
                ft.Text(symbol, size=BODY, expand=True),
                ft.Text(
                    token_amount(units_to_float(amount, decimals)),
                    size=BODY,
                    weight=ft.FontWeight.W_500,
                ),
            ],
            spacing=10,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )

    def _render(self) -> None:
        lines: list[ft.Control] = []
        if claimable(self.crv_claimable, CRV_DECIMALS):
            lines.append(
                self._line(crv_token(self.pool), "CRV", CRV_DECIMALS, self.crv_claimable)
            )
        for address, symbol, decimals, amount in self.extras:
            if claimable(amount, decimals):
                lines.append(self._line(address, symbol, decimals, amount))
        self.rows.controls = lines
        self.campaign_note.content = self._campaign_note()
        self.show_estimate(self.read_error, problem=bool(self.read_error))
        self.empty_note.visible = not lines and not self.read_error

    def _campaign_note(self) -> ft.Control | None:
        """Say that the button below does not cover the Merkl side."""
        campaign = next(iter(self.pool.merkl.all), None)
        if campaign is None:
            return None
        return ft.Row(
            [
                ft.Text(
                    "Merkl campaign rewards are claimed on Merkl, not here.",
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                    expand=True,
                ),
                ft.IconButton(
                    ft.Icons.OPEN_IN_NEW,
                    icon_size=14,
                    tooltip="Open on Merkl",
                    url=ft.Url(campaign.url, target=ft.UrlTarget.BLANK),
                ),
            ],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=4,
        )

    async def _meta_for(self, contract: PoolContract, token: str) -> tuple[str, int]:
        key = token.lower()
        if key not in self._meta:
            self._meta[key] = await contract.token_meta(token)
        return self._meta[key]

    def summary(self) -> str:
        parts = []
        if claimable(self.crv_claimable, CRV_DECIMALS):
            parts.append(
                f"{token_amount(units_to_float(self.crv_claimable, CRV_DECIMALS))} CRV"
            )
        parts += [
            f"{token_amount(units_to_float(amount, decimals))} {symbol}"
            for _address, symbol, decimals, amount in self.extras
            if claimable(amount, decimals)
        ]
        return " + ".join(parts)

    async def refresh(self) -> None:
        contract = self.get_contract()
        if not self.pool.has_any_gauge:
            self.submit_button.visible = False
            self.approve_button.visible = False
            self.page.update()
            return
        if not await self.network_ok(contract):
            self.page.update()
            return

        if contract is not None and contract.can_send:
            self.read_error = ""
            try:
                self.crv_claimable = await contract.claimable_crv()
            except WalletError as exc:
                self.read_error = str(exc)
            try:
                extras: list[tuple[str, str, int, int]] = []
                for token in await contract.reward_tokens():
                    amount = await contract.claimable_reward(token)
                    symbol, decimals = await self._meta_for(contract, token)
                    extras.append((token, symbol, decimals, amount))
                self.extras = extras
            except WalletError as exc:
                self.read_error = self.read_error or str(exc)
        else:
            self.crv_claimable = 0
            self.extras = []
            self.read_error = ""

        self._render()
        self.approve_button.visible = False
        self.submit_button.disabled = (
            contract is None or not self.available or self._sending
        )
        await self.show_gas(contract)
        self.page.update()

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        """The first of the one or two transactions a claim comes to."""
        if claimable(self.crv_claimable, CRV_DECIMALS):
            return contract.build_claim_crv()
        if self.available:
            return contract.build_claim_rewards()
        return None

    async def submit(self, contract: PoolContract) -> str:
        # The same test the tab and its lines use, so the button
        # sends exactly what the panel showed -- see `claimable`.
        owed = self.crv_claimable
        crv = claimable(owed, CRV_DECIMALS)
        extras = any(
            claimable(amount, decimals)
            for _address, _symbol, decimals, amount in self.extras
        )
        if not crv and not extras:
            raise WalletError("Nothing to claim.")
        if crv and extras:
            tx = await contract.claim_crv()
            await self._step(
                contract,
                tx,
                f"Claimed {token_amount(units_to_float(owed, CRV_DECIMALS))} CRV.",
            )
            return await contract.claim_rewards()
        return await (contract.claim_crv() if crv else contract.claim_rewards())


class StakeTab(ActionTab):
    """Move LP tokens in and out of the pool's gauge."""

    title = "Stake"
    submit_label = "Stake"
    uses_slippage = False

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.lp_balance = 0
        self.staked = 0
        self.amount = _amount_field(
            "LP tokens",
            self._changed,
            pool_stack(self.pool, 18, limit=4),
            on_max=self._max,
        )
        self.balances_label = ft.Text("", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT)
        self.direction = ft.RadioGroup(
            value="stake",
            content=ft.Row(
                [
                    ft.Radio(value="stake", label="Stake"),
                    ft.Radio(value="unstake", label="Unstake"),
                ]
            ),
            on_change=self._changed,
        )

    @property
    def available(self) -> bool:
        """Is there LP to move, in either direction?"""
        return self.pool.has_any_gauge and (self.lp_balance > 0 or self.staked > 0)

    @property
    def done_verb(self) -> str:
        """Which way the gauge went. Not a constant, like the others are."""
        return "Unstaked" if self.direction.value == "unstake" else "Staked"

    def summary(self) -> str:
        amount = self._amount_units()
        return self.amount_label(self.pool.lp_token, amount) if amount > 0 else ""

    def build(self) -> list[ft.Control]:
        if not self.pool.has_any_gauge:
            return [
                ft.Text(
                    "This pool has no gauge, so there is nothing to stake.",
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                )
            ]
        if not self.pool.has_gauge:
            # Killed: nothing new goes in, and what is in there still has
            # to come out. So the panel is an unstake panel, and says why.
            self.direction.value = "unstake"
            self.submit_label = "Unstake"
            return [
                ft.Text(
                    "This pool's gauge is retired: it pays no more CRV and "
                    "takes no new stakes. Anything already staked can still "
                    "be taken out.",
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                ),
                _stacked(self.amount, self.balances_label),
            ]
        return [
            self.direction,
            _stacked(self.amount, self.balances_label),
        ]

    def _max(self, _e: AnyEvent) -> None:
        source = self.lp_balance if self.direction.value == "stake" else self.staked
        self.amount.value = format_units(source, 18, precision=18)
        self.page.run_task(self.refresh)

    def _changed(self, _e: AnyEvent) -> None:
        self.page.run_task(self.refresh)

    def clear_inputs(self) -> None:
        self.amount.value = ""

    def _amount_units(self) -> int:
        text = (self.amount.value or "").strip()
        try:
            return parse_units(text, 18) if text else 0
        except ValueError:
            return 0

    async def refresh(self) -> None:
        contract = self.get_contract()
        if not self.pool.has_any_gauge:
            self.submit_button.visible = False
            self.approve_button.visible = False
            self.page.update()
            return
        if not await self.network_ok(contract):
            self.page.update()
            return

        if contract is not None and contract.can_send:
            try:
                self.lp_balance = await contract.lp_balance()
                self.staked = await contract.staked_balance()
                self.balances_label.value = (
                    f"Wallet: {format_units(self.lp_balance, 18)} LP  ·  "
                    f"Staked: {format_units(self.staked, 18)} LP"
                )
            except WalletError:
                self.balances_label.value = ""
        else:
            self.lp_balance = self.staked = 0
            self.balances_label.value = ""

        staking = self.direction.value == "stake"
        self.submit_label = "Stake" if staking else "Unstake"
        self.submit_button.content = self.submit_label
        amount = self._amount_units()

        if staking:
            await self._sync_approval(contract)
        else:
            self.approve_button.visible = False
            self.submit_button.disabled = contract is None or self._sending
        if contract is not None and amount <= 0:
            self.submit_button.disabled = True
        await self.show_gas(contract)
        self.page.update()

    async def approval_needed(self, contract: PoolContract) -> tuple[str, str, int] | None:
        if self.direction.value != "stake":
            return None
        amount = self._amount_units()
        if amount <= 0:
            return None
        allowance = await contract.allowance(self.pool.lp_token, self.pool.gauge)
        if allowance < amount:
            self.approve_button.content = "1. Approve LP"
            return (self.pool.lp_token, self.pool.gauge, amount)
        return None

    def preview(self, contract: PoolContract) -> tuple[str, str] | None:
        amount = self._amount_units()
        if amount <= 0:
            return None
        staking = self.direction.value == "stake"
        return (
            contract.build_stake(amount)
            if staking
            else contract.build_unstake(amount)
        )

    async def submit(self, contract: PoolContract) -> str:
        amount = self._amount_units()
        if amount <= 0:
            raise WalletError("Enter an amount.")
        if self.direction.value == "stake":
            if not self.pool.has_gauge:
                raise WalletError("This pool's gauge is retired: it takes no stakes.")
            return await contract.stake(amount)
        return await contract.unstake(amount)
