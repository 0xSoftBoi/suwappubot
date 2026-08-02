"""Tests for the Sentry before_send scrubber.

Wallet private keys, KMS material, mnemonics, and API tokens must never
leave the process in an error-tracking payload. These tests prove the
scrubber redacts sensitive values in a nested structure.
"""

from bot.services.sentry_service import scrub_event, REDACTED


def test_scrub_event_redacts_nested_private_key_and_auth_header():
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer super-secret-token-abc123",
                "Cookie": "session=xyz",
                "Content-Type": "application/json",
            },
            "cookies": {"session_id": "abcd1234"},
            "data": {"raw_body": "should be dropped entirely"},
        },
        "extra": {
            "user_context": {
                "wallet": {
                    "private_key": "0xdeadbeefcafebabefeedface",
                    "encrypted_key": "some-envelope-blob",
                    "kms_dek": "b64-data-encryption-key",
                    "mnemonic": "abandon abandon abandon ...",
                    "address": "0xNotSecretAddress",
                },
                "auth": {
                    "api_key": "sk-live-notreal",
                    "password": "hunter2",
                },
                "nested_list": [
                    {"seed": "top secret seed phrase"},
                    {"balance": 123.45},
                ],
            },
            "safe_field": "this should survive untouched",
        },
        "tags": {"telegram_bot_token": "123:ABCDEF"},
    }

    scrubbed = scrub_event(event)

    assert scrubbed is not None

    # Request body must be dropped entirely, never sent.
    assert "data" not in scrubbed["request"]

    # Headers/cookies scrubbed.
    assert scrubbed["request"]["headers"]["Authorization"] == REDACTED
    assert scrubbed["request"]["headers"]["Cookie"] == REDACTED
    assert scrubbed["request"]["headers"]["Content-Type"] == "application/json"
    # "cookies" is itself a sensitive key, so the whole value is replaced rather
    # than walked member-by-member — strictly stronger than redacting each entry.
    assert scrubbed["request"]["cookies"] == REDACTED

    wallet = scrubbed["extra"]["user_context"]["wallet"]
    assert wallet["private_key"] == REDACTED
    assert wallet["encrypted_key"] == REDACTED
    assert wallet["kms_dek"] == REDACTED
    assert wallet["mnemonic"] == REDACTED
    # Non-sensitive key untouched.
    assert wallet["address"] == "0xNotSecretAddress"

    auth = scrubbed["extra"]["user_context"]["auth"]
    assert auth["api_key"] == REDACTED
    assert auth["password"] == REDACTED

    nested_list = scrubbed["extra"]["user_context"]["nested_list"]
    assert nested_list[0]["seed"] == REDACTED
    assert nested_list[1]["balance"] == 123.45

    assert scrubbed["extra"]["safe_field"] == "this should survive untouched"
    assert scrubbed["tags"]["telegram_bot_token"] == REDACTED


def test_scrub_event_redacts_secrets_logged_into_breadcrumbs():
    """The Python SDK turns log records into breadcrumbs by default.

    This codebase logs heavily, so a secret that reached a log line would ride
    along in the payload unless breadcrumbs are scrubbed too.
    """
    pk = "0x" + "ab" * 32  # 64 hex chars — private-key shaped
    event = {
        "breadcrumbs": {
            "values": [
                {"category": "swap", "message": f"signing with {pk}"},
                {"category": "auth", "data": {"access_token": "sk-live-notreal"}},
                {"category": "ok", "message": "nothing sensitive here"},
            ]
        }
    }

    scrubbed = scrub_event(event)
    assert scrubbed is not None

    crumbs = scrubbed["breadcrumbs"]["values"]
    assert pk not in crumbs[0]["message"]
    assert REDACTED in crumbs[0]["message"]
    assert crumbs[1]["data"]["access_token"] == REDACTED
    assert crumbs[2]["message"] == "nothing sensitive here"


