#!/usr/bin/env python3
"""Suwappu unified status — one command to answer "is anything broken right now?".

Unlike scripts/monitor.sh and scripts/health-triage.sh (which only probe public
HTTP health endpoints), this reads Railway's *control plane* first. That is the
blind spot those scripts have: a service with no public URL (python-worker,
suwappu-relayer, suwappu-bridge) can be crash-looping while every health probe
returns 200, and a deploy can fail while the previous container keeps serving
traffic happily.

The service list is derived from Railway at runtime, so newly added services are
covered automatically instead of drifting out of a hardcoded list.

Usage:
    python3 scripts/status.py                 # full check (prod)
    python3 scripts/status.py --env dev
    python3 scripts/status.py --quick         # skip the log error scan (fast)
    python3 scripts/status.py --json          # machine-readable, for CI/cron
    python3 scripts/status.py --logs api-ts   # dump recent logs for one service

Exit codes: 0 = all good, 1 = degraded/down, 2 = could not determine (tooling).

Only needs python3 (stdlib), the `railway` CLI, and optionally `gh`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

# Services that are infrastructure, not our code — reported but never alerted on
# for "no deployment", since Railway manages their lifecycle.
INFRA_SERVICES = {"Postgres", "Redis"}

# Deployment states Railway considers terminal-bad.
BAD_DEPLOY_STATES = {"FAILED", "CRASHED", "BUILD_FAILED", "DEPLOY_FAILED", "REMOVED"}

# How long after a deploy we treat stale background heartbeats as "warming up"
# rather than "degraded". Heartbeat intervals in bot/services are well under this.
WARMUP_SECONDS = 300

# Custom domains take priority over *.up.railway.app when probing. Railway does
# not always report custom domains through the CLI, so this map is a supplement,
# not the source of truth for which services exist.
#
# CAREFUL: api.suwappu.bot resolves to the **api-ts** service, not python-api
# (verified 2026-07-25: it returns {"service":"suwappu-api-ts"}). python-api has
# no custom domain in prod, so we probe it on its railway.app host — which is
# also the only host that serves its deep readiness payload.
CUSTOM_DOMAIN = {
    "prod": {
        "api-ts": "https://api.suwappu.bot",
    },
    "dev": {
        "api-ts": "https://devapi.suwappu.bot",
    },
}

# Path to probe per service. Services not listed get "/" (a 2xx means it serves).
# python-api uses /health rather than /health/ready: they run the same deep check
# (/health is an alias), but the Cloudflare Worker fronting api.suwappu.bot only
# proxies a fixed set of paths and 404s on /health/ready.
HEALTH_PATH = {
    "python-api": "/health",
    "api-ts": "/health",
    "showcase": "/robots.txt",
}

# Log lines matching these are counted as errors worth surfacing.
ERROR_RE = re.compile(
    r"\b(ERROR|CRITICAL|Traceback|ImportError|ModuleNotFoundError|"
    r"cannot import|Unhandled|FATAL)\b"
)
# Known-noisy lines we do not want drowning the signal. RPC circuit-breaker
# warnings are expected steady-state noise from free public RPC endpoints.
ERROR_IGNORE_RE = re.compile(r"RPC circuit OPEN|circuit breaker|rpc_error")

RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
RED, GREEN, YELLOW, CYAN = "\033[31m", "\033[32m", "\033[33m", "\033[36m"


def color(txt: str, c: str) -> str:
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR"):
        return txt
    return f"{c}{txt}{RESET}"


def run(cmd: list[str], timeout: int = 60) -> tuple[int, str]:
    """Run a command, returning (exit_code, combined_output). Never raises."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError:
        return 127, f"{cmd[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, f"{' '.join(cmd)}: timed out after {timeout}s"


def age_seconds(iso: str | None) -> int | None:
    """Seconds since an ISO timestamp, or None if unparseable."""
    if not iso:
        return None
    try:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((datetime.now(timezone.utc) - then).total_seconds())


def age_of(iso: str | None) -> str:
    secs = age_seconds(iso)
    if secs is None:
        return "?"
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h"
    return f"{secs // 86400}d"


# ── 1. Railway control plane ──────────────────────────────────────────────


