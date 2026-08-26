"""The band that flashes when a number is worth stopping at.

One implementation, because two tabs make the same judgement about the same
figure: a price impact past `IMPACT_HIGH` on the pool page's swap, and past
`IMPACT_HIGH_BP` on the router's.  Copying the pulse into the second one gave
the two different timings the moment either was tuned, which is exactly what
someone comparing the two tabs would notice.

The band is tinted at rest by the theme and flashes with the theme's error
colour, so it is red under Material and Chad's scarlet under Chad rather than
one hardcoded red fighting both.
"""

from __future__ import annotations

import asyncio
import contextlib

import flet as ft

from . import theme

#: How long one flash lasts, and how many there are before it settles.  Long
#: enough to read the number between flashes, few enough to stop being a
#: distraction once it has been read.
ALARM_INTERVAL = 0.5
ALARM_PULSES = 5

#: The two tints it alternates between, as opacities of the theme's error
#: colour.
ALARM_LIT = 0.28
ALARM_DIM = 0.07


class Band(ft.Container):
    """One line of annotation, in the theme's colour for its kind."""

    def __init__(self, content: ft.Control, page: ft.Page, *,
                 kind: str = "", visible: bool = True,
                 padding: ft.Padding | None = None) -> None:
        self._page = page
        self.kind = kind
        self.alarming = False
        super().__init__(
            content,
            # Its own by default, because on the pool page it is a paragraph
            # of its own under the estimate.  In a list of figures it is one
            # row among five and has to keep their rhythm, so the caller can
            # say -- an untinted band is how the others match it.
            padding=padding or ft.Padding.symmetric(horizontal=8, vertical=6),
            border_radius=6,
            visible=visible,
            animate=ft.Animation(
                int(ALARM_INTERVAL * 800), ft.AnimationCurve.EASE_IN_OUT
            ),
        )

    def before_update(self) -> None:
        super().before_update()
        if not self.alarming:
            self.bgcolor = theme.note_tint(self._page, self.kind)


class Alarm:
    """Whichever band is worth flashing, or none.

    Held by the tab rather than by the band, because only one thing should be
    flashing at a time and the tab is what knows which.
    """

    def __init__(self, page: ft.Page) -> None:
        self._page = page
        self._panel: Band | None = None
        self._run = 0

    @property
    def panel(self) -> Band | None:
        """Which band is flashing, if any."""
        return self._panel

    def point_at(self, panel: Band | None) -> None:
        """Start the pulse on `panel`, or stop whatever is pulsing."""
        if panel is self._panel:
            return
        if self._panel is not None:
            self._panel.alarming = False
            self._panel.bgcolor = theme.note_tint(self._page, self._panel.kind)
        self._panel = panel
        # Bumped whether or not a new pulse starts, so the one in flight sees
        # that it is answering for a band nobody is looking at any more.
        self._run += 1
        if panel is not None:
            panel.alarming = True
            self._page.run_task(self._pulse, self._run)

    async def _pulse(self, run: int) -> None:
        """Flash the band, then leave it tinted.  See `ALARM_PULSES`."""
        for step in range(ALARM_PULSES * 2):
            if run != self._run:
                return
            self._tint(ALARM_LIT if step % 2 == 0 else ALARM_DIM)
            await asyncio.sleep(ALARM_INTERVAL)
        if run == self._run:
            self._tint(ALARM_DIM)

    def _tint(self, opacity: float) -> None:
        panel = self._panel
        if panel is None:
            return
        panel.bgcolor = ft.Colors.with_opacity(opacity, ft.Colors.ERROR)
        with contextlib.suppress(Exception):
            self._page.update()


__all__ = ["ALARM_DIM", "ALARM_INTERVAL", "ALARM_LIT", "ALARM_PULSES",
           "Alarm", "Band"]
