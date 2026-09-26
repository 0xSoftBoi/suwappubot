"""Make Flutter-side failures diagnosable."""

from __future__ import annotations

from flet.testing.flet_test_app import FletTestApp

FletTestApp._FletTestApp__flutter_output_limit = 8 * 1024 * 1024
FletTestApp._FletTestApp__flutter_output_line_limit = 16 * 1024