def railway_services(env: str) -> tuple[list[dict], str | None]:
    """Return (services, error). Each service dict describes its live deploy."""
    if not shutil.which("railway"):
        return [], "railway CLI not installed"

    code, out = run(["railway", "status", "--json"], timeout=60)
    if code != 0:
        hint = " (run `railway login`)" if "unauthor" in out.lower() else ""
        return [], f"railway status failed{hint}: {out.strip()[:200]}"

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return [], "railway status returned non-JSON (CLI may need re-auth)"

    target = "production" if env == "prod" else env
    envs = data.get("environments", {}).get("edges", [])
    node = next((e["node"] for e in envs if e.get("node", {}).get("name") == target), None)
    if node is None:
        names = [e.get("node", {}).get("name") for e in envs]
        return [], f"no Railway environment named '{target}' (have: {names})"

    services = []
    for edge in node.get("serviceInstances", {}).get("edges", []):
        s = edge.get("node", {})
        deploys = s.get("activeDeployments") or []
        latest = s.get("latestDeployment") or {}
        dep = deploys[0] if deploys else latest

        instances = dep.get("instances") or []
        inst_states = [i.get("status") for i in instances]

        domains = s.get("domains") or {}
        hosts = [d.get("domain") for d in domains.get("customDomains", []) if d]
        hosts += [d.get("domain") for d in domains.get("serviceDomains", []) if d]

        services.append(
            {
                "name": s.get("serviceName") or s.get("serviceId", "?"),
                "status": dep.get("status"),
                "deployed_at": dep.get("createdAt"),
                "instances": inst_states,
                "replicas": s.get("numReplicas"),
                "hosts": [h for h in hosts if h],
                "has_active_deploy": bool(deploys),
            }
        )
    services.sort(key=lambda x: x["name"].lower())
    return services, None


def judge_service(svc: dict) -> tuple[str, str]:
    """Classify a service as ok/warn/down with a human reason."""
    name, status = svc["name"], svc["status"]
    infra = name in INFRA_SERVICES

    if status in BAD_DEPLOY_STATES:
        return "down", f"deploy {status}"
    if not svc["has_active_deploy"] and not status:
        # Never deployed in this environment at all — Railway reports neither an
        # active nor a latest deployment. This is normal: dev only provisions a
        # subset of services. Not an outage, so it must not trip the exit code.
        return "absent", "not deployed in this environment"
    if not svc["has_active_deploy"]:
        # It HAS deployed here before but nothing is active now — that is a real
        # regression for our services (infra is managed by Railway).
        return ("warn", "no active deployment") if infra else ("down", "no active deployment")
    if status in {"BUILDING", "DEPLOYING", "INITIALIZING", "WAITING", "QUEUED"}:
        return "warn", f"deploy in progress ({status})"
    if status != "SUCCESS":
        return "warn", f"deploy {status or 'unknown'}"

    inst = svc["instances"]
    if inst and not all(i == "RUNNING" for i in inst):
        return "down", f"instances {inst}"
    if not inst and not infra:
        return "warn", "no running instances reported"
    return "ok", "running"


# ── 2. HTTP health probes ─────────────────────────────────────────────────


def _probe_once(url: str, timeout: int) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "suwappu-status/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(4000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(4000).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, body
    except Exception as e:  # DNS, TLS, timeout, connection refused
        return 0, f"{type(e).__name__}: {e}"


def probe(url: str, timeout: int = 15, attempts: int = 3) -> tuple[int, str]:
    """GET a URL, retrying non-2xx. Returns (http_status_or_0, body_snippet).

    Retries matter more than they look: Railway serves 502 "Application failed
    to respond" for the few seconds a service is redeploying, and background
    heartbeats briefly report "dead"/"unknown" right after a restart. Without
    this, a routine deploy looks identical to an outage.
    """
    status, body = 0, ""
    for i in range(attempts):
        status, body = _probe_once(url, timeout)
        if 200 <= status < 300:
            return status, body
        if i < attempts - 1:
            time.sleep(4)
    return status, body


def health_url(svc: dict, env: str) -> str | None:
    name = svc["name"]
    base = CUSTOM_DOMAIN.get(env, {}).get(name)
    if not base:
        if not svc["hosts"]:
            return None  # internal-only service; control plane is our only signal
        base = "https://" + svc["hosts"][0]
    return base.rstrip("/") + HEALTH_PATH.get(name, "/")


# Values a health payload may report that mean "this subsystem is fine".
# "webhook"/"polling" are the two legitimate bot modes; "unknown" is NOT here —
# a stale background-service heartbeat reports "unknown" and is worth surfacing.
HEALTHY_VALUES = {
    "ok",
    "up",
    "healthy",
    "running",
    "connected",
    "alive",
    "webhook",
    "polling",
    "enabled",
    "ready",
    "true",
    "pass",
    "disabled",
}