def test_scrub_event_redacts_secret_interpolated_into_exception_message():
    """Key-based matching cannot catch a secret pasted into a message string."""
    pk = "0x" + "cd" * 32
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    bot_token = "1234567890:AAHfiqksKZ8WmR2zSjiQ7_v4swadNQbY5Vv"

    event = {
        "exception": {
            "values": [
                {"type": "ValueError", "value": f"failed to sign with {pk}"},
                {"type": "AuthError", "value": f"rejected jwt {jwt}"},
                {"type": "ApiError", "value": f"telegram said no: {bot_token}"},
            ]
        },
        "message": f"outer message containing {pk}",
    }

    scrubbed = scrub_event(event)
    assert scrubbed is not None

    values = scrubbed["exception"]["values"]
    assert pk not in values[0]["value"] and REDACTED in values[0]["value"]
    assert jwt not in values[1]["value"] and REDACTED in values[1]["value"]
    assert bot_token not in values[2]["value"] and REDACTED in values[2]["value"]
    assert pk not in scrubbed["message"]
    # Surrounding context is preserved so the error stays diagnosable.
    assert values[0]["value"].startswith("failed to sign with")
    assert values[0]["type"] == "ValueError"


def test_scrub_event_scrubs_fields_outside_the_old_allow_list():
    """Regression: scrub_event used to enumerate a fixed set of fields, so every
    other field in Sentry's schema shipped raw — `user`, `server_name`,
    `transaction`, `modules`, and stacktrace frame `vars`. It is now
    deny-by-default: a field nobody thought of must be scrubbed, not exempt."""
    pk = "0x" + "ab" * 32
    event = {
        "user": {"private_key": pk, "id": "u1"},
        "server_name": f"host-{'ef' * 32}",
        "modules": {"note": pk},
        "exception": {
            "values": [{"stacktrace": {"frames": [{"vars": {"privateKey": pk}}]}}],
        },
    }

    scrubbed = scrub_event(event)
    blob = str(scrubbed)

    assert pk not in blob
    assert "ef" * 32 not in blob
    assert scrubbed["user"]["id"] == "u1"  # non-sensitive context survives


def test_scrub_event_deletes_request_url_and_env():
    """The FastAPI integration puts the FULL url — including the query string —
    in request["url"], so redacting query_string alone still shipped the token."""
    event = {
        "request": {
            "url": "https://api.example.com/internal/monitor-heartbeat?token=SUPERSECRET",
            "query_string": "token=SUPERSECRET",
            "data": {"body": "x"},
            "env": {"SERVER_NAME": "x"},
            "method": "POST",
        }
    }

    scrubbed = scrub_event(event)

    assert "SUPERSECRET" not in str(scrubbed)
    for field in ("url", "data", "env"):
        assert field not in scrubbed["request"]
    assert scrubbed["request"]["method"] == "POST"  # useful context kept


def test_scrub_event_redacts_credentialed_rpc_urls():
    """RPC providers put the API key in the URL PATH, under the benign key
    "url". Sentry records outbound requests as breadcrumbs, so an RPC error
    would otherwise exfiltrate our paid Alchemy/Helius keys."""
    event = {
        "breadcrumbs": {
            "values": [
                {
                    "category": "httplib",
                    "data": {"url": "https://eth-mainnet.g.alchemy.com/v2/SUPERSECRETKEY"},
                }
            ]
        }
    }

    scrubbed = scrub_event(event)
    url = scrubbed["breadcrumbs"]["values"][0]["data"]["url"]

    assert "SUPERSECRETKEY" not in url
    assert "alchemy.com" in url  # host retained so the error stays diagnosable


def test_scrub_event_handles_camelcase_bytes_and_sets():
    """Three separate bypasses found by audit: camelCase keys were not matched
    (we exchange camelCase JSON with api-ts/Turnkey), and bytes/set values were
    returned untouched despite Sentry serializing them via repr()."""
    pk = "0x" + "ab" * 32
    event = {
        "extra": {
            "privateKey": pk,  # camelCase — previously missed entirely
            "blob": pk.encode(),  # bytes — previously passed through
            "collection": {pk},  # set — previously passed through
        }
    }

    scrubbed = scrub_event(event)
    blob = str(scrubbed)

    assert pk not in blob
    assert "ab" * 32 not in blob


def test_scrub_event_never_raises_on_malformed_input():
    # A pathological event shape must never crash the scrubber; worst case
    # it should drop the event rather than throw.
    event = {"request": ["not", "a", "dict"], "extra": "also not a dict"}
    result = scrub_event(event)
    # Either gracefully handled (dict returned) or dropped (None) — must
    # not raise.
    assert result is None or isinstance(result, dict)
