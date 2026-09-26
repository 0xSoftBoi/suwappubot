"""The portfolio page: which pools this address is in, and for how much."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import flet as ft

from curve.earnings import ClaimPlan, Earning, claim_plan
from curve.format import compact_usd, is_dust, percent, short_address, token_amount
from curve.models import Coin
from curve.portfolio import LP_UNIT, Holding
from curve.rewards import REWARDS

from . import buttons, pool_list, safe_update, theme
from .logos import coin_stack
from .pool_list import reward_line
from .responsive import Layout
from .status import StatusPanel
from .typography import BODY, LABEL, METRIC, ROW_TITLE, SMALL

#: The same size the pool list draws its coin marks at, because this is the
#: same kind of row and they sit in the same column.
LOGO_SIZE = 27

#: Column widths, taken from the pool list rather than chosen again here.
W_WALLET = pool_list.W_TVL
W_STAKED = pool_list.W_TVL
W_APR = pool_list.W_REWARDS
W_REWARDS = pool_list.W_VOLUME
W_VALUE = pool_list.W_TVL

#: Every column, widest layout first, in the order they are drawn.
COLUMNS = ("wallet", "staked", "apr", "rewards", "value")

#: What survives between the card breakpoint and the compact one.
COMPACT_COLUMNS = ("staked", "apr", "rewards", "value")

#: Heading, and what to sort by. Descending always, like the pool list:
#: nobody opens a portfolio to find their smallest position.
SORTS: dict[str, tuple[str, Callable[[Holding, Earning | None], float]]] = {
    "wallet": ("In wallet", lambda h, _e: h.wallet),
    "staked": ("Staked", lambda h, _e: h.staked),
    "apr": ("Your APR", lambda _h, e: e.user_apr if e else -1.0),
    "rewards": ("Rewards", lambda _h, e: e.claimable_value if e else -1.0),
    "value": ("Value", lambda h, _e: h.value),
}

#: What the page opens on: what a position is worth, which is the order the
#: question is usually asked in.
DEFAULT_SORT = "value"

#: Sorts whose key comes from the earnings pass rather than from the scan.
EARNED_SORTS = ("apr", "rewards")

#: Below this a position is dust -- a wei or two left behind by a
#: withdrawal, which nearly every long-lived address has several of.
DUST_USD = 0.01


class HoldingRow(ft.Container):
    """One position. Click it to open the pool."""

    def __init__(
        self,
        holding: Holding,
        on_open: Callable[[Holding], None],
        index: int = 0,
        narrow: bool = False,
        earning: Earning | None = None,
        crv: str = "",
        columns: tuple[str, ...] = COLUMNS,
    ) -> None:
        self.holding = holding
        self._columns = columns
        self.earning = earning
        self._crv = crv
        quiet = holding.value < DUST_USD
        colour = ft.Colors.ON_SURFACE_VARIANT if quiet else None
        self._apr = ft.Column(
            self._apr_lines(colour),
            spacing=0,
            horizontal_alignment=ft.CrossAxisAlignment.END,
        )
        self._rewards = ft.Text(self._rewards_text(), size=BODY, color=colour,
                                text_align=ft.TextAlign.RIGHT)
        self._quiet_colour = colour
        super().__init__(
            content=self._card(holding, quiet) if narrow else self._row(holding, quiet),
            padding=ft.Padding.symmetric(horizontal=16, vertical=10),
            border=ft.Border(bottom=ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT)),
            on_click=lambda _e: on_open(holding),
            ink=True,
        )

    def _apr_lines(self, colour: str | None) -> list[ft.Control]:
        """The rates this account gets, one token per line, each marked."""
        if self.earning is None:
            return [_apr_text("\u2013", colour)]
        lines: list[ft.Control] = []
        crv = self.earning.user_crv_apr
        if crv > 0:
            lines.append(reward_line(percent(crv), self._crv, "CRV",
                                     self.holding.chain, muted=colour is not None))
        for incentive, rate in self.earning.user_incentives():
            lines.append(reward_line(percent(rate), incentive.token_address,
                                     incentive.symbol, self.holding.chain, muted=True))
        return lines or [_apr_text("\u2013", colour)]

    def _rewards_text(self) -> str:
        """What is waiting in the gauge, in dollars."""
        if self.earning is None:
            return "\u2013"
        value = self.earning.claimable_value
        if value <= 0:
            return "\u2013" if not self.earning.rewards else "< $0.01"
        return compact_usd(value)

    def apply(self, earning: Earning | None, crv: str = "") -> None:
        """Fill in the two columns on a row that is already drawn."""
        self.earning = earning
        self._crv = crv
        self._apr.controls = self._apr_lines(self._quiet_colour)
        self._rewards.value = self._rewards_text()

    def _name(self, holding: Holding) -> ft.Control:
        # Real token images, overlapped exactly as the pool list
        # overlaps them: `coin_stack` wants coins, which is why a
        # holding carries addresses and not only symbols.
        coins = [Coin(address, symbol, 18, index=n)
                 for n, (address, symbol) in enumerate(holding.coins)]
        return ft.Row(
            [
                coin_stack(coins, holding.chain, LOGO_SIZE),
                ft.Column(
                    [
                        ft.Text(holding.name or short_address(holding.address),
                                size=ROW_TITLE, weight=ft.FontWeight.W_500),
                        ft.Text(" ".join(holding.symbols), size=SMALL,
                                color=ft.Colors.ON_SURFACE_VARIANT),
                    ],
                    spacing=1,
                    expand=True,
                ),
            ],
            spacing=10,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            expand=True,
        )

    def _row(self, holding: Holding, quiet: bool) -> ft.Control:
        colour = ft.Colors.ON_SURFACE_VARIANT if quiet else None
        cells = {
            "wallet": lambda: _cell(_lp(holding.wallet), W_WALLET, colour),
            "staked": lambda: _cell(
                _lp(holding.staked) if holding.gauge else "-", W_STAKED, colour
            ),
            "apr": lambda: _wrap(self._apr, W_APR),
            "rewards": lambda: _wrap(self._rewards, W_REWARDS),
            "value": lambda: _cell(compact_usd(holding.value), W_VALUE, colour,
                                   weight=ft.FontWeight.W_500),
        }
        return ft.Row(
            [self._name(holding)] + [cells[key]() for key in self._columns],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )

    def _card(self, holding: Holding, quiet: bool) -> ft.Control:
        """Two lines instead of five columns, as the pool list does."""
        return ft.Column(
            [
                ft.Row(
                    [
                        self._name(holding),
                        ft.Text(compact_usd(holding.value), size=BODY,
                                weight=ft.FontWeight.W_500),
                    ],
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                ),
                ft.Row(
                    [
                        _metric("In wallet", _lp(holding.wallet)),
                        _metric("Staked", _lp(holding.staked)) if holding.gauge else ft.Container(),
                        _metric_control("APR", self._apr),
                        _metric_control("Rewards", self._rewards),
                    ],
                    spacing=14,
                    wrap=True,
                ),
            ],
            spacing=6,
        )


#: Below this an LP balance is shown as "< 0.0001" rather than rounded.
DUST_LP = 1e-4


def _lp(amount: int) -> str:
    """An LP balance, in whole tokens."""
    if not amount:
        return "0"
    whole = amount / LP_UNIT
    if 0 < whole < DUST_LP:
        return f"< {DUST_LP:g}"
    return token_amount(whole)


def _apr_text(value: str, colour: str | None) -> ft.Control:
    """The column with no rate to break down: an en dash, or nothing."""
    return ft.Text(value, size=BODY, color=colour, text_align=ft.TextAlign.RIGHT)


def _wrap(control: ft.Control, width: float) -> ft.Control:
    """A fixed-width, right-aligned cell around a control somebody kept."""
    return ft.Container(control, width=width, alignment=ft.Alignment.CENTER_RIGHT)


def _metric_control(label: str, control: ft.Control) -> ft.Control:
    return ft.Row(
        [ft.Text(label, size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT), control],
        spacing=4,
        tight=True,
    )


def _cell(value: str, width: float, colour: str | None, weight=None) -> ft.Control:
    return ft.Container(
        ft.Text(value, size=BODY, color=colour, weight=weight,
                text_align=ft.TextAlign.RIGHT),
        width=width,
        alignment=ft.Alignment.CENTER_RIGHT,
    )


def _metric(label: str, value: str) -> ft.Control:
    return ft.Row(
        [
            ft.Text(label, size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT),
            ft.Text(value, size=SMALL),
        ],
        spacing=4,
        tight=True,
    )


class PortfolioView(ft.Column):
    """The page. Owns its rows; the scan itself is the app's job."""

    def __init__(
        self,
        page: ft.Page,
        on_open: Callable[[Holding], None],
        narrow: bool = False,
        on_claim: Callable[[bool], Awaitable[None]] | None = None,
    ) -> None:
        self._page = page
        self._on_open = on_open
        self._narrow = narrow
        self._holdings: list[Holding] = []
        self._earnings: dict[str, Earning] = {}
        self._sort = DEFAULT_SORT
        self._columns: tuple[str, ...] = COMPACT_COLUMNS if narrow else COLUMNS
        self._plan = ClaimPlan()
        self._crv = ""
        self._on_claim = on_claim

        self.total = ft.Text("", size=METRIC, weight=ft.FontWeight.BOLD)

        self.claim_crv = buttons.Themed(
            "Claim CRV", page=page, on_click=lambda _e: self._claim(True),
            visible=False,
        )
        self.claim_rewards = buttons.Themed(
            "Claim rewards", page=page, on_click=lambda _e: self._claim(False),
            visible=False,
        )
        self.accrued_value = ft.Text("", size=BODY, weight=ft.FontWeight.BOLD)
        self.accrued_label = ft.Text(
            "", size=BODY, color=ft.Colors.ON_SURFACE_VARIANT
        )
        self.accrued = ft.Row(
            [self.accrued_label, self.accrued_value],
            spacing=6,
            tight=True,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        )
        self.status = StatusPanel(page)
        self.claim_status = self.status.text
        self._buttons = ft.Row(
            [
                buttons.shadowed(self.claim_crv, page),
                buttons.shadowed(self.claim_rewards, page),
            ],
            spacing=8,
            run_spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            wrap=True,
        )
        self._claim_bar = ft.Container(visible=False)
        self._lay_out_claim_bar()

        self.rows = ft.Column(spacing=0, key="holding-rows")
        self._header = self._build_header()
        self._rows_box = ft.Container(self.rows, theme=theme.rows_theme(page))
        self._table = ft.Container(
            ft.Column([self._header, self._rows_box], spacing=0),
            bgcolor=ft.Colors.SURFACE,
            border=theme.panel_border(page),
            border_radius=10,
            clip_behavior=ft.ClipBehavior.HARD_EDGE,
            shadow=theme.panel_shadow(page),
        )
        self.empty = ft.Container(
            ft.Text("", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT),
            padding=ft.Padding.symmetric(vertical=24, horizontal=16),
            visible=False,
        )

        super().__init__(
            controls=[
                ft.Row(
                    [
                        ft.Text("Portfolio", size=METRIC, weight=ft.FontWeight.BOLD,
                                expand=True),
                        ft.Text("Total value:", size=METRIC,
                                color=ft.Colors.ON_SURFACE_VARIANT),
                        self.total,
                    ],
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=8,
                ),
                self._claim_bar,
                self.status,
                self.empty,
                self._table,
            ],
            spacing=10,
        )

    # -- what the app calls ------------------------------------------------

    def show(self, holdings: list[Holding]) -> None:
        """Draw a set of positions, in the order the header asks for."""
        self._holdings = holdings
        self.rows.controls = [
            HoldingRow(
                holding, self._on_open, index, self._narrow,
                self._earnings.get(holding.address.lower()), self._crv,
                self._columns,
            )
            for index, holding in enumerate(self._in_order(holdings))
        ]
        self.total.value = compact_usd(sum(holding.value for holding in holdings))
        self._table.visible = bool(holdings)
        self.empty.visible = False
        safe_update(self)

    def _in_order(self, holdings: list[Holding]) -> list[Holding]:
        """Sorted by the active column, descending."""
        key = SORTS[self._sort][1]
        return sorted(
            holdings,
            key=lambda h: key(h, self._earnings.get(h.address.lower())),
            reverse=True,
        )

    def sort_by(self, key: str) -> None:
        """Order the table by a column. Same key again is not a reversal."""
        if key not in SORTS or key == self._sort:
            return
        self._sort = key
        self._sync_header()
        self.show(self._holdings)

    def _lay_out_claim_bar(self) -> None:
        """Buttons and label side by side, or stacked on a phone."""
        self._buttons.expand = not self._narrow
        self._claim_bar.content = (
            ft.Column([self._buttons, self.accrued], spacing=6)
            if self._narrow
            else ft.Row(
                [self._buttons, self.accrued],
                spacing=8,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            )
        )

    def forget_earnings(self) -> None:
        """Drop what the last read found, without redrawing."""
        self._earnings = {}
        self._plan = ClaimPlan()
        self._crv = ""
        self._claim_bar.visible = False
        self.status.say("")

    def _claim(self, crv: bool) -> None:
        """Hand the click to the app, as a task."""
        if self._on_claim is not None:
            self._page.run_task(self._on_claim, crv)

    def show_earnings(self, earnings: list[Earning], chain_id: int = 0) -> None:
        """Fill in the APR and rewards columns, and offer the claims."""
        was = self._earnings
        self._earnings = {e.pool.lower(): e for e in earnings}
        entry = REWARDS.get(chain_id)
        self._crv = entry.crv if entry else ""
        self._plan = claim_plan(chain_id, earnings)
        owed = sum(e.claimable_value for e in earnings)
        crv = bool(self._plan.crv)
        extras = bool(self._plan.extras)

        self.claim_crv.visible = crv
        self.claim_rewards.visible = extras
        self.claim_crv.content = self._crv_label(earnings, len(self._plan.crv))
        self.claim_rewards.content = self._rewards_label(earnings)
        self.accrued_label.value = "Unclaimed rewards:" if owed > 0 else (
            "Unclaimed rewards" if crv or extras else ""
        )
        self.accrued_value.value = compact_usd(owed) if owed > 0 else ""
        self._claim_bar.visible = crv or extras
        if self._sort in EARNED_SORTS and self._earnings != was:
            self.show(self._holdings)
            return
        for row in self.rows.controls:
            if isinstance(row, HoldingRow):
                row.apply(self._earnings.get(row.holding.address.lower()), self._crv)
        safe_update(self)

    @staticmethod
    def _crv_label(earnings: list[Earning], transactions: int = 1) -> str:
        """"Claim 1.23 CRV", and "(4 txs)" when it is not one transaction."""
        total = sum(e.crv_owed for e in earnings)
        label = ("Claim CRV" if is_dust(total)
                 else f"Claim {token_amount(total)} CRV")
        return label + (f" ({transactions} txs)" if transactions > 1 else "")

    @staticmethod
    def _rewards_label(earnings: list[Earning]) -> str:
        """"Claim rewards ($12.34)", or without the value if there is none."""
        value = sum(e.extras_value for e in earnings)
        return "Claim rewards" + (f" ({compact_usd(value)})" if value > 0 else "")

    def claiming(self, message: str, colour: str | None = None) -> None:
        """Say what a claim is doing, and stop it being pressed twice."""
        pending = bool(message) and colour is None
        self.claim_crv.disabled = pending
        self.claim_rewards.disabled = pending
        self.status.say(message, colour, pending=pending)
        safe_update(self)

    def say(self, message: str) -> None:
        """The page has nothing to show, and this is why."""
        self.rows.controls = []
        self.total.value = ""
        self._claim_bar.visible = False
        self._table.visible = False
        self.empty.content = ft.Text(message, size=SMALL,
                                     color=ft.Colors.ON_SURFACE_VARIANT)
        self.empty.visible = True
        safe_update(self)

    def set_layout(self, layout: Layout) -> None:
        """Adopt a new layout: which columns fit, and cards or a table."""
        columns = (
            () if layout.cards
            else COLUMNS if layout.name == "wide"
            else COMPACT_COLUMNS
        )
        if layout.cards == self._narrow and columns == self._columns:
            return
        self._narrow = layout.cards
        self._columns = columns or COLUMNS
        self._header.visible = not layout.cards
        self._sync_header()
        self._lay_out_claim_bar()
        self.show(self._holdings)

    def rebuild(self) -> None:
        """Take on a theme that changed -- see `ui.theme`."""
        self._table.shadow = theme.panel_shadow(self._page)
        self._table.border = theme.panel_border(self._page)
        self._header.bgcolor = theme.header_bg(self._page)
        self._rows_box.theme = theme.rows_theme(self._page)
        self.show(self._holdings)

    # -- header ------------------------------------------------------------

    def _build_header(self) -> ft.Container:
        """Column headings, each one a click target that re-sorts the table."""
        self._sort_cells = {
            key: ft.Container(
                width=width,
                alignment=ft.Alignment.CENTER_RIGHT,
                padding=ft.Padding.symmetric(horizontal=6, vertical=8),
                on_click=lambda _e, k=key: self.sort_by(k),
                ink=True,
                border_radius=6,
            )
            for key, width in (
                ("wallet", W_WALLET), ("staked", W_STAKED), ("apr", W_APR),
                ("rewards", W_REWARDS), ("value", W_VALUE),
            )
        }
        self._sync_header()
        return ft.Container(
            ft.Row(
                [
                    ft.Container(
                        ft.Text("Pool", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT),
                        expand=True,
                    ),
                    *(self._sort_cells[key] for key in COLUMNS),
                ],
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            padding=ft.Padding.symmetric(horizontal=16, vertical=2),
            border=ft.Border(bottom=ft.BorderSide(1, ft.Colors.OUTLINE)),
            bgcolor=theme.header_bg(self._page),
            visible=not self._narrow,
        )

    def _sync_header(self) -> None:
        """Mark the column being sorted on, and hide the ones not drawn."""
        for key, cell in self._sort_cells.items():
            cell.visible = key in self._columns
            active = key == self._sort
            label = ft.Text(
                SORTS[key][0],
                size=SMALL,
                weight=ft.FontWeight.BOLD if active else ft.FontWeight.NORMAL,
                color=ft.Colors.PRIMARY if active else ft.Colors.ON_SURFACE_VARIANT,
            )
            cell.content = ft.Row(
                [label] + (
                    [ft.Icon(ft.Icons.ARROW_DOWNWARD, size=BODY,
                             color=ft.Colors.PRIMARY)]
                    if active else []
                ),
                spacing=2,
                tight=True,
                alignment=ft.MainAxisAlignment.END,
            )
