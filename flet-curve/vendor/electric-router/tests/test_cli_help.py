"""`--help` must render, for every subcommand.

argparse runs each help string through `%` interpolation, so a literal
percent is a crash rather than a typo: `"5% of the size"` reads as a space-
flagged octal conversion and `erouter route --help` died with "%o format: an
integer is required, not dict".  Nothing else in the suite calls `format_help`,
so the CLI's own front door was the one path with no coverage.

Rendering every parser is the whole test; the bad string cannot survive it.
"""

import pytest

from erouter.dev.cli import build_parser


def _subparsers(parser):
    for action in parser._actions:
        choices = getattr(action, "choices", None)
        if choices and hasattr(choices, "items"):
            yield from choices.items()


PARSERS = [("erouter", build_parser())]
PARSERS += [(name, sub) for name, sub in _subparsers(build_parser())]


@pytest.mark.parametrize("name,parser", PARSERS, ids=[n for n, _ in PARSERS])
def test_help_renders(name, parser):
    assert parser.format_help()


def test_every_subcommand_is_covered():
    # A guard on the guard: if the parametrisation silently found no
    # subcommands, every case above would pass while testing nothing.
    assert len(PARSERS) > 5


def test_the_calldata_flag_takes_a_naming_mode_or_none_at_all():
    """`--calldata` alone has to work: the mode is the exception, not the rule."""
    from erouter.core.routecall import ALL, NEEDED, NONE

    parser = dict(_subparsers(build_parser()))["route"]
    base = ["--from", "USDC", "--to", "WETH", "--amount", "1"]
    assert parser.parse_args(base).calldata is None
    assert parser.parse_args([*base, "--calldata"]).calldata == NEEDED
    for mode in (NONE, ALL):
        assert parser.parse_args([*base, "--calldata", mode]).calldata == mode
    with pytest.raises(SystemExit):
        parser.parse_args([*base, "--calldata", "sometimes"])
