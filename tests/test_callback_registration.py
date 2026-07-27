"""Every rendered button must have a handler that can answer it.

A dead button — `callback_data` that no registered `CallbackQueryHandler`
pattern matches — is invisible in review and in CI: the code imports, the
keyboard renders, and the tap silently does nothing. The "📊 Stats" button on
the history screen shipped that way; its handler function existed but was
never wrapped in a handler.

This test walks the AST of every handler module for `callback_data=` values,
collects every `pattern=` from the registered handlers, and fails if a button
has no possible match. Pre-existing offenders are listed in KNOWN_UNREGISTERED
so this can be enforced now rather than after that debt is paid off — but the
list must only ever shrink.

KNOWN LIMITATION: this proves a pattern exists *somewhere*, not that it is
reachable from the state the user is actually in. A pattern registered only
inside a ConversationHandler's states is invisible to a user who has no active
conversation — which is exactly how the "🎁 Redeem $X" button on Home became a
no-op despite `^pred_positions$` being registered. Catching that class needs
per-state reachability analysis, which this does not attempt.
"""

import ast
import pathlib
import re

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BOT_DIR = REPO_ROOT / "bot"

# `noop` is a deliberate no-op used for keyboard header rows.
IGNORED_CALLBACK_DATA = {"noop"}

# Buttons that already had no reachable handler before this test existed.
# Each is a real defect; the list is documentation of known debt, not a
# blessing. ONLY REMOVE ENTRIES — never add one to make a new button pass.
KNOWN_UNREGISTERED = {
    "borrow_add",
    "borrow_close_pos",
    "borrow_repay",
    "borrow_repay_all",
    "borrow_wd_all",
    "borrow_withdraw",
    "borrow_ltv_",
    "pred_amt_5",
    "pred_amt_10",
    "pred_amt_25",
    "pred_amt_50",
    "snipe_watch_add",
    "snipe_quick_",
    "snipe_unwatch_",
    "copy_follow_",
    "p2p_canc_",
    "p2p_pause_",
    "p2p_pay_",
    "save_",
    "save_btc_v_",
    "settings_speed_",
    "xs_view_",
}


def _python_files():
    return [p for p in BOT_DIR.rglob("*.py") if "__pycache__" not in str(p)]


def _collect_callback_data():
    """Return {value_or_prefix: [file:line]} for every rendered callback_data."""
    found: dict[str, list[str]] = {}

    for path in _python_files():
        tree = ast.parse(path.read_text())
        rel = path.relative_to(REPO_ROOT)

        for node in ast.walk(tree):
            if not isinstance(node, ast.keyword) or node.arg != "callback_data":
                continue

            value = node.value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                found.setdefault(value.value, []).append(f"{rel}:{value.lineno}")
            elif isinstance(value, ast.JoinedStr):
                # f-string: the leading literal chunk is the routable prefix.
                literal_prefix = ""
                for part in value.values:
                    if isinstance(part, ast.Constant) and isinstance(part.value, str):
                        literal_prefix += part.value
                    else:
                        break
                if literal_prefix:
                    found.setdefault(literal_prefix, []).append(f"{rel}:{value.lineno}")

    return found


def _collect_patterns():
    """Every regex passed as `pattern=` anywhere under bot/."""
    patterns = []
    for path in _python_files():
        for match in re.finditer(r'pattern\s*=\s*(?:r)?["\']([^"\']+)["\']', path.read_text()):
            try:
                patterns.append(re.compile(match.group(1)))
            except re.error:
                pass  # a pattern we can't compile can't be validated against
    return patterns


def _matches(value: str, patterns) -> bool:
    """True if any registered pattern could route this callback_data.

    Patterns are usually anchored with a variable tail (``^copy_execute_\\d+$``),
    so a bare dynamic prefix must be tested with plausible completions or every
    parameterised button looks dead.
    """
    candidates = [
        value,
        value + "1",
        value + "123",
        value + "abc",
        value + "0x1234abcd",
        value + "ethereum",
        value + "1_2",
    ]
    return any(p.search(c) for c in candidates for p in patterns)


@pytest.fixture(scope="module")
def unregistered():
    patterns = _collect_patterns()
    return {
        value: sites
        for value, sites in _collect_callback_data().items()
        if value not in IGNORED_CALLBACK_DATA and not _matches(value, patterns)
    }


def test_no_new_dead_buttons(unregistered):
    """A button with no reachable handler is a silent no-op for the user."""
    new_offenders = {v: s for v, s in unregistered.items() if v not in KNOWN_UNREGISTERED}
    assert not new_offenders, "callback_data with no registered handler:\n" + "\n".join(
        f"  {value!r} rendered at {sites[0]}" for value, sites in sorted(new_offenders.items())
    )


def test_known_unregistered_list_does_not_go_stale(unregistered):
    """Entries must be removed from KNOWN_UNREGISTERED once they're fixed."""
    fixed = KNOWN_UNREGISTERED - set(unregistered)
    assert not fixed, (
        "These are no longer dead — delete them from KNOWN_UNREGISTERED so the "
        f"list keeps shrinking: {sorted(fixed)}"
    )


def test_the_audit_actually_finds_buttons():
    """Guard against the AST walk silently matching nothing and passing vacuously."""
    assert len(_collect_callback_data()) > 100
    assert len(_collect_patterns()) > 100
