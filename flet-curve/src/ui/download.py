"""Handing a generated file to whoever asked for it, on either platform.

The two are genuinely different.  A desktop build opens the save dialog every
other program does -- the file goes where they say and is named what they
name it, which is better than a folder chosen for them and a path reported
after the fact.  A browser has no dialog to open: it downloads, wherever
downloads go, and the browser tells them.

The caller says what happened in its own status line, so this reports rather
than announces: a path when there is one to name, the empty string when the
platform handled it, and `None` when the dialog was dismissed.
"""

from __future__ import annotations

import contextlib
import os
import re
import shutil
import sys
from pathlib import Path

#: Where a desktop build puts a file when there is no dialog to ask with, in
#: the order they are tried.  The XDG variable first because someone who has
#: set it means it.
DOWNLOADS = ("XDG_DOWNLOAD_DIR",)

#: What Flet's `FilePicker` shells out to on Linux.  Without it the dialog
#: never appears and `save_file` says nothing about why, which would make the
#: button look broken -- so it is asked for up front, and a build that does
#: not have it writes the file and names the path instead.
LINUX_DIALOG = "zenity"


def is_browser() -> bool:
    return sys.platform == "emscripten"


def safe_name(name: str) -> str:
    """A filename that will survive both platforms.

    Slashes and colons are the ones that matter -- a pair is written "A/B"
    everywhere else in this app, and that is a directory separator here.
    Leading and trailing dots go too: "." and ".." are not names, and a file
    that begins with one is hidden on every platform that has the notion.
    """
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")
    return cleaned or "download"


#: The channel `download_bridge.js` listens on, and the version of what is
#: sent over it.  Both halves have to agree; the JS is the other side.
CHANNEL = "flet-download"
VERSION = 1


async def save_text(name: str, text: str, *, media: str = "text/plain",
                    page=None, title: str = "Save") -> str | None:
    """Put `text` somewhere the reader chose, and say where it went.

    `None` means they closed the dialog, which is an answer and not a
    failure -- the caller says nothing rather than reporting success.
    """
    name = safe_name(name)
    if is_browser():
        _browser_download(name, text, media)
        return ""
    return await _desktop_dialog(name, text, page, title)


def has_dialog() -> bool:
    """Whether this build can open a save dialog at all.

    macOS and Windows always can.  On Linux, Flet's `FilePicker` shells out to
    Zenity, and without it the dialog silently never opens -- which is worse
    than not offering one, so a build without it writes the file instead.
    """
    if sys.platform != "linux":
        return True
    return shutil.which(LINUX_DIALOG) is not None


async def _desktop_dialog(name: str, text: str, page, title: str) -> str | None:
    """The platform's own save dialog, with the bytes handed straight to it.

    `save_file` writes them itself when given `src_bytes`, so there is no
    second step to get wrong and no window where a path exists with nothing
    in it.  With no page to hang it on, or no Zenity to draw it with, the file
    goes where downloads go and the caller names the path.
    """
    import flet as ft

    if page is None or not has_dialog():
        path = _folder() / name
        path.write_text(text, encoding="utf-8")
        return str(path)
    picker = ft.FilePicker()
    page.services.append(picker)
    try:
        return await picker.save_file(
            dialog_title=title,
            file_name=name,
            allowed_extensions=[name.rsplit(".", 1)[-1]] if "." in name else None,
            src_bytes=text.encode("utf-8"),
        )
    finally:
        with contextlib.suppress(ValueError):
            page.services.remove(picker)


def _folder() -> Path:
    for variable in DOWNLOADS:
        named = os.environ.get(variable)
        if named and Path(named).is_dir():
            return Path(named)
    downloads = Path.home() / "Downloads"
    return downloads if downloads.is_dir() else Path.home()


def _browser_download(name: str, text: str, media: str) -> None:
    """Hand the file to the main thread, which has a DOM to save it with.

    Not `<a download>` here, the obvious way, because it cannot be done here:
    Flet runs this in a module Web Worker and a worker has no `document`,
    which is exactly what it said when it was tried.  Two things that looked
    like ways round it are not: a blob URL made in the worker is valid on
    this origin but Flet's `launch_url` will not open one, and it will not
    open a `data:` URL either -- Flutter's launcher takes http-ish schemes
    and drops the rest without a word.

    So it goes over a `BroadcastChannel` to `download_bridge.js`, which is
    how the wallet already crosses the same gap.
    """
    import js
    from pyodide.ffi import to_js

    message = to_js(
        {"v": VERSION, "dir": "save", "name": name, "text": text, "media": media},
        dict_converter=js.Object.fromEntries,
    )
    channel = js.BroadcastChannel.new(CHANNEL)
    try:
        channel.postMessage(message)
    finally:
        channel.close()


__all__ = ["CHANNEL", "LINUX_DIALOG", "VERSION", "has_dialog", "is_browser",
           "safe_name", "save_text"]
