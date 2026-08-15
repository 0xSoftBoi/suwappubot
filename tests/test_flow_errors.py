"""Tests for whatsapp_flows.flow_errors.user_safe_error.

The audit added this helper so money-path failures stop leaking raw Python
exception text (SQLAlchemy errors, RPC hosts, revert reasons) to WhatsApp
users — they get a generic, reference-tagged message and the detail is
logged server-side.
"""

import logging

from bot.services.whatsapp_flows.flow_errors import user_safe_error


def test_returns_generic_message_without_exception_text():
    msg = user_safe_error(ValueError("SECRET_DB_DSN=postgres://user:pw@host"), "swap")
    assert "SECRET_DB_DSN" not in msg
    assert "postgres" not in msg
    assert "your funds are safe" in msg.lower()


def test_includes_8_char_reference_id():
    msg = user_safe_error(RuntimeError("boom"), "withdrawal")
    # "Ref: <8 hex chars>."
    assert "Ref: " in msg
    ref = msg.split("Ref: ", 1)[1].split(".", 1)[0]
    assert len(ref) == 8
    int(ref, 16)  # raises if not hex


def test_ref_id_is_unique_per_call():
    a = user_safe_error(Exception("x"))
    b = user_safe_error(Exception("x"))
    ref_a = a.split("Ref: ", 1)[1].split(".", 1)[0]
    ref_b = b.split("Ref: ", 1)[1].split(".", 1)[0]
    assert ref_a != ref_b


def test_logs_full_exception_server_side(caplog):
    with caplog.at_level(logging.ERROR):
        user_safe_error(ValueError("internal detail here"), "panic")
    # The label, exception type, and message are all logged for ops — but only
    # the generic string is returned to the user.
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert "internal detail here" in joined
    assert "ValueError" in joined
    assert "[panic]" in joined


def test_context_optional():
    msg = user_safe_error(KeyError("k"))
    assert "your funds are safe" in msg.lower()
