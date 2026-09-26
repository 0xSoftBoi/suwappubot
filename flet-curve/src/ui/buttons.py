"""Buttons that belong to the theme they are drawn in."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import flet as ft

from . import theme

#: Corner radius under Chad. Material's own is half the button's height,
#: which is a pill; four is about what the rest of this theme's corners are
#: cut to, and enough that the shadow behind it does not show a square
#: poking out from under a rounded one.
RADIUS = 4


def _over(top: str, bottom: str, alpha: float) -> str:
    """`top` at `alpha`, composited on `bottom`. Hex in, hex out."""
    a = round(int(top[1:3], 16) * alpha + int(bottom[1:3], 16) * (1 - alpha))
    b = round(int(top[3:5], 16) * alpha + int(bottom[3:5], 16) * (1 - alpha))
    c = round(int(top[5:7], 16) * alpha + int(bottom[5:7], 16) * (1 - alpha))
    return f"#{a:02X}{b:02X}{c:02X}"


#: What a disabled button is made of, blended here rather than left to
#: Material -- and this is the one genuinely surprising thing in the file.
DISABLED_FILL = _over(theme.INK, theme.PANEL, 0.12)
DISABLED_TEXT = _over(theme.INK, DISABLED_FILL, 0.38)


def style(page: ft.Page) -> ft.ButtonStyle | None:
    """How a button is drawn under Chad. None -- Material's own -- elsewhere."""
    if not theme.is_chad(page):
        return None
    return ft.ButtonStyle(
        shape=ft.RoundedRectangleBorder(radius=RADIUS),
        side={
            ft.ControlState.DEFAULT: ft.BorderSide(1, ft.Colors.OUTLINE),
            ft.ControlState.DISABLED: ft.BorderSide(1, ft.Colors.OUTLINE_VARIANT),
        },
        elevation=0,
        bgcolor={
            ft.ControlState.DEFAULT: ft.Colors.SURFACE_CONTAINER_LOW,
            ft.ControlState.DISABLED: DISABLED_FILL,
        },
        color={
            ft.ControlState.DEFAULT: ft.Colors.PRIMARY,
            ft.ControlState.DISABLED: DISABLED_TEXT,
        },
    )


class Themed(ft.Button):
    """A button that takes the theme it is drawn in, not the one it was built in."""

    def __init__(self, *args, page: ft.Page, **kwargs) -> None:
        self._page = page
        super().__init__(*args, **kwargs)

    def before_update(self) -> None:
        super().before_update()
        self.style = style(self._page)


class Shadowed(ft.Container):
    """A hard shadow behind a button, and nothing else."""

    def __init__(
        self,
        button: ft.Control,
        page: ft.Page,
        when: Callable[[], bool] | None = None,
    ) -> None:
        self._page = page
        self._when = when
        super().__init__(
            button, border_radius=RADIUS, clip_behavior=ft.ClipBehavior.NONE
        )

    def before_update(self) -> None:
        super().before_update()
        showing = self.content is not None and self.content.visible
        self.visible = showing and (self._when is None or self._when())
        self.shadow = theme.panel_shadow(self._page, inset=True)


def shadowed(
    button: ft.Control, page: ft.Page, when: Callable[[], bool] | None = None
) -> ft.Control:
    """`button`, with room for Chad's shadow under it."""
    return Shadowed(button, page, when)


class StandIn(ft.IconButton):
    """The same action as `button`, with the label dropped."""

    def __init__(
        self, button: ft.Control, when: Callable[[], bool], **kwargs: Any
    ) -> None:
        self._button = button
        self._when = when
        super().__init__(**kwargs)

    def before_update(self) -> None:
        super().before_update()
        self.visible = bool(self._button.visible and self._when())
        self.disabled = bool(self._button.disabled)
        label = getattr(self._button, "content", None)
        if isinstance(label, str) and label:
            self.tooltip = label
