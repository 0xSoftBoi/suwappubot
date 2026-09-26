"""One pool: its price history, what is in it, and what you can do to it."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from typing import Any

import flet as ft

from curve import explorers, parameters
from curve.api import (
    CANDLE_SIZES,
    DEFAULT_CANDLE_SIZE,
    ActivityFeed,
    CurveApi,
    LiquidityFeed,
    TradeFeed,
    get_candle_size,
)
from curve.format import (
    apr_range,
    compact_usd,
    percent,
    price,
    short_address,
    token_amount,
)
from curve.http import ApiError
from curve.merkl import MerklCampaign
from curve.models import Coin, Pool
from curve.pool import PoolContract
from wallet.base import WalletError

from . import AnyEvent, activity, safe_update, theme
from .actions import ClaimTab, DepositTab, StakeTab, SwapTab, WithdrawTab
from .candles import CandleChart
from .logos import OVERLAP, coin_stack, pool_stack, token_mark
from .pool_list import POINTS_ICON
from .responsive import Layout, layout_for
from .typography import BODY, LABEL, METRIC, SMALL, TITLE, TITLE_NARROW

#: What the fold says while it is reading. Not "Reading them from the
#: pool...", which is what it said and which has no antecedent: the fold's
#: title is above it and out of the reader's eye by the time the words
#: appear, so "them" is a pronoun for nothing.
READING = "Reading pool parameters…"

#: How long the whole batch gets before the panel gives up on it.
PARAMETER_DEADLINE = 45.0

LP_SERIES = "__lp__"

#: What the LP series is called. The currency is worth saying where there
#: is room for it and is the first thing to go where there is not: a phone
#: has 200px for the picker, marks and arrow included.
LP_LABEL = "LP token (USD)"
LP_LABEL_NARROW = "LP token"

#: The two picker entries that put a table where the chart is, and the
#: rule that separates them from the price series above.
TRADES_SERIES = "__trades__"
LIQUIDITY_SERIES = "__liquidity__"

#: What names each of the two in the menu, where every other row carries
#: coin marks: swapped arrows for the trades, a drop for the liquidity.
ACTIVITY_MARKS = {
    TRADES_SERIES: ft.Icons.SWAP_HORIZ,
    LIQUIDITY_SERIES: ft.Icons.WATER_DROP,
}
ACTIVITY_SERIES = (TRADES_SERIES, LIQUIDITY_SERIES)
SERIES_RULE = "__rule__"

#: The chart's height, which the tables take over unchanged so the page
#: does not jump when the picker moves between them.
CHART_HEIGHT = 340

#: How near the end of a table brings the page behind it in: two thirds of
#: the box, so the rows are there by the time the scroll reaches them.
ACTIVITY_SCROLL_THRESHOLD = 220

#: How large a mark is in the series menu, beside what it names.
SERIES_MARK = 18

#: A pair's two overlapping marks are wider than one glyph, and Material
#: starts a row's label after whatever its leading control is. So the two
#: tables' glyphs are boxed to a pair's width, or their names would sit
#: left of every price row's. `logos.OVERLAP` is how much of each mark the
#: next one covers, which is what makes two of them 1.66 marks wide.
SERIES_MARK_BOX = SERIES_MARK * (2 - OVERLAP)

#: And on the closed field, where it is larger and boxed. Material drops a
#: leading icon into a slot meant for one 24px glyph: a stack left raw
#: there rides the top-left corner and touches the frame. A box wider and
#: taller than the widest stack centres it instead, and holds the label
#: still while the selection moves between two coins and three.
FIELD_MARK = 22
FIELD_BOX = (56, 28)

#: How wide the picker is: the longest name plus the box beside it. A
#: phone gets the narrower one, or the candle size beside it goes off the
#: edge -- a 330px screen has room for both and nothing to spare.
SERIES_WIDTH = 270
SERIES_NARROW_WIDTH = 200


def _metric(label: str, value: str) -> ft.Control:
    """A caption and its figure, side by side. As `ui.portfolio` draws them."""
    return ft.Row(
        [
            ft.Text(label, size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT),
            ft.Text(value, size=SMALL),
        ],
        spacing=4,
        tight=True,
    )


#: The parameter list is indented under its heading, not against the chart's
#: left edge, so the fold reads as one block.
PARAMETER_PADDING = ft.Padding.only(left=6, bottom=4)


def _expanded(event: AnyEvent) -> bool:
    """Did an `ExpansionTile` just open, from its `on_change` event."""
    data = event.data
    return data if isinstance(data, bool) else str(data).strip().lower() == "true"

class PoolDetailView(ft.Column):
    """The detail page. Owns its own data loading."""

    def __init__(
        self,
        page: ft.Page,
        api: CurveApi,
        pool: Pool,
        get_contract: Callable[[], PoolContract | None],
        on_back: Callable[[], None],
        explorer: str = "",
    ) -> None:
        # `ft.Column` exposes `page` as a read-only property, so the
        # reference kept for `run_task`/`update` needs a name of its
        # own.
        self._page = page
        self.api = api
        self.pool = pool
        self.get_contract = get_contract
        self._explorer = explorer

        self._layout = layout_for(2000.0)

        self.chart = CandleChart(
            height=CHART_HEIGHT, on_capacity_change=self._chart_resized
        )
        self.activity = ft.Column(
            spacing=0,
            scroll=ft.ScrollMode.AUTO,
            on_scroll=self._activity_scrolled,
            scroll_interval=200,
        )
        #: What the table has read so far, kept so a change of width can
        #: draw it again without asking for it again.
        self._activity_rows: list = []
        self._activity_kind = ""
        #: One cursor per table, kept so that going to the chart and back
        #: -- or between the two tables -- does not lose the history that
        #: was scrolled up.
        self._activity_feeds: dict[str, ActivityFeed] = {}
        #: Last in the table, and what says the older rows are coming.
        self.activity_footer = ft.Container(
            ft.Row(
                [ft.ProgressRing(width=16, height=16), ft.Text("Loading…", size=SMALL)],
                alignment=ft.MainAxisAlignment.CENTER,
                spacing=10,
            ),
            padding=12,
            visible=False,
        )
        self.activity_box = ft.Container(
            self.activity, height=CHART_HEIGHT, visible=False
        )
        self.chart_caption = ft.Text(
            "", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT, visible=False
        )
        self.chart_error = ft.Text("", size=LABEL, color=ft.Colors.ERROR)
        self._candle_size = DEFAULT_CANDLE_SIZE

        self.series = ft.Dropdown(
            options=self._series_options(),
            value=LP_SERIES,
            leading_icon=self._field_mark(LP_SERIES),
            dense=True,
            # Room for the marks as well as the longest name: the box on
            # the left is 56 of it.
            width=SERIES_WIDTH,
            on_select=self._series_changed,
        )
        self._composition_slot = ft.Container(
            ft.Text("Loading pool details…", size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT)
        )
        self._composition_ready = False
        self._yields_slot = ft.Container(self._yields())
        self._campaigns_slot = ft.Container(self._campaigns())
        self._parameter_rows = ft.Column(spacing=2)
        self._parameters_open = False
        self._parameters_asked = False
        self._parameters_slot = ft.Container(self._parameters())

        self.size_picker = ft.Dropdown(
            key="candle-size",
            options=[
                ft.DropdownOption(key=size.label, text=size.label)
                for size in CANDLE_SIZES
            ],
            value=self._candle_size,
            width=110,
            dense=True,
            on_select=self._size_changed,
        )

        chart_block: list[ft.Control] = (
            [
                ft.Container(
                    ft.Text(
                        "No price history: Curve Lite chains have no trade "
                        "indexing behind them.",
                        size=SMALL,
                        color=ft.Colors.ON_SURFACE_VARIANT,
                    ),
                    padding=ft.Padding.symmetric(vertical=10),
                )
            ]
            if pool.lite
            else [
                ft.Row(
                    [self.series, ft.Container(expand=True), self.size_picker],
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                ),
                self.chart_caption,
                self.chart,
                self.activity_box,
                self.chart_error,
            ]
        )
        self._left = ft.Column(
            [
                *chart_block,
                self._composition_slot,
                self._yields_slot,
                self._campaigns_slot,
                self._parameters_slot,
            ],
            spacing=10,
        )
        self._right = ft.Container(self._actions())
        self._body = ft.Container()

        self._on_back = on_back
        self._header_slot = ft.Container(self._header())

        super().__init__(
            controls=[self._header_slot, self._body],
            spacing=14,
        )
        self._arrange()

    # -- layout -----------------------------------------------------------

    def set_layout(self, layout: Layout) -> None:
        was = self._layout
        self._layout = layout
        if layout.cards != was.cards:
            self.series.width = SERIES_NARROW_WIDTH if layout.cards else SERIES_WIDTH
            self.series.options = self._series_options()
            self._parameters_slot.content = self._parameters()
            self._header_slot.content = self._header()
            if self._composition_ready:
                self._composition_slot.content = self._composition()
            if self._activity_kind:
                self._draw_activity()
        if layout.stacked == was.stacked:
            safe_update(self)
            return
        self._arrange()
        safe_update(self)

    def _arrange(self) -> None:
        """Chart beside the actions, or above them when there is no room."""
        self.scroll = None
        self._left.scroll = None
        self._left.expand = False
        self._body.expand = False
        if self._layout.stacked:
            self._right.expand = False
            self._body.content = ft.Column(
                [self._left, self._right], spacing=16, tight=True
            )
        else:
            self._right.expand = 1
            self._body.content = ft.Row(
                [ft.Container(self._left, expand=2), self._right],
                vertical_alignment=ft.CrossAxisAlignment.START,
                spacing=20,
            )

    # -- header -----------------------------------------------------------

    def _header(self) -> ft.Control:
        """Back, marks, name and the two figures -- on one line or three."""
        title = ft.Column(
            [
                ft.Text(
                    self.pool.display_name,
                    size=TITLE if not self._layout.cards else TITLE_NARROW,
                    weight=ft.FontWeight.BOLD,
                ),
                ft.Text(
                    " / ".join(self.pool.coin_symbols),
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                ),
            ],
            spacing=0,
            expand=True,
        )
        back = ft.IconButton(ft.Icons.ARROW_BACK, on_click=lambda _e: self._on_back())
        stats = [self._stat(label, value) for label, value in self._stat_pairs()]
        if not self._layout.cards:
            return ft.Row(
                [back, pool_stack(self.pool, size=38), title, *stats],
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
                spacing=18,
            )
        return ft.Column(
            [
                ft.Row(
                    [back, pool_stack(self.pool, size=32), title],
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    spacing=10,
                ),
                ft.Row(stats, spacing=24, wrap=True),
            ],
            spacing=8,
        )

    def _stat_pairs(self) -> list[tuple[str, str]]:
        pairs = [("TVL", compact_usd(self.pool.tvl))]
        if not self.pool.lite:
            pairs.append(("24h volume", compact_usd(self.pool.volume_24h)))
        return pairs

    def _stat(self, label: str, value: str) -> ft.Control:
        # Right-aligned at the end of a wide row, left-aligned when
        # they have their own line under the name.
        end = not self._layout.cards
        return ft.Column(
            [
                ft.Text(label, size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT),
                ft.Text(value, size=METRIC, weight=ft.FontWeight.W_500),
            ],
            spacing=0,
            horizontal_alignment=(
                ft.CrossAxisAlignment.END if end else ft.CrossAxisAlignment.START
            ),
        )

    # -- left column ------------------------------------------------------

    def _composition(self) -> ft.Control:
        """What is in the pool, as plain Rows rather than a `DataTable`."""
        total = sum(c.balance_usd for c in self.pool.pool_coins) or 1.0

        def cell(control: ft.Control, width: int | None = None, end: bool = False) -> ft.Control:
            return ft.Container(
                control,
                width=width,
                expand=width is None,
                alignment=ft.Alignment.CENTER_RIGHT if end else ft.Alignment.CENTER_LEFT,
            )

        header = ft.Container(
            ft.Row(
                [
                    cell(ft.Text("Asset", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT)),
                    cell(ft.Text("Price", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT), 110, True),
                    cell(ft.Text("Share", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT), 80, True),
                    cell(ft.Text("Balance", size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT), 150, True),
                ]
            ),
            padding=ft.Padding.only(bottom=4),
            border=ft.Border(bottom=ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT)),
        )

        rows: list[ft.Control] = [] if self._layout.cards else [header]
        for coin in self.pool.pool_coins:
            if self._layout.cards:
                rows.append(self._composition_card(coin, total))
                continue
            rows.append(
                ft.Container(
                    ft.Row(
                        [
                            cell(
                                ft.Row(
                                    [
                                        token_mark(coin, self.pool.chain, 26),
                                        ft.Column(
                                            [
                                                ft.Text(coin.symbol, size=BODY),
                                                ft.Text(
                                                    short_address(coin.address),
                                                    size=LABEL,
                                                    color=ft.Colors.ON_SURFACE_VARIANT,
                                                ),
                                            ],
                                            spacing=0,
                                        ),
                                    ],
                                    spacing=8,
                                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                                )
                            ),
                            cell(ft.Text(price(coin.usd_price), size=BODY), 110, True),
                            cell(
                                ft.Text(
                                    f"{coin.balance_usd / total * 100:.2f}%", size=BODY
                                ),
                                80,
                                True,
                            ),
                            cell(
                                ft.Column(
                                    [
                                        ft.Text(token_amount(coin.balance), size=BODY),
                                        ft.Text(
                                            compact_usd(coin.balance_usd),
                                            size=LABEL,
                                            color=ft.Colors.ON_SURFACE_VARIANT,
                                        ),
                                    ],
                                    spacing=0,
                                    horizontal_alignment=ft.CrossAxisAlignment.END,
                                ),
                                150,
                                True,
                            ),
                        ],
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    padding=ft.Padding.symmetric(vertical=6),
                )
            )

        return ft.Column(
            [ft.Text("COMPOSITION", size=LABEL, weight=ft.FontWeight.BOLD), *rows],
            spacing=2,
        )

    def _composition_card(self, coin, total: float) -> ft.Control:
        """One asset on two lines instead of four columns."""
        return ft.Container(
            ft.Column(
                [
                    ft.Row(
                        [
                            token_mark(coin, self.pool.chain, 26),
                            ft.Column(
                                [
                                    ft.Text(coin.symbol, size=BODY),
                                    ft.Text(
                                        short_address(coin.address),
                                        size=LABEL,
                                        color=ft.Colors.ON_SURFACE_VARIANT,
                                    ),
                                ],
                                spacing=0,
                                expand=True,
                            ),
                            ft.Column(
                                [
                                    ft.Text(token_amount(coin.balance), size=BODY),
                                    ft.Text(
                                        compact_usd(coin.balance_usd),
                                        size=LABEL,
                                        color=ft.Colors.ON_SURFACE_VARIANT,
                                    ),
                                ],
                                spacing=0,
                                horizontal_alignment=ft.CrossAxisAlignment.END,
                            ),
                        ],
                        spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    ft.Row(
                        [
                            _metric("Price", price(coin.usd_price)),
                            _metric(
                                "Share", f"{coin.balance_usd / total * 100:.2f}%"
                            ),
                        ],
                        spacing=16,
                        wrap=True,
                    ),
                ],
                spacing=4,
            ),
            padding=ft.Padding.symmetric(vertical=8),
            border=ft.Border(bottom=ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT)),
        )

    def _yields(self) -> ft.Control:
        # Base vAPY is fees earned, which needs somebody counting
        # trades.
        lines: list[ft.Control] = (
            []
            if self.pool.lite
            else [self._yield_row("Base vAPY", percent(self.pool.base_apr))]
        )
        if self.pool.crv_apr[1] > 0:
            lines.append(self._yield_row("CRV (min to max boost)", apr_range(*self.pool.crv_apr)))
        for incentive in self.pool.incentives:
            lines.append(self._yield_row(f"{incentive.symbol} incentives", percent(incentive.apr)))
        lines += self._merkl_rows()
        if len(lines) > 1:
            lines.append(
                self._yield_row(
                    "Total (max boost)", percent(self.pool.total_apr), bold=True
                )
            )
        elif not lines:
            lines.append(
                ft.Text(
                    "Rewards are not measured on this chain.",
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                )
            )

        return ft.Column(
            [ft.Text("YIELD", size=LABEL, weight=ft.FontWeight.BOLD), *lines],
            spacing=4,
        )

    def _merkl_rows(self) -> list[ft.Control]:
        """What Merkl pays, with the two sides of a campaign named."""
        rows: list[ft.Control] = []
        for token in self.pool.merkl.tokens:
            for qualifier, apr in self.pool.merkl.sides_for(token):
                label = f"{token.paid_symbol} via Merkl"
                rows.append(
                    self._yield_row(
                        f"{label} ({qualifier})" if qualifier else label, percent(apr)
                    )
                )
        if not self.pool.merkl and self.pool.merkle_apr > 0:
            rows.append(self._yield_row("Merkle campaign", percent(self.pool.merkle_apr)))
        return rows

    # -- campaigns --------------------------------------------------------

    def _campaigns(self) -> ft.Control:
        """Where to go for the rewards this app cannot hand over."""
        rows: list[ft.Control] = []
        for campaign in self.pool.merkl.all:
            token = next(iter(campaign.tokens), None)
            rows.append(
                self._campaign_row(
                    mark=(
                        ft.Icon(POINTS_ICON, size=20, color=ft.Colors.ON_SURFACE_VARIANT)
                        if token is None or token.points
                        else token_mark(
                            Coin(
                                address=token.paid_address,
                                symbol=token.paid_symbol,
                                decimals=18,
                            ),
                            self.pool.chain,
                            20,
                        )
                    ),
                    title=campaign.name or "Merkl campaign",
                    detail=self._campaign_detail(campaign),
                    url=campaign.url,
                    link="Open on Merkl",
                )
            )
        for external in self.pool.points:
            rows.append(
                self._campaign_row(
                    mark=ft.Icon(POINTS_ICON, size=20, color=ft.Colors.ON_SURFACE_VARIANT),
                    title=external.label,
                    detail=external.describe(),
                    url=external.dashboard,
                    link=f"Open {external.platform}",
                )
            )
        if not rows:
            return ft.Container()
        return ft.Column(
            [
                ft.Text("CAMPAIGNS", size=LABEL, weight=ft.FontWeight.BOLD),
                ft.Text(
                    "Paid outside the gauge. Merkl rewards are claimed on "
                    "Merkl; points are counted by whoever is giving them.",
                    size=LABEL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                ),
                *rows,
            ],
            spacing=4,
        )

    def _campaign_detail(self, campaign: MerklCampaign) -> str:
        """The second line of a Merkl row: what it pays, and how fast."""
        tokens = ", ".join(token.paid_symbol for token in campaign.tokens) or "rewards"
        wrapped = [t for t in campaign.tokens if t.wrapped]
        via = (
            " (paid as "
            + ", ".join(t.symbol for t in wrapped)
            + " on Merkl, unwrapped when you claim)"
            if wrapped
            else ""
        )
        if campaign.points_only:
            return f"{tokens}, which carry no price and so no rate{via}"
        return f"{tokens} at {percent(campaign.apr)}{via}"

    def _campaign_row(
        self, *, mark: ft.Control, title: str, detail: str, url: str, link: str
    ) -> ft.Control:
        """One campaign: what it is, and the way out to it."""
        return ft.Row(
            [
                mark,
                ft.Column(
                    [
                        ft.Text(title, size=SMALL),
                        ft.Text(
                            detail, size=LABEL, color=ft.Colors.ON_SURFACE_VARIANT
                        ),
                    ],
                    spacing=0,
                    expand=True,
                ),
                ft.IconButton(
                    ft.Icons.OPEN_IN_NEW,
                    icon_size=14,
                    tooltip=link,
                    url=ft.Url(url, target=ft.UrlTarget.BLANK) if url else None,
                    disabled=not url,
                ),
            ],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=8,
        )

    # -- parameters -------------------------------------------------------

    def _parameters(self) -> ft.Control:
        """The addresses and the curve's own numbers, folded away."""
        rows: list[ft.Control] = [
            self._address_row("Pool", self.pool.address),
        ]
        if self.pool.has_any_gauge:
            label = "Gauge" if self.pool.has_gauge else "Gauge (retired)"
            rows.append(self._address_row(label, self.pool.any_gauge))
        rows.append(self._parameter_rows)
        return ft.ExpansionTile(
            title=ft.Text("Pool parameters", size=LABEL, weight=ft.FontWeight.BOLD),
            controls=[ft.Container(ft.Column(rows, spacing=6), padding=PARAMETER_PADDING)],
            tile_padding=ft.Padding.symmetric(horizontal=0),
            controls_padding=ft.Padding.only(bottom=6),
            dense=True,
            min_tile_height=34,
            expanded=self._parameters_open,
            on_change=self._parameters_toggled,
        )

    def _parameters_toggled(self, event: ft.Event[ft.ExpansionTile]) -> None:
        """Read the pool the first time somebody opens the fold."""
        self._parameters_open = _expanded(event)
        if self._parameters_open and not self._parameters_asked:
            self._parameters_asked = True
            self._parameter_rows.controls = [self._unread(READING)]
            safe_update(self._parameter_rows)
            self._page.run_task(self.load_parameters)

    def _address_row(self, label: str, address: str) -> ft.Control:
        """An address, in full where there is room, with a copy and a link."""
        shown = short_address(address) if self._layout.cards else address
        url = explorers.address_url(self.pool.chain_id, address, self._explorer)
        return ft.Row(
            [
                ft.Text(label, size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT, width=54),
                ft.Text(
                    shown,
                    size=SMALL,
                    font_family="monospace",
                    selectable=True,
                    expand=True,
                ),
                ft.IconButton(
                    ft.Icons.COPY_ALL_OUTLINED,
                    icon_size=14,
                    tooltip="Copy address",
                    on_click=lambda _e, value=address: self._copy(value),
                ),
                ft.IconButton(
                    ft.Icons.OPEN_IN_NEW,
                    icon_size=14,
                    tooltip="Open in the explorer",
                    url=ft.Url(url, target=ft.UrlTarget.BLANK) if url else None,
                ),
            ],
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=4,
        )

    def _copy(self, value: str) -> None:
        self._page.run_task(self._copy_now, value)

    async def _copy_now(self, value: str) -> None:
        with contextlib.suppress(Exception):
            await ft.Clipboard().set(value)

    async def load_parameters(self) -> None:
        """Ask the pool what shape it is."""
        contract = self.get_contract()
        if contract is None:
            self._unreadable("Connect a wallet to read them.")
            return
        try:
            readings = await asyncio.wait_for(contract.parameters(), PARAMETER_DEADLINE)
        except TimeoutError:
            self._unreadable("The chain did not answer in time. Try again.")
            return
        except WalletError as exc:
            self._unreadable(str(exc))
            return
        except Exception as exc:
            self._unreadable(f"They could not be read: {exc}")
            return
        coins = [(coin.symbol, coin.decimals) for coin in self.pool.pool_coins]
        shown = parameters.rows(readings.values) + parameters.rate_rows(readings.rates, coins)
        self._parameter_rows.controls = [
            self._parameter_row(parameter, value) for parameter, value in shown
        ] or [self._unread("This pool answered none of them.")]
        safe_update(self._parameter_rows)

    def _unreadable(self, why: str) -> None:
        """Say why, and let the next open try again."""
        self._parameters_asked = False
        self._parameter_rows.controls = [self._unread(why)]
        safe_update(self._parameter_rows)

    def _parameter_row(self, parameter: parameters.Parameter, shown: str) -> ft.Control:
        return ft.Row(
            [
                ft.Text(
                    parameter.label,
                    size=SMALL,
                    color=ft.Colors.ON_SURFACE_VARIANT,
                    tooltip=parameter.note,
                    expand=True,
                ),
                ft.Text(shown, size=SMALL, selectable=True),
            ]
        )

    def _unread(self, why: str) -> ft.Control:
        return ft.Text(why, size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT)

    def _yield_row(self, label: str, value: str, *, bold: bool = False) -> ft.Control:
        weight = ft.FontWeight.BOLD if bold else ft.FontWeight.NORMAL
        return ft.Row(
            [
                ft.Text(label, size=SMALL, weight=weight, expand=True),
                ft.Text(value, size=SMALL, weight=weight),
            ]
        )

    # -- right column -----------------------------------------------------

    def _actions(self) -> ft.Control:
        """The four panels, with a tab bar built by hand."""
        self.tabs = [
            DepositTab(self._page, self.pool, self.get_contract, self.refresh_actions),
            WithdrawTab(self._page, self.pool, self.get_contract, self.refresh_actions),
            SwapTab(self._page, self.pool, self.get_contract, self.refresh_actions),
            StakeTab(self._page, self.pool, self.get_contract, self.refresh_actions),
            ClaimTab(self._page, self.pool, self.get_contract, self.refresh_actions),
        ]
        self._tab = 0
        self._tab_bar = ft.Container(
            border=ft.Border(bottom=ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT))
        )
        self._tab_body = ft.Container(padding=14)
        self._sync_tabs()
        return ft.Container(
            ft.Column([self._tab_bar, self._tab_body], spacing=0),
            bgcolor=ft.Colors.SURFACE,
            border=ft.Border.all(1, ft.Colors.OUTLINE_VARIANT),
            border_radius=10,
            clip_behavior=ft.ClipBehavior.HARD_EDGE,
            shadow=theme.panel_shadow(self._page),
        )

    def _sync_tabs(self) -> None:
        """Draw the bar for the tab that is showing, and its panel."""
        shown = [(index, tab) for index, tab in enumerate(self.tabs) if tab.available]
        if not any(index == self._tab for index, _tab in shown):
            self._tab = shown[0][0] if shown else 0
        self._tab_bar.content = ft.Row(
            [self._tab_label(index, tab.title) for index, tab in shown],
            spacing=0,
            wrap=True,
        )
        self._tab_body.content = self.tabs[self._tab].mount()

    def _tab_label(self, index: int, title: str) -> ft.Control:
        here = index == self._tab
        return ft.Container(
            ft.Text(
                title,
                size=BODY,
                color=ft.Colors.PRIMARY if here else ft.Colors.ON_SURFACE_VARIANT,
                weight=ft.FontWeight.W_500 if here else None,
            ),
            padding=ft.Padding.symmetric(horizontal=14, vertical=12),
            border=ft.Border(bottom=ft.BorderSide(2, ft.Colors.PRIMARY)) if here else None,
            on_click=lambda _e, chosen=index: self._show_tab(chosen),
            ink=True,
        )

    def _show_tab(self, index: int) -> None:
        if index == self._tab:
            return
        self._tab = index
        self._sync_tabs()
        safe_update(self._tab_bar)
        safe_update(self._tab_body)

    async def refresh_actions(self) -> None:
        """Re-read every panel, then redraw the bar in case it changed."""
        for tab in self.tabs:
            await tab.refresh()
        before = self._tab
        self._sync_tabs()
        safe_update(self._tab_bar)
        if self._tab != before:
            safe_update(self._tab_body)

    # -- chart ------------------------------------------------------------

    def _series_mark(self, key: str, size: float = SERIES_MARK) -> ft.Control | None:
        """What names a series: the pool's own stack for the LP token, the
        two coins for a pair, and a glyph for each of the two tables.

        Built fresh each time -- a control belongs to one place in the
        tree, and this is drawn in the menu and again on the closed field.
        """
        if key == LP_SERIES:
            return pool_stack(self.pool, size=size, limit=3)
        if glyph := ACTIVITY_MARKS.get(key):
            return ft.Icon(glyph, size=size, color=ft.Colors.ON_SURFACE_VARIANT)
        coins = self.pool.pool_coins
        i, _, j = key.partition(":")
        if not j.isdigit() or not i.isdigit():
            return None
        if int(i) >= len(coins) or int(j) >= len(coins):
            return None
        return coin_stack([coins[int(i)], coins[int(j)]], self.pool.chain, size)

    def _menu_mark(self, key: str) -> ft.Control | None:
        """The same mark in the menu, where a glyph is boxed to a pair's
        width so its name starts where the price rows' names do.
        """
        mark = self._series_mark(key)
        if key not in ACTIVITY_MARKS or mark is None:
            return mark
        return ft.Container(
            mark, width=SERIES_MARK_BOX, alignment=ft.Alignment.CENTER_LEFT
        )

    def _field_mark(self, key: str) -> ft.Control | None:
        """The same marks on the closed field, boxed so they sit in it
        rather than on its corner. See `FIELD_BOX`.
        """
        mark = self._series_mark(key, FIELD_MARK)
        if mark is None:
            return None
        width, height = FIELD_BOX
        return ft.Container(
            mark, width=width, height=height, alignment=ft.Alignment.CENTER
        )

    def _series_options(self) -> list[ft.DropdownOption]:
        options = [
            ft.DropdownOption(
                key=LP_SERIES,
                text=LP_LABEL_NARROW if self._layout.cards else LP_LABEL,
                leading_icon=self._series_mark(LP_SERIES),
            )
        ]
        for i, main in enumerate(self.pool.pool_coins):
            for j, reference in enumerate(self.pool.pool_coins):
                if i == j:
                    continue
                options.append(
                    ft.DropdownOption(
                        key=f"{i}:{j}",
                        text=f"{main.symbol} / {reference.symbol}",
                        leading_icon=self._series_mark(f"{i}:{j}"),
                    )
                )
        # Under a rule, because these two are not a third way of drawing the
        # price: they replace the chart with what actually went through.
        options.append(
            ft.DropdownOption(key=SERIES_RULE, content=ft.Divider(height=1), disabled=True)
        )
        for key, text in ((TRADES_SERIES, "Trades"), (LIQUIDITY_SERIES, "Liquidity")):
            options.append(
                ft.DropdownOption(
                    key=key, text=text, leading_icon=self._menu_mark(key)
                )
            )
        return options

    @property
    def selection(self) -> str:
        """What the picker names right now."""
        return self.series.value or LP_SERIES

    def _series_changed(self, _e: AnyEvent) -> None:
        self.series.leading_icon = self._field_mark(self.selection)
        safe_update(self.series)
        self._page.run_task(self.load_selection)

    async def load_selection(self) -> None:
        """Draw whatever the picker names: a price series, or a table."""
        if self.selection in ACTIVITY_SERIES:
            await self.load_activity()
        else:
            await self.load_chart()

    def _show_activity(self, showing: bool) -> None:
        """Hand the chart's space to the table, or take it back. The candle
        size goes with the chart: a table has no candles to size.
        """
        self.activity_box.visible = showing
        self.chart.visible = not showing
        self.size_picker.visible = not showing

    def _chart_resized(self) -> None:
        """The chart got materially wider or narrower -- refetch to suit."""
        if self.selection in ACTIVITY_SERIES:
            return  # it is not on screen; its width means nothing
        self._page.run_task(self.load_chart)

    def _size_changed(self, _e: AnyEvent) -> None:
        self._candle_size = self.size_picker.value or DEFAULT_CANDLE_SIZE
        self._page.run_task(self.load_chart)

    async def load_chart(self) -> None:
        if self.pool.lite:
            return  # nothing to ask; the panel says so instead
        size = get_candle_size(self._candle_size)
        count = self.chart.candle_capacity()
        self._show_activity(False)
        self.chart_error.value = ""
        self._say_chart("Loading…")
        self._page.update()

        try:
            value = self.series.value or LP_SERIES
            if value == LP_SERIES:
                candles = await self.api.lp_candles(
                    self.pool.chain, self.pool.address, size=size, count=count
                )
            else:
                i, j = (int(x) for x in value.split(":"))
                candles = await self.api.pair_candles(
                    self.pool.chain,
                    self.pool.address,
                    base=self.pool.pool_coins[i].address,
                    quote=self.pool.pool_coins[j].address,
                    size=size,
                    count=count,
                )
        except ApiError as exc:
            self.chart.set_candles([])
            self._say_chart("")
            self.chart_error.value = str(exc)
            self._page.update()
            return

        self.chart.set_candles(candles)
        self._say_chart("")
        self._page.update()

    def _activity_feed(self, kind: str) -> ActivityFeed:
        """The cursor for one of the two tables, opened the first time it
        is asked for and kept afterwards.
        """
        feed = self._activity_feeds.get(kind)
        if feed is None:
            feed = (
                TradeFeed(
                    self.api,
                    self.pool.chain,
                    self.pool.address,
                    [coin.address for coin in self.pool.pool_coins],
                )
                if kind == TRADES_SERIES
                else LiquidityFeed(self.api, self.pool.chain, self.pool.address)
            )
            self._activity_feeds[kind] = feed
        return feed

    async def load_activity(self) -> None:
        """Fill the table where the chart was: swaps, or liquidity moved.

        The picker is read once, at the top: every await here is a place
        somebody can pick something else, and a table that lands after
        that would draw over whatever they chose instead.
        """
        wanted = self.selection
        self._show_activity(True)
        self.chart_error.value = ""
        feed = self._activity_feed(wanted)

        if feed.rows:  # read once already; put it back rather than ask again
            self._activity_kind = wanted
            self._activity_rows = list(feed.rows)
            self._draw_activity()
            self._say_chart("")
            self._page.update()
            return

        self.activity.controls = []
        self._say_chart("Loading…")
        self._page.update()
        if feed.loading:
            return  # the read already in flight will draw it

        try:
            await feed.load_more()
        except ApiError as exc:
            if self.selection == wanted:
                self._say_chart("")
                self.chart_error.value = str(exc)
                self._page.update()
            return

        if self.selection != wanted:
            return
        self._activity_kind = wanted
        self._activity_rows = list(feed.rows)
        self._draw_activity()
        self._say_chart("")
        self._page.update()

    def _activity_scrolled(self, e: ft.OnScrollEvent) -> None:
        """Pull the older rows in as the end of the table comes into view."""
        feed = self._activity_feeds.get(self._activity_kind)
        if feed is None or feed.loading or feed.exhausted:
            return
        if e.max_scroll_extent - e.pixels > ACTIVITY_SCROLL_THRESHOLD:
            return
        self._page.run_task(self._load_more_activity)

    async def _load_more_activity(self) -> None:
        """Read the page behind the table and add it underneath.

        Only what came back is drawn: rebuilding the whole table would
        cost the scroll position the reader is holding.
        """
        kind = self._activity_kind
        feed = self._activity_feeds.get(kind)
        if feed is None or feed.loading or feed.exhausted:
            return
        had = len(self._activity_rows)
        self.activity_footer.visible = True
        safe_update(self.activity_footer)

        try:
            fresh = await feed.load_more()
        except ApiError as exc:
            if self._activity_kind == kind:
                self.activity_footer.visible = False
                self.chart_error.value = str(exc)
                self._page.update()
            return

        if self._activity_kind != kind:
            return  # the picker moved while we waited
        self._activity_rows = list(feed.rows)
        self.activity_footer.visible = False
        if not had:
            self._draw_activity()  # the table was showing its empty line
        else:
            # The footer keeps its place at the end of the table.
            self.activity.controls[-1:] = [
                *(self._activity_row(row) for row in fresh),
                self.activity_footer,
            ]
        safe_update(self.activity)

    def _activity_row(self, row: Any) -> ft.Control:
        """One line of whichever table is up, at the width there is."""
        narrow = self._layout.cards
        if self._activity_kind == TRADES_SERIES:
            return activity.trade_row(
                row, self.pool.chain, self.pool.chain_id, self._explorer, narrow=narrow
            )
        return activity.liquidity_row(row, self.pool, self._explorer, narrow=narrow)

    def _draw_activity(self) -> None:
        """Build the table out of what was read, for the width there is.

        Kept apart from the fetch so that turning a phone sideways redraws
        the rows -- one column narrower, and the coin names back -- without
        asking the API again.
        """
        rows = [self._activity_row(row) for row in self._activity_rows]
        nothing = (
            activity.NO_TRADES
            if self._activity_kind == TRADES_SERIES
            else activity.NO_LIQUIDITY
        )
        self.activity.controls = [
            *(rows or [activity.empty(nothing)]),
            self.activity_footer,
        ]

    def _say_chart(self, message: str) -> None:
        """The line above the chart, which carries the wait and nothing else.

        It used to read the last price, its change over the window and how
        many candles were drawn. None of that is worth a line above a chart
        that shows the first two and is the third, and the chart draws its
        own "no price history" in the middle of the empty plot.
        """
        self.chart_caption.value = message
        self.chart_caption.visible = bool(message)

    async def _load_campaigns(self) -> None:
        """Re-run the campaign lookup now that the LP token is known."""
        await self.api.attach_campaigns(
            self.pool.chain_id, self.pool.chain, [self.pool]
        )
        self._campaigns_slot.content = self._campaigns()

    async def _load_detail(self) -> None:
        """Fetch the fields only the detail endpoint has, then redraw."""
        if self.pool.detailed:
            await self._load_campaigns()
            self._composition_slot.content = self._composition()
            self._composition_ready = True
            self._yields_slot.content = self._yields()
            return
        try:
            raw = await self.api.pool_detail(self.pool.chain_id, self.pool.address)
        except ApiError as exc:
            self._composition_slot.content = ft.Text(
                f"Could not load pool details: {exc}", size=SMALL, color=ft.Colors.ERROR
            )
            self._page.update()
            return
        self.pool.merge_detail(raw)
        await self._load_campaigns()
        self._composition_slot.content = self._composition()
        self._composition_ready = True
        self._yields_slot.content = self._yields()
        self._right.content = self._actions()
        self.series.options = self._series_options()
        if self.selection not in ACTIVITY_SERIES:
            self.series.value = LP_SERIES
        self.series.leading_icon = self._field_mark(self.selection)
        self._page.update()

    async def load(self) -> None:
        # Detail first: the action panels read the LP token it supplies.
        await self._load_detail()
        await self.load_selection()
        await self.refresh_actions()
        # Not the parameters: those wait for somebody to open the
        # fold.
