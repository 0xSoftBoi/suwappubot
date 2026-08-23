"""Give the desktop window an icon, on the one platform that lets us."""

from __future__ import annotations

import ctypes
import os
import struct
import sys
from pathlib import Path

#: What the Flutter host calls itself. Both halves of WM_CLASS are checked
#: because the instance name is lowercase and the class name is not.
HOST_WM_CLASS = ("flet", "Flet")

#: Where `build_icons.py` writes the pre-decoded pixels.
ICON_DATA = Path(__file__).resolve().parent.parent / "assets" / "window_icon.argb"

#: `XA_CARDINAL`, from Xatom.h. The property is a list of cardinals.
XA_CARDINAL = 6
PROP_MODE_REPLACE = 0
#: `AnyPropertyType`, for reads where we do not care what the type is.
ANY_PROPERTY_TYPE = 0


def _in_our_job(pid: int) -> bool:
    """Is `pid` part of the same job this app was started as?"""
    try:
        return os.getpgid(pid) == os.getpgid(0)
    except (OSError, ProcessLookupError):
        return False


def _load_icon() -> list[int] | None:
    """The `_NET_WM_ICON` payload: size pairs and pixels, as written."""
    try:
        raw = ICON_DATA.read_bytes()
    except OSError:
        return None
    if not raw or len(raw) % 4:
        return None
    return list(struct.unpack(f"<{len(raw) // 4}I", raw))


class _ClassHint(ctypes.Structure):
    """`XClassHint`: the instance name and the class name."""

    _fields_ = [
        ("res_name", ctypes.POINTER(ctypes.c_char)),
        ("res_class", ctypes.POINTER(ctypes.c_char)),
    ]


def _text(pointer) -> str:
    """A copy of an X-allocated string, leaving the pointer intact."""
    if not pointer:
        return ""
    value = ctypes.cast(pointer, ctypes.c_char_p).value
    return value.decode("latin-1", "replace") if value else ""


def _declare(xlib) -> None:
    """Give ctypes the real signatures."""
    xlib.XOpenDisplay.restype = ctypes.c_void_p
    xlib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    xlib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xlib.XFlush.argtypes = [ctypes.c_void_p]
    xlib.XFree.argtypes = [ctypes.c_void_p]
    xlib.XInternAtom.restype = ctypes.c_ulong
    xlib.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    xlib.XDefaultRootWindow.restype = ctypes.c_ulong
    xlib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    xlib.XGetClassHint.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(_ClassHint),
    ]
    xlib.XQueryTree.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)),
        ctypes.POINTER(ctypes.c_uint),
    ]
    xlib.XChangeProperty.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_int,
    ]
    xlib.XGetWindowProperty.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_long,
        ctypes.c_long,
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _window_pid(xlib, display, window: int, atom: int) -> int | None:
    """`_NET_WM_PID`, or None where the window does not publish one."""
    actual_type = ctypes.c_ulong()
    actual_format = ctypes.c_int()
    count = ctypes.c_ulong()
    remaining = ctypes.c_ulong()
    data = ctypes.POINTER(ctypes.c_ubyte)()
    status = xlib.XGetWindowProperty(
        display,
        window,
        atom,
        0,
        1,
        False,
        ANY_PROPERTY_TYPE,
        ctypes.byref(actual_type),
        ctypes.byref(actual_format),
        ctypes.byref(count),
        ctypes.byref(remaining),
        ctypes.byref(data),
    )
    if status != 0 or not data or count.value < 1:
        return None
    try:
        return ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[0]
    finally:
        xlib.XFree(data)


def _windows_named(xlib, display, root: int, wanted: tuple[str, ...]) -> list[int]:
    """Every window under `root` whose WM_CLASS matches, depth-first."""
    found: list[int] = []
    stack = [root]
    while stack:
        window = stack.pop()
        hint = _ClassHint()
        if xlib.XGetClassHint(display, window, ctypes.byref(hint)):
            if any(_text(p) in wanted for p in (hint.res_name, hint.res_class)):
                found.append(window)
            xlib.XFree(hint.res_name)
            xlib.XFree(hint.res_class)

        root_out = ctypes.c_ulong()
        parent = ctypes.c_ulong()
        children = ctypes.POINTER(ctypes.c_ulong)()
        count = ctypes.c_uint()
        if xlib.XQueryTree(
            display,
            window,
            ctypes.byref(root_out),
            ctypes.byref(parent),
            ctypes.byref(children),
            ctypes.byref(count),
        ):
            stack += [children[i] for i in range(count.value)]
            if children:
                xlib.XFree(children)
    return found


def apply_window_icon() -> int:
    """Set the icon on every Flet host window. Returns how many were set."""
    if sys.platform not in ("linux", "linux2") or not os.environ.get("DISPLAY"):
        return 0
    icon = _load_icon()
    if not icon:
        return 0
    try:
        xlib = ctypes.CDLL("libX11.so.6")
    except OSError:
        return 0

    _declare(xlib)
    display = xlib.XOpenDisplay(None)
    if not display:
        return 0
    try:
        atom = xlib.XInternAtom(display, b"_NET_WM_ICON", False)
        pid_atom = xlib.XInternAtom(display, b"_NET_WM_PID", False)
        root = xlib.XDefaultRootWindow(display)
        windows = []
        for window in _windows_named(xlib, display, root, HOST_WM_CLASS):
            pid = _window_pid(xlib, display, window, pid_atom)
            if pid is None or _in_our_job(pid):
                windows.append(window)
        if not windows:
            return 0
        payload = (ctypes.c_ulong * len(icon))(*icon)
        for window in windows:
            xlib.XChangeProperty(
                display,
                window,
                atom,
                XA_CARDINAL,
                32,
                PROP_MODE_REPLACE,
                ctypes.cast(payload, ctypes.c_void_p),
                len(icon),
            )
        xlib.XFlush(display)
        return len(windows)
    finally:
        xlib.XCloseDisplay(display)
