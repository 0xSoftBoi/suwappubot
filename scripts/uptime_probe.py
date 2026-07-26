#!/usr/bin/env python3
"""External uptime probe — checks public endpoints, alerts Telegram, emits a heartbeat.

This is the *unattended* monitor. `scripts/status.py` is the rich manual check
(it needs the authenticated `railway` CLI); this one deliberately needs nothing
but python3 + network, so it can run anywhere: GitHub Actions, a Railway cron
service, a laptop, a cron on any box.

Why it exists in this form
--------------------------
Our uptime monitoring used to run *only* on GitHub Actions. When Actions billing
failed on 2026-07-25 the job stopped starting — so the alert step never ran and
nothing reported that monitoring itself had died. Silence read as health.

The fix has two halves:

1. Run this probe from more than one place (GitHub Actions *and* a Railway cron
   service), so one biller/provider failing does not blind us.
2. Emit a heartbeat on every run (--heartbeat-url). The always-on python-api
   records it and raises a **dead-man's switch** alert if the heartbeat goes
   stale — that is what catches "the monitor stopped running".

Usage:
    python3 scripts/uptime_probe.py                    # probe prod, print result
    python3 scripts/uptime_probe.py --env dev
    python3 scripts/uptime_probe.py --json

Environment:
    TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID   send an alert on failure
    MONITOR_HEARTBEAT_URL, MONITOR_HEARTBEAT_TOKEN   dead-man's-switch ping
    PROBE_SOURCE                                 label for this runner
                                                 (e.g. "github-actions", "railway-cron")

Exit codes: 0 = all endpoints healthy, 1 = one or more failed, 2 = config error.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Reuse the probing + payload-parsing logic rather than maintaining a second
# copy that can drift. status.py has no import-time side effects.
from status import probe, subsystem_breakdown  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
ENDPOINTS_FILE = REPO_ROOT / "monitoring" / "endpoints.json"


def load_endpoints(env: str) -> list[dict]:
    try:
        data = json.loads(ENDPOINTS_FILE.read_text())
    except FileNotFoundError:
        raise SystemExit(f"missing {ENDPOINTS_FILE}")
    except json.JSONDecodeError as e:
        raise SystemExit(f"{ENDPOINTS_FILE} is not valid JSON: {e}")
    eps = data.get(env)
    if not eps:
        raise SystemExit(f"no endpoints defined for env '{env}' in {ENDPOINTS_FILE}")
    return eps


# A freshly restarted service reports its background heartbeats as
# "unknown"/"dead" until they first tick, so every deploy briefly looks degraded.
# status.py suppresses that using the deploy timestamp from the Railway control
# plane, but this probe deliberately has no Railway access — so instead we
# re-check and only alert on degradation that PERSISTS. Without this the cron
# pages on every single deploy and people learn to ignore it.
DEGRADED_RECHECKS = 2
DEGRADED_RECHECK_DELAY = 60


def check(ep: dict, rechecks: int = DEGRADED_RECHECKS) -> dict:
    """Probe one endpoint. Returns a result dict with ok/status/detail."""
    result = {"name": ep["name"], "url": ep["url"], "degraded": []}

    for attempt in range(rechecks + 1):
        status, body = probe(ep["url"], timeout=15, attempts=3)
        result["status"] = status
        result["ok"] = 200 <= status < 300

        if not result["ok"]:
            # A hard failure is already retried inside probe(); don't also burn
            # the recheck budget on it — report it immediately.
            result["detail"] = f"HTTP {status or 'unreachable'}"
            return result

        # For endpoints exposing a deep payload, 200 is not enough — the body
        # reports per-subsystem health (db, redis, background heartbeats).
        if not ep.get("deep"):
            result["degraded"] = []
            result.pop("detail", None)
            return result

        bad = subsystem_breakdown(body)
        if not bad:
            result["degraded"] = []
            result.pop("detail", None)
            return result

        result["degraded"] = [f"{k}={v}" for k, v in bad]
        result["detail"] = "degraded: " + ", ".join(result["degraded"])
        result["rechecked"] = attempt

        if attempt < rechecks:
            time.sleep(DEGRADED_RECHECK_DELAY)

    # Still degraded after every recheck — this is not a deploy blip.
    result["detail"] += f" (persisted across {rechecks + 1} checks)"
    return result


def send_telegram(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_ALERT_CHAT_ID", "").strip()
    if not token or not chat:
        print("::warning:: TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID unset — no alert sent")
        return False
    payload = urllib.parse.urlencode(
        {"chat_id": chat, "parse_mode": "Markdown", "text": text}
    ).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:
        # Type only — the bot token is in the request URL and urllib errors
        # routinely echo it back. See send_heartbeat() for the same reasoning.
        print(f"telegram send failed: {type(e).__name__}")
        return False


def send_heartbeat(all_ok: bool) -> None:
    """Ping the dead-man's switch so python-api knows the monitor is alive.

    Deliberately best-effort and non-fatal: a heartbeat failure must never mask
    or replace the actual probe result.
    """
    url = os.environ.get("MONITOR_HEARTBEAT_URL", "").strip()
    if not url:
        return
    token = os.environ.get("MONITOR_HEARTBEAT_TOKEN", "").strip()
    source = os.environ.get("PROBE_SOURCE", "unknown").strip()
    params = {"source": source, "ok": "1" if all_ok else "0"}
    if token:
        params["token"] = token
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, data=b"", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"heartbeat sent ({source}) -> HTTP {r.status}")
    except Exception as e:
        # Print only the exception TYPE. Several urllib failures (bad scheme,
        # control chars in the token) stringify the full URL, which carries the
        # token in its query string — and Railway cron logs are not masked the
        # way GitHub Actions masks registered secrets.
        print(f"heartbeat failed (non-fatal): {type(e).__name__}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Suwappu external uptime probe")
    ap.add_argument("--env", default="prod", choices=["prod", "dev"])
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument(
        "--no-alert", action="store_true", help="check only; never send a Telegram alert"
    )
    ap.add_argument(
        "--rechecks",
        type=int,
        default=DEGRADED_RECHECKS,
        help=(
            "times to re-check a degraded deep endpoint before alerting "
            f"(default {DEGRADED_RECHECKS}, {DEGRADED_RECHECK_DELAY}s apart). "
            "Use 0 for an instant answer when running by hand."
        ),
    )
    args = ap.parse_args()

    endpoints = load_endpoints(args.env)
    results = [check(ep, rechecks=max(0, args.rechecks)) for ep in endpoints]

    failed = [r for r in results if not r["ok"]]
    degraded = [r for r in results if r["ok"] and r["degraded"]]
    all_ok = not failed and not degraded

    # Heartbeat first, so a slow/broken Telegram call cannot stop the dead-man's
    # switch from being fed.
    send_heartbeat(all_ok)

    if args.as_json:
        print(
            json.dumps(
                {
                    "ok": all_ok,
                    "env": args.env,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                    "failed": [r["name"] for r in failed],
                    "degraded": [r["name"] for r in degraded],
                    "results": results,
                },
                indent=2,
            )
        )
    else:
        for r in results:
            if not r["ok"]:
                mark = "FAIL"
            elif r["degraded"]:
                mark = "WARN"
            else:
                mark = "OK  "
            detail = r.get("detail") or f"HTTP {r['status']}"
            print(f"{mark} {r['name']:<14} {detail}")

    if not all_ok:
        lines = [f"🩺 *Suwappu uptime probe failed* (`{args.env}`)"]
        for r in failed:
            lines.append(f"• `{r['name']}` → {r['detail']}")
        for r in degraded:
            lines.append(f"• `{r['name']}` → {r['detail']}")
        if not args.no_alert:
            send_telegram("\n".join(lines))
        print("\n".join(lines))
        return 1

    print(f"All {len(results)} endpoints healthy ({args.env}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
