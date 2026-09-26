"""Token and chain marks, including the overlapping stack Curve uses."""

from __future__ import annotations

import flet as ft

from curve.models import Coin, Pool

from .assets import MARK_PIXELS, bundled_chain, bundled_mark, chain_logo, token_logo

#: How a logo gets from 200-280px of source art down to the 22-34px it is
#: drawn at.
SAMPLING = ft.FilterQuality.MEDIUM

#: Never set `cache_width` here: on Flet 0.86 web it renders the image as
#: nothing at all, and on WebKit it put a pale rim around every mark.

#: How many device pixels the platform draws per logical one, which is what
#: turns a mark's drawn size into the tier to ask for.
_pixel_ratio = [2.0]


def set_pixel_ratio(ratio: float | None) -> None:
    """Tell the marks how many device pixels a logical one is worth."""
    if ratio and ratio > 0:
        _pixel_ratio[0] = float(ratio)


#: The size a mark is drawn at in the pool list, and so the size the bundle
#: tier is chosen for.
MARK_SIZE = 27


def pixel_ratio() -> float:
    """What the platform last said, or the standing guess."""
    return _pixel_ratio[0]


#: How much of each logo the next one covers.
OVERLAP = 0.34

#: Colours for the lettered fallback. Picked per symbol so a token looks the
#: same everywhere it appears, and from the Material palette so both themes
#: stay legible.
_FALLBACK_COLORS = (
    ft.Colors.BLUE_400,
    ft.Colors.TEAL_400,
    ft.Colors.PURPLE_300,
    ft.Colors.ORANGE_400,
    ft.Colors.PINK_300,
    ft.Colors.INDIGO_300,
    ft.Colors.CYAN_400,
    ft.Colors.AMBER_400,
)


def fallback_color(symbol: str) -> str:
    """A stable colour for a symbol, so the same token always matches."""
    if not symbol:
        return _FALLBACK_COLORS[0]
    return _FALLBACK_COLORS[sum(symbol.encode()) % len(_FALLBACK_COLORS)]


def initials_mark(symbol: str, size: float) -> ft.Container:
    """What stands in for a logo there is no image for."""
    accent = fallback_color(symbol)
    return ft.Container(
        ft.Text(
            (symbol or "?")[:3].upper(),
            size=size * 0.32,
            weight=ft.FontWeight.W_600,
            color=ft.Colors.ON_SURFACE_VARIANT,
            text_align=ft.TextAlign.CENTER,
            no_wrap=True,
        ),
        width=size,
        height=size,
        bgcolor=ft.Colors.with_opacity(0.18, accent),
        border=ft.Border.all(1, ft.Colors.with_opacity(0.45, accent)),
        border_radius=size,
        alignment=ft.Alignment.CENTER,
    )


#: How many times a mark is asked for before it settles for its fallback.
MARK_ATTEMPTS = 2


def _attempt_src(source: str, attempt: int) -> str:
    """The URL for one attempt. Attempt 0 is the file's own address."""
    return source if attempt == 0 else f"{source}?retry={attempt}"


def _mark_image(
    source: str, size: float, fallback: ft.Control, fit: ft.BoxFit
) -> ft.Control:
    """A mark, with each retry nested in the previous attempt's failure slot."""
    content = fallback
    for attempt in reversed(range(MARK_ATTEMPTS)):
        content = ft.Image(
            src=_attempt_src(source, attempt),
            width=size,
            height=size,
            fit=fit,
            filter_quality=SAMPLING,
            error_content=content,
        )
    return content


def token_mark(coin: Coin, chain: str, size: float = 24) -> ft.Container:
    """One coin's logo, or its initials when there is no image."""
    wanted = size * pixel_ratio()
    letters = initials_mark(coin.symbol, size)
    content: ft.Control

    if packed := bundled_mark(chain, coin.address, wanted):
        content = ft.Image(
            src=packed,
            width=size,
            height=size,
            fit=ft.BoxFit.COVER,
            filter_quality=SAMPLING,
            error_content=letters,
        )
    elif source := token_logo(chain, coin.address, wanted):
        content = _mark_image(source, size, letters, ft.BoxFit.COVER)
    else:
        content = letters

    return ft.Container(
        content,
        width=size,
        height=size,
        border_radius=size / 2,
        alignment=ft.Alignment.CENTER,
        clip_behavior=ft.ClipBehavior.ANTI_ALIAS,
        tooltip=coin.symbol,
    )


def coin_stack(
    coins: list[Coin], chain: str, size: float = 24, limit: int = 5
) -> ft.Control:
    """Overlapping logos for a pool's assets, as Curve draws them."""
    shown = coins[:limit]
    if not shown:
        return ft.Container(width=0, height=size)

    step = size * (1 - OVERLAP)
    marks: list[ft.Control] = []
    for index, coin in enumerate(shown):
        mark = token_mark(coin, chain, size)
        mark.left = index * step
        mark.top = 0
        marks.append(mark)

    extra = len(coins) - len(shown)
    if extra > 0:
        marks.append(
            ft.Container(
                ft.Text(
                    f"+{extra}", size=size * 0.34, color=ft.Colors.ON_SURFACE_VARIANT
                ),
                left=len(shown) * step,
                top=0,
                width=size,
                height=size,
                bgcolor=ft.Colors.SURFACE_CONTAINER_HIGHEST,
                border_radius=size / 2,
                alignment=ft.Alignment.CENTER,
            )
        )

    slots = len(shown) + (1 if extra > 0 else 0)
    return ft.Container(
        ft.Stack(list(reversed(marks)), width=step * (slots - 1) + size, height=size),
        width=step * (slots - 1) + size,
        height=size,
    )


def pool_stack(pool: Pool, size: float = 24, limit: int = 5) -> ft.Control:
    """The stack for a pool, decomposing a metapool into its underlying."""
    return coin_stack(pool.display_coins, pool.chain, size, limit)


def chain_mark(
    chain: str, size: float = 18, *, sized_by_parent: bool = False
) -> ft.Control | None:
    """A network's logo, or None when there is no image for it."""
    wanted = MARK_PIXELS if sized_by_parent else size * pixel_ratio()
    if packed := bundled_chain(chain, wanted):
        return ft.Image(
            src=packed,
            width=size,
            height=size,
            fit=ft.BoxFit.CONTAIN,
            filter_quality=SAMPLING,
        )
    source = chain_logo(chain, wanted)
    if not source:
        return None
    return _mark_image(source, size, ft.Container(width=size, height=size), ft.BoxFit.CONTAIN)