# Purely descriptive fields — never a health signal.
META_KEYS = {
    "service",
    "version",
    "timestamp",
    "time",
    "uptime",
    "env",
    "region",
    "commit",
    "build",
    "name",
}


def subsystem_breakdown(body: str) -> list[tuple[str, str]]:
    """Pull per-subsystem health out of a deep health payload.

    Handles the real shapes both APIs return:
      python-api: {"ready":true,"checks":{"database":"connected",
                   "background_services":{"tx_poller":"alive", ...}}}
      api-ts:     {"status":"ok","db":"connected"}

    Returns only the subsystems that are NOT healthy, so output stays short.
    An empty list means everything reported healthy.
    """
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return []
    if not isinstance(data, dict):
        return []

    # Prefer the nested "checks" subtree when present — the top level carries
    # metadata (service/version/timestamp) we do not want to inspect.
    root = data.get("checks") if isinstance(data.get("checks"), dict) else data

    bad: list[tuple[str, str]] = []

    def walk(prefix: str, obj) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in META_KEYS:
                    continue
                walk(f"{prefix}{k}." if isinstance(v, (dict, list)) else f"{prefix}{k}", v)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(f"{prefix}{i}.", v)
        elif isinstance(obj, bool):
            if not obj:
                bad.append((prefix, "false"))
        elif isinstance(obj, str):
            if obj.strip().lower() not in HEALTHY_VALUES:
                bad.append((prefix, obj))

    walk("", root)

    # `ready: false` at the top level is the headline signal — keep it first.
    if data.get("ready") is False:
        bad.insert(0, ("ready", "false"))
    return bad[:12]


# ── 3. Log error scan ─────────────────────────────────────────────────────


def scan_logs(service: str, lines: int = 200) -> tuple[list[str], str | None]:
    """Fetch recent deploy logs and return (interesting_error_lines, error)."""
    code, out = run(["railway", "logs", "-s", service, "--lines", str(lines)], timeout=90)
    if code != 0:
        return [], f"log fetch failed: {out.strip()[:120]}"
    hits = [
        ln.strip()
        for ln in out.splitlines()
        if ERROR_RE.search(ln) and not ERROR_IGNORE_RE.search(ln)
    ]
    return hits, None


# ── 4. CI ─────────────────────────────────────────────────────────────────


def ci_status(limit: int = 5) -> list[str]:
    if not shutil.which("gh"):
        return []
    code, out = run(["gh", "run", "list", "--branch", "main", "--limit", str(limit)], timeout=45)
    if code != 0:
        return []
    rows = []
    for ln in out.strip().splitlines():
        parts = ln.split("\t")
        if len(parts) >= 4:
            rows.append(f"{parts[0]:>10}  {parts[1]:>8}  {parts[2][:48]}")
    return rows


