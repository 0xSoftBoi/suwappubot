"""What went through a pool, row by row: swaps, and liquidity moved."""

from __future__ import annotations

import flet as ft

from curve import explorers
from curve.api import LiquidityEvent, Trade
from curve.format import date_time, short_address, token_amount
from curve.models import Coin, Pool

from .logos import token_mark
from .typography import BODY, SMALL

#: A coin mark beside its amount.
MARK = 20

#: Deposits and withdrawals, told apart at a glance.
ADDED = ft.Colors.GREEN_600
TAKEN = ft.Colors.ERROR

ROW_PADDING = ft.Padding.symmetric(vertical=5, horizontal=6)

#: The columns that hold their width whatever is in them: one glyph, and a
#: date that is always the same length. A phone gets the tighter date, and
#: a fixed column for the short address -- there it has 13 characters to
#: hold and no use for a share of the row.
ARROW_WIDTH = 26
DATE_WIDTH = 100
DATE_NARROW_WIDTH = 88
SHORT_ADDRESS_WIDTH = 96

#: How the rest is shared. Weighted towards the address, which wants 42
#: characters where the coins want one amount: full on a wide window, and
#: elided by the client where the window is not.
COINS_FLEX = 4
ADDRESS_FLEX = 5

#: What an empty table says, per kind.
NO_TRADES = "No swaps through this pool yet."
NO_LIQUIDITY = "Nothing has been added or taken out yet."


def _cell(
    control: ft.Control, width: int | None = None, *, flex: int = 1, end: bool = False
) -> ft.Control:
    """One column of a row. As `_composition` builds its table."""
    return ft.Container(
        control,
        width=width,
        expand=flex if width is None else None,
        alignment=ft.Alignment.CENTER_RIGHT if end else ft.Alignment.CENTER_LEFT,
    )


def _linked(content: ft.Control, url: str) -> ft.Control:
    """A row, and the transaction behind it."""
    return ft.Container(
        content,
        padding=ROW_PADDING,
        border_radius=4,
        ink=bool(url),
        url=ft.Url(url, target=ft.UrlTarget.BLANK) if url else None,
        tooltip="Open the transaction" if url else None,
    )


def _amount(
    symbol: str, address: str, amount: float, chain: str, *, named: bool = True
) -> ft.Control:
    """A mark and what there was of it. The mark carries the symbol as its
    tooltip, so a narrow row can drop the word and keep the meaning.
    """
    coin = Coin(address=address, symbol=symbol, decimals=18)
    drawn = f"{token_amount(amount)} {symbol}" if named else token_amount(amount)
    return ft.Row(
        [
            token_mark(coin, chain, MARK),
            ft.Text(drawn, size=BODY, no_wrap=True),
        ],
        spacing=6,
        tight=True,
        vertical_alignment=ft.CrossAxisAlignment.CENTER,
    )


def _stamp(time: int) -> ft.Control:
    return ft.Text(
        date_time(time), size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT, no_wrap=True
    )


def _arrow() -> ft.Control:
    return ft.Icon(ft.Icons.ARROW_FORWARD, size=15, color=ft.Colors.ON_SURFACE_VARIANT)


def trade_row(
    trade: Trade,
    chain: str,
    chain_id: int,
    explorer: str = "",
    *,
    narrow: bool = False,
) -> ft.Control:
    """`100 DAI -> 99.99 USDC`, and when.

    Four columns where there is room, so that what was sold, what was
    bought and when line up down the table. On a phone the two sides share
    one wrapping column instead: they stay on one line while they fit and
    take a second when they do not.
    """
    sold = _amount(trade.sold, trade.sold_address, trade.sold_amount, chain,
                   named=not narrow)
    bought = _amount(trade.bought, trade.bought_address, trade.bought_amount, chain,
                     named=not narrow)
    columns = (
        [
            _cell(
                ft.Row(
                    [sold, _arrow(), bought],
                    spacing=8,
                    wrap=True,
                    run_spacing=4,
                    vertical_alignment=ft.CrossAxisAlignment.CENTER,
                )
            ),
            _cell(_stamp(trade.time), DATE_NARROW_WIDTH, end=True),
        ]
        if narrow
        else [
            _cell(sold),
            _cell(_arrow(), ARROW_WIDTH),
            _cell(bought),
            _cell(_stamp(trade.time), DATE_WIDTH, end=True),
        ]
    )
    return _linked(
        ft.Row(columns, spacing=8, vertical_alignment=ft.CrossAxisAlignment.CENTER),
        explorers.tx_url(chain_id, trade.tx, explorer),
    )


def moved_coins(event: LiquidityEvent, pool: Pool) -> list[tuple[Coin, float]]:
    """The coins this event actually moved. The API sends one amount per
    coin in the pool and zero for the rest, including for a one-sided
    withdrawal.
    """
    return [
        (coin, amount)
        for coin, amount in zip(pool.pool_coins, event.amounts, strict=False)
        if amount
    ]


def _provider(address: str, *, narrow: bool) -> ft.Control:
    """Who moved it: in full where the column is wide enough for all 42
    characters, and elided by the client where it is not. A phone has room
    for neither, so it gets the short form outright.
    """
    return ft.Text(
        short_address(address) if narrow else address,
        size=SMALL,
        font_family="monospace",
        color=ft.Colors.ON_SURFACE_VARIANT,
        no_wrap=True,
        max_lines=1,
        overflow=ft.TextOverflow.ELLIPSIS,
    )


def liquidity_row(
    event: LiquidityEvent, pool: Pool, explorer: str = "", *, narrow: bool = False
) -> ft.Control:
    """What was put in or taken out, by whom, and when. Three columns."""
    moved = moved_coins(event, pool)
    sign = ft.Text(
        "+" if event.added else "−",  # noqa: RUF001 -- a minus, not a hyphen
        size=BODY,
        weight=ft.FontWeight.W_600,
        color=ADDED if event.added else TAKEN,
    )
    amounts: list[ft.Control] = [
        _amount(coin.symbol, coin.address, amount, pool.chain, named=not narrow)
        for coin, amount in moved
    ] or [ft.Text("–", size=BODY, color=ft.Colors.OUTLINE)]  # noqa: RUF001
    # The sign belongs to the first amount, not to the run of them: on a
    # phone a wrapping row would leave it stranded on a line of its own
    # above the coin it applies to, which is what a deposit looked like.
    first, rest = amounts[0], amounts[1:]
    led = ft.Row(
        [sign, first],
        spacing=6,
        tight=True,
        vertical_alignment=ft.CrossAxisAlignment.CENTER,
    )
    return _linked(
        ft.Row(
            [
                _cell(
                    ft.Row(
                        [led, *rest],
                        spacing=8,
                        wrap=True,
                        run_spacing=4,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    flex=COINS_FLEX,
                ),
                _cell(
                    _provider(event.provider, narrow=narrow),
                    SHORT_ADDRESS_WIDTH if narrow else None,
                    flex=ADDRESS_FLEX,
                ),
                _cell(
                    _stamp(event.time),
                    DATE_NARROW_WIDTH if narrow else DATE_WIDTH,
                    end=True,
                ),
            ],
            spacing=8,
            vertical_alignment=ft.CrossAxisAlignment.CENTER,
        ),
        explorers.tx_url(pool.chain_id, event.tx, explorer),
    )


def empty(message: str) -> ft.Control:
    return ft.Container(
        ft.Text(message, size=SMALL, color=ft.Colors.ON_SURFACE_VARIANT),
        alignment=ft.Alignment.CENTER,
        padding=ft.Padding.symmetric(vertical=24),
    )
