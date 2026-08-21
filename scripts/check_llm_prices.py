#!/usr/bin/env python3
"""Check `bot/config/llm_models.py` MODEL_CATALOG prices for drift.

Hand-maintained LLM prices go stale fast — two model ids in this catalog
were already dead within a session of first authoring it (see
docs/research/llm-credits/04-metering-architecture.md §1-2). This script
cross-checks our per-1M-token prices against LiteLLM's community-maintained
`model_prices_and_context_window.json` cost map, which is importable
standalone (`pip install litellm`) without running the LiteLLM proxy.

`litellm` is an OPTIONAL dependency of THIS SCRIPT ONLY — it is never
imported at bot runtime and is deliberately NOT in requirements.txt. If it
isn't installed, this script prints instructions and exits 0 (nothing to
compare, not a failure of the bot itself) unless --require-litellm is passed
(for a CI/cron lane that wants a hard failure on missing tooling).

Usage:
    python3 scripts/check_llm_prices.py                  # default 5% threshold
    python3 scripts/check_llm_prices.py --threshold 10    # looser threshold
    python3 scripts/check_llm_prices.py --require-litellm # fail if litellm absent
    python3 scripts/check_llm_prices.py --strict-completeness  # fail on models
                                        # LiteLLM doesn't know (the signal a
                                        # model was retired)

Exit codes: 0 = no drift over threshold (or litellm unavailable and neither
                --require-litellm nor --strict-completeness was passed),
            1 = drift found; a model missing from LiteLLM under
                --strict-completeness; or litellm missing under either gate.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Bundled cost map avoids a network call to LiteLLM's GitHub-hosted JSON.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

# Importing the catalog pulls in bot.config.settings, whose pydantic model
# requires real bot secrets. This script only reads a static price table and
# never talks to Telegram, the DB, or any provider, so satisfy the validator
# with obvious placeholders rather than forcing operators to source a full
# production env just to diff prices.
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "price-check-placeholder")
os.environ.setdefault("ENCRYPTION_KEY", "price-check-placeholder-32bytes!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.config.llm_models import (  # noqa: E402
    MODEL_CATALOG,
    PRICE_TABLE_MAX_AGE_DAYS,
    assert_price_table_fresh,
    price_table_age_days,
)

# Candidate LiteLLM cost-map key prefixes to try per our provider name, since
# LiteLLM's naming doesn't always match the bare wire model id.
_PROVIDER_PREFIXES = {
    "anthropic": ["", "anthropic/"],
    "openai": [""],
    "xai": ["xai/", ""],
    "gemini": ["gemini/", ""],
    "qwen": ["qwen/", "dashscope/", ""],
    "kimi": ["moonshot/", "kimi/", ""],
    "deepseek": ["deepseek/", ""],
    "groq": ["groq/", ""],
    # model_id already carries the upstream slug (e.g. "anthropic/claude-sonnet-5"),
    # so LiteLLM's openrouter/<upstream-slug> key needs just the "openrouter/" prefix.
    "openrouter": ["openrouter/", ""],
}


def load_litellm():
    try:
        import litellm  # type: ignore
    except ImportError:
        return None
    except Exception:
        # Broken/partial litellm install (e.g. a native-extension conflict)
        # is functionally "not available" for our purposes too — don't crash
        # the whole check over an optional dependency's install problem.
        return None
    return litellm


def lookup_litellm_price(litellm_mod, provider: str, model_id: str):
    """Best-effort lookup of a catalog entry's per-1M input/output USD price
    in LiteLLM's cost map. Returns (input_usd_per_1m, output_usd_per_1m) or
    None if no candidate key matched."""
    cost_map = getattr(litellm_mod, "model_cost", {})
    for prefix in _PROVIDER_PREFIXES.get(provider, [""]):
        entry = cost_map.get(f"{prefix}{model_id}")
        if entry is None:
            continue
        in_per_token = entry.get("input_cost_per_token")
        out_per_token = entry.get("output_cost_per_token")
        if in_per_token is None or out_per_token is None:
            continue
        return in_per_token * 1_000_000, out_per_token * 1_000_000
    return None


def pct_delta(ours: float, theirs: float) -> float:
    """Percent delta of `ours` vs `theirs`. Only 0-vs-0 counts as "no drift" —
    a zero LiteLLM price against a non-zero catalog price (or vice versa) is
    infinite drift, not silently-passing 0%."""
    if theirs == 0:
        return 0.0 if ours == 0 else float("inf")
    return (ours - theirs) / theirs * 100


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold", type=float, default=5.0, help="Max allowed %% delta (default 5.0)"
    )
    parser.add_argument(
        "--require-litellm",
        action="store_true",
        help="Exit non-zero if litellm isn't installed, instead of skipping",
    )
    parser.add_argument(
        "--strict-completeness",
        action="store_true",
        help=(
            "Exit non-zero if any catalog model is missing from LiteLLM's cost map "
            "(default: warn only, so a retired/renamed model doesn't silently bypass "
            "the drift gate)"
        ),
    )
    args = parser.parse_args()

    fresh = assert_price_table_fresh()
    age = price_table_age_days()
    print(f"PRICE_TABLE_VERIFIED age: {age} days (max {PRICE_TABLE_MAX_AGE_DAYS})")
    print("  " + ("OK: within freshness window" if fresh else "STALE: re-verify prices"))
    print()

    litellm_mod = load_litellm()
    if litellm_mod is None:
        msg = (
            "litellm not installed — skipping price cross-check.\n"
            "Install it locally to run this check: pip install litellm\n"
            "(litellm is NOT a bot runtime dependency; it's only used by this script.)"
        )
        print(msg)
        # --strict-completeness selects a hard gate; skipping every check
        # because the optional dep is missing would make that gate a no-op.
        return 1 if (args.require_litellm or args.strict_completeness) else 0

    rows = []
    drift_found = False
    expected_notes: list = []
    missing_found = False
    missing_count = 0
    checked_count = 0
    for name, spec in sorted(MODEL_CATALOG.items()):
        result = lookup_litellm_price(litellm_mod, spec.provider, spec.model_id)
        if result is None:
            rows.append((name, spec.model_id, spec.price_per_1m_input_usd, None, None, "MISSING"))
            missing_found = True
            missing_count += 1
            continue
        checked_count += 1
        lite_in, lite_out = result
        d_in = pct_delta(spec.price_per_1m_input_usd, lite_in)
        d_out = pct_delta(spec.price_per_1m_output_usd, lite_out)
        over = max(abs(d_in), abs(d_out)) > args.threshold
        if over and spec.price_deviation_reason:
            # A documented, deliberate deviation (e.g. pricing at a scheduled
            # post-promo rate so we never under-charge). Surfaced, not failed.
            flag = "EXPECTED"
            expected_notes.append(f"  {name}: {spec.price_deviation_reason}")
        elif over:
            flag = "DRIFT"
            drift_found = True
        else:
            flag = "ok"
        rows.append((name, spec.model_id, spec.price_per_1m_input_usd, lite_in, d_in, flag))
        rows.append(
            ("  (output)", spec.model_id, spec.price_per_1m_output_usd, lite_out, d_out, flag)
        )

    header = f"{'model':<22}{'wire id':<26}{'ours':>10}{'litellm':>10}{'delta%':>10}  flag"
    print(header)
    print("-" * len(header))
    for name, model_id, ours, theirs, delta, flag in rows:
        theirs_s = f"{theirs:.4f}" if theirs is not None else "-"
        delta_s = f"{delta:+.1f}" if delta is not None else "-"
        print(f"{name:<22}{model_id:<26}{ours:>10.4f}{theirs_s:>10}{delta_s:>10}  {flag}")

    print()
    total = checked_count + missing_count
    if missing_found:
        print(
            f"Summary: {checked_count}/{total} catalog models checked against LiteLLM's cost "
            f"map, {missing_count} UNCHECKED (missing from the cost map — "
            f"{'FAILING' if args.strict_completeness else 'not failing the gate'} "
            f"the {args.threshold}% drift threshold check for them)."
        )
    if expected_notes:
        print("\nEXPECTED deviations (documented in llm_models.py, not failures):")
        for note in expected_notes:
            print(note)
    if drift_found:
        print(f"DRIFT: one or more prices differ from LiteLLM by more than {args.threshold}%.")
        return 1
    if missing_found and args.strict_completeness:
        print(
            f"MISSING: {missing_count} model(s) not found in LiteLLM's cost map and "
            "--strict-completeness was passed."
        )
        return 1

    print(f"No drift over {args.threshold}% threshold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