# ── main ──────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description="Suwappu unified deploy/health status")
    ap.add_argument("--env", default="prod", choices=["prod", "dev"])
    ap.add_argument("--quick", action="store_true", help="skip the log error scan")
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--logs", metavar="SERVICE", help="dump recent logs for a service")
    ap.add_argument("--lines", type=int, default=200)
    args = ap.parse_args()

    if args.logs:
        code, out = run(
            ["railway", "logs", "-s", args.logs, "--lines", str(args.lines)], timeout=90
        )
        print(out)
        return 0 if code == 0 else 2

    services, err = railway_services(args.env)
    if err:
        # Control plane unavailable is itself important — do not silently pass.
        if args.as_json:
            print(json.dumps({"ok": False, "error": err}, indent=2))
        else:
            print(color(f"✗ Railway control plane unavailable: {err}", RED))
            print(color("  Fix the CLI auth/link — HTTP probes alone cannot see", DIM))
            print(color("  crash-looping workers or failed deploys.", DIM))
        return 2

    # Judge each service, then probe the ones with a reachable URL in parallel.
    for s in services:
        s["verdict"], s["reason"] = judge_service(s)
        s["url"] = health_url(s, args.env)

    # Don't probe services that were never deployed here — a 404 on a service
    # that dev simply doesn't provision is noise, not an outage.
    probes = [s for s in services if s["url"] and s["verdict"] != "absent"]
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda s: probe(s["url"]), probes))
    for s, (code_, body) in zip(probes, results):
        s["http_status"] = code_
        s["http_body"] = body[:400]
        s["subsystems"] = subsystem_breakdown(body) if 200 <= code_ < 300 else []
        if not (200 <= code_ < 300):
            s["verdict"] = "down"
            s["reason"] = f"HTTP {code_ or 'unreachable'}"
        elif s["subsystems"] and s["verdict"] == "ok":
            # Background-service heartbeats read "unknown"/"dead" for the first
            # minutes after a restart simply because they have not ticked yet.
            # Treat a freshly deployed service as warming up, not degraded —
            # otherwise every deploy looks like an incident.
            age = age_seconds(s["deployed_at"])
            if age is not None and age < WARMUP_SECONDS:
                s["warming_up"] = True
                s["reason"] = f"warming up ({len(s['subsystems'])} heartbeat(s) not ticked yet)"
            else:
                s["verdict"] = "warn"
                s["reason"] = f"{len(s['subsystems'])} subsystem(s) degraded"

    # Only scan logs where something already looks wrong — keeps the fast path fast.
    if not args.quick:
        suspects = [s for s in services if s["verdict"] != "ok" and s["name"] not in INFRA_SERVICES]
        for s in suspects[:4]:
            hits, log_err = scan_logs(s["name"], args.lines)
            s["errors"] = hits[-8:]
            s["errors_total"] = len(hits)
            if log_err:
                s["log_error"] = log_err

    down = [s for s in services if s["verdict"] == "down"]
    warn = [s for s in services if s["verdict"] == "warn"]
    absent = [s for s in services if s["verdict"] == "absent"]
    exit_code = 1 if (down or warn) else 0

    if args.as_json:
        print(
            json.dumps(
                {
                    "ok": not down and not warn,
                    "env": args.env,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                    "down": [s["name"] for s in down],
                    "warn": [s["name"] for s in warn],
                    "absent": [s["name"] for s in absent],
                    "services": services,
                },
                indent=2,
                default=str,
            )
        )
        return exit_code

    # ── human output ──
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(color("═" * 72, DIM))
    print(color(f" SUWAPPU STATUS  ({args.env})  {stamp}", BOLD))
    print(color("═" * 72, DIM))

    print(color("\n▸ Railway services (control plane)", CYAN))
    marks = {
        "ok": color("✓", GREEN),
        "warn": color("!", YELLOW),
        "down": color("✗", RED),
        "absent": color("·", DIM),
    }
    for s in services:
        if s["verdict"] == "absent":
            print(color(f"  · {s['name']:<18} not deployed in {args.env}", DIM))
            continue
        inst = ",".join(s["instances"]) or "-"
        line = (
            f"  {marks[s['verdict']]} {s['name']:<18} {str(s['status'] or '-'):<10} "
            f"{inst:<10} {age_of(s['deployed_at']):>4} ago"
        )
        if s["verdict"] != "ok":
            line += color(f"   ← {s['reason']}", YELLOW if s["verdict"] == "warn" else RED)
        print(line)

    print(color("\n▸ HTTP health", CYAN))
    internal = [
        s["name"]
        for s in services
        if not s["url"] and s["name"] not in INFRA_SERVICES and s["verdict"] != "absent"
    ]
    for s in probes:
        code_ = s.get("http_status", 0)
        ok = 200 <= code_ < 300
        mark = color("✓", GREEN) if ok else color("✗", RED)
        print(f"  {mark} {s['name']:<18} {code_ or 'unreachable':<12} {s['url']}")
        warming = s.get("warming_up")
        for path, val in s.get("subsystems", []):
            if warming:
                print(color(f"      · {path} = {val}  (warming up after deploy)", DIM))
            else:
                print(color(f"      ! {path} = {val}", YELLOW))
    if internal:
        print(color(f"  · no public URL (control plane only): {', '.join(internal)}", DIM))

    scanned = [s for s in services if s.get("errors") is not None]
    if scanned:
        print(color("\n▸ Recent errors in logs", CYAN))
        for s in scanned:
            if s.get("log_error"):
                print(color(f"  · {s['name']}: {s['log_error']}", DIM))
                continue
            n = s.get("errors_total", 0)
            if not n:
                print(color(f"  ✓ {s['name']}: no errors in last {args.lines} lines", GREEN))
                continue
            print(color(f"  ✗ {s['name']}: {n} error line(s)", RED))
            for ln in s.get("errors", []):
                print(color(f"      {ln[:150]}", DIM))

    ci = ci_status()
    if ci:
        print(color("\n▸ CI (main, latest)", CYAN))
        for row in ci:
            print(f"  {row}")

    print()
    if down:
        print(color(f"✗ DOWN: {', '.join(s['name'] for s in down)}", RED + BOLD))
    if warn:
        print(color(f"! DEGRADED: {', '.join(s['name'] for s in warn)}", YELLOW + BOLD))
    if not down and not warn:
        print(color("✓ All services healthy.", GREEN + BOLD))
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
