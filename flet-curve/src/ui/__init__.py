"""Flet controls. Everything in here imports `curve`, never the reverse."""

from __future__ import annotations

import contextlib
from typing import Any

import flet as ft

#: An event from whatever control fired it.
AnyEvent = ft.Event[Any]


def safe_update(control) -> None:
    """`update()` the control if it is on a page; otherwise do nothing."""
    with contextlib.suppress(RuntimeError):
        control.update()
