"""Drift guards for chain configuration.

Chain metadata is duplicated across several maps in two stacks: the canonical
``CHAINS`` dict, the per-chain ``*_rpc_url`` settings fields, one chain-id map
per aggregator, and the TypeScript mirrors in api-ts and webapp. Nothing forced
those to agree, and they drifted:

  * ``aurora``, ``blast`` and ``ink`` were keyed in aggregator chain-id maps with
    no ``CHAINS`` entry behind them — a quote could be produced for a chain with
    no RPC and no explorer.
  * The TS explorer maps fell behind ``CHAINS`` and papered over the gap with an
    ``|| 'https://etherscan.io'`` default, so a tx on any uncovered chain
    rendered a link to Ethereum, where that hash does not exist.

These tests make that class of drift fail loudly instead of silently. They are
pure config assertions — no network, no DB.
"""

import ast
import json
import re
from pathlib import Path

import pytest

from bot.config.chains import (
    CHAIN_NAME_ALIASES,
    CHAINS,
    ChainType,
    resolve_chain_name,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------
# 1. Aggregator chain-id maps must not reference chains that do not exist
# --------------------------------------------------------------------------


def _aggregator_maps():
    """(label, mapping) for every provider map keyed by canonical chain name.

    Imported lazily inside the fixture so that one provider module failing to
    import does not blank out the whole test file.
    """
    from bot.services.across_api import ACROSS_CHAIN_IDS
    from bot.services.bridge.usdt0_api import OFT_ADDRESSES
    from bot.services.kyberswap_api import KYBERSWAP_CHAIN_SLUGS
    from bot.services.okx_dex_api import OKX_CHAIN_IDS
    from bot.services.oneinch_api import ONEINCH_CHAIN_IDS
    from bot.services.socket_api import SOCKET_CHAIN_IDS
    from bot.services.wormhole_api import WORMHOLE_CHAIN_IDS
    from bot.services.zerox_api import ZEROX_CHAIN_IDS

    return [
        ("ONEINCH_CHAIN_IDS", ONEINCH_CHAIN_IDS),
        ("OKX_CHAIN_IDS", OKX_CHAIN_IDS),
        ("ZEROX_CHAIN_IDS", ZEROX_CHAIN_IDS),
        ("SOCKET_CHAIN_IDS", SOCKET_CHAIN_IDS),
        ("KYBERSWAP_CHAIN_SLUGS", KYBERSWAP_CHAIN_SLUGS),
        ("ACROSS_CHAIN_IDS", ACROSS_CHAIN_IDS),
        ("WORMHOLE_CHAIN_IDS", WORMHOLE_CHAIN_IDS),
        ("USDT0_OFT_ADDRESSES", OFT_ADDRESSES),
    ]


def test_aggregator_maps_reference_only_known_chains():
    """Every provider-map key must have a ChainConfig behind it.

    An orphaned key is dead weight at best: the router can score a quote for a
    chain the bot cannot build an RPC connection to, sign for, or link to an
    explorer.
    """
    orphans = {}
    for label, mapping in _aggregator_maps():
        missing = sorted(k for k in mapping if k not in CHAINS)
        if missing:
            orphans[label] = missing

    assert not orphans, (
        "Aggregator maps reference chains absent from CHAINS: "
        f"{json.dumps(orphans, indent=2)}\n"
        "Either add a ChainConfig for them in bot/config/chains.py or remove "
        "the provider entries."
    )


# --------------------------------------------------------------------------
# 2. Every chain needs a resolvable, non-empty RPC settings field
# --------------------------------------------------------------------------


def test_every_chain_has_an_rpc_settings_field():
    """bot/handlers/admin.py resolves RPCs with getattr(settings, env.lower()).

    That getattr has a None default, so a chain whose settings field was never
    declared degrades to "no RPC" silently rather than failing at import.
    """
    settings = pytest.importorskip(
        "bot.config.settings", reason="pydantic-settings not installed"
    ).settings

    missing, empty = [], []
    for name, chain in CHAINS.items():
        attr = chain.rpc_url_env.lower()
        if not hasattr(settings, attr):
            missing.append(f"{name} -> settings.{attr}")
            continue
        # A primary that is intentionally operator-supplied (e.g. an Alchemy key)
        # is fine as long as a keyless `<chain>_rpc_fallback_url` backs it, which
        # is how starknet is wired. What must never happen is *no* usable RPC.
        fallback_attr = f"{attr.removesuffix('_url')}_fallback_url"
        effective = (getattr(settings, attr, None) or "") or (
            getattr(settings, fallback_attr, None) or ""
        )
        if not effective.strip():
            empty.append(f"{name} -> settings.{attr} (and no {fallback_attr})")

    assert not missing, "Chains with no RPC settings field: " + ", ".join(missing)
    assert not empty, "Chains with no usable RPC URL: " + ", ".join(empty)


# --------------------------------------------------------------------------
# 3. Aliases must resolve, and must never shadow a canonical chain
# --------------------------------------------------------------------------


def test_chain_aliases_resolve_to_real_chains():
    dangling = sorted({v for v in CHAIN_NAME_ALIASES.values() if v not in CHAINS})
    assert not dangling, f"CHAIN_NAME_ALIASES point at unknown chains: {dangling}"


def test_chain_aliases_do_not_shadow_canonical_names():
    """An alias key equal to a real chain key is a live mis-routing hazard.

    resolve_chain_name() checks CHAINS first, so such an alias is dead today —
    but it encodes a contradiction, and any reordering of that lookup would
    start routing a real chain's name to a different chain.
    """
    collisions = sorted(set(CHAIN_NAME_ALIASES) & set(CHAINS))
    assert not collisions, f"Aliases collide with canonical chain keys: {collisions}"


@pytest.mark.parametrize("alias", sorted(CHAIN_NAME_ALIASES))
def test_each_alias_round_trips(alias):
    assert resolve_chain_name(alias) == CHAIN_NAME_ALIASES[alias]


@pytest.mark.parametrize("chain", sorted(CHAINS))
def test_canonical_names_resolve_to_themselves(chain):
    assert resolve_chain_name(chain) == chain


# --------------------------------------------------------------------------
# 4. Every ChainConfig must carry the fields the UI and router depend on
# --------------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(CHAINS))
def test_chain_config_fields_are_populated(name):
    chain = CHAINS[name]

    assert chain.name == name, f"CHAINS key {name!r} disagrees with .name {chain.name!r}"
    assert chain.explorer_url.startswith(
        "https://"
    ), f"{name}: explorer_url must be https:// (got {chain.explorer_url!r})"
    assert not chain.explorer_url.endswith(
        "/"
    ), f"{name}: explorer_url must not have a trailing slash — callers append '/tx/...'"
    assert chain.native_token.strip(), f"{name}: native_token is empty"
    assert chain.native_decimals > 0, f"{name}: native_decimals must be > 0"
    assert chain.rpc_url_env.strip(), f"{name}: rpc_url_env is empty"


def test_chain_ids_are_unique():
    """get_chain_by_id() linear-scans and returns the first match.

    A duplicate chain_id would make one of the two chains permanently
    unreachable by id, with no error raised anywhere.
    """
    seen = {}
    dupes = []
    for name, chain in CHAINS.items():
        if chain.chain_id in seen:
            dupes.append(f"{chain.chain_id}: {seen[chain.chain_id]} and {name}")
        seen[chain.chain_id] = name
    assert not dupes, "Duplicate chain_id values: " + "; ".join(dupes)


# --------------------------------------------------------------------------
# 5. Cross-stack: the TS mirrors must cover every EVM chain
# --------------------------------------------------------------------------

API_TS_CHAINS = REPO_ROOT / "api-ts" / "src" / "config" / "chains.ts"
WEBAPP_CHAINS = REPO_ROOT / "webapp" / "src" / "lib" / "chains.ts"


def _ts_object_literal(path: Path, const_name: str) -> str:
    """Return the raw body of a top-level `const NAME ... = { ... }` literal.

    These maps are plain literals with no computation, so a brace-matched slice
    is enough; anything cleverer would need a JS parser.
    """
    src = path.read_text()
    match = re.search(rf"{const_name}[^=]*=\s*\{{", src)
    if not match:
        pytest.fail(f"{path.name}: could not find `{const_name}`")
    start = match.end() - 1
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1 : i]  # noqa: E203
    pytest.fail(f"{path.name}: unbalanced braces in `{const_name}`")


def _evm_chains():
    return {n: c for n, c in CHAINS.items() if c.chain_type == ChainType.EVM}


@pytest.mark.parametrize(
    "path,const_name,pattern",
    [
        (API_TS_CHAINS, "CHAIN_ID_TO_KEY", r"(\d+):\s*'([^']+)'"),
        (API_TS_CHAINS, "EXPLORER_URLS", r"(\d+):\s*'([^']+)'"),
        (WEBAPP_CHAINS, "CHAIN_ID_TO_KEY", r"'(\d+)':\s*'([^']+)'"),
    ],
)
def test_ts_numeric_chain_maps_cover_every_evm_chain(path, const_name, pattern):
    if not path.exists():
        pytest.skip(f"{path} not present")

    entries = dict(re.findall(pattern, _ts_object_literal(path, const_name)))
    missing = sorted(
        f"{name} ({c.chain_id})"
        for name, c in _evm_chains().items()
        if str(c.chain_id) not in entries
    )
    assert not missing, (
        f"{path.name} `{const_name}` is missing EVM chains present in the Python "
        f"CHAINS: {missing}"
    )


def test_api_ts_explorer_urls_match_python():
    if not API_TS_CHAINS.exists():
        pytest.skip("api-ts chains.ts not present")

    entries = dict(
        re.findall(r"(\d+):\s*'([^']+)'", _ts_object_literal(API_TS_CHAINS, "EXPLORER_URLS"))
    )
    mismatched = [
        f"{name}: api-ts={entries[str(c.chain_id)]!r} python={c.explorer_url!r}"
        for name, c in _evm_chains().items()
        if str(c.chain_id) in entries and entries[str(c.chain_id)] != c.explorer_url
    ]
    assert not mismatched, "Explorer URL drift between api-ts and Python: " + "; ".join(mismatched)


def test_webapp_chain_display_covers_every_chain():
    """CHAIN_DISPLAY is keyed by chain name and covers non-EVM chains too."""
    if not WEBAPP_CHAINS.exists():
        pytest.skip("webapp chains.ts not present")

    body = _ts_object_literal(WEBAPP_CHAINS, "CHAIN_DISPLAY")
    keys = set(re.findall(r"^\s*'?([A-Za-z0-9-]+)'?:\s*\{", body, re.M))
    missing = sorted(set(CHAINS) - keys)
    assert not missing, f"webapp CHAIN_DISPLAY is missing chains: {missing}"


def test_webapp_explorer_urls_match_python():
    if not WEBAPP_CHAINS.exists():
        pytest.skip("webapp chains.ts not present")

    body = _ts_object_literal(WEBAPP_CHAINS, "CHAIN_DISPLAY")
    entries = dict(
        re.findall(r"^\s*'?([A-Za-z0-9-]+)'?:\s*\{[^}]*explorerUrl:\s*'([^']+)'", body, re.M)
    )
    mismatched = [
        f"{name}: webapp={entries[name]!r} python={c.explorer_url!r}"
        for name, c in CHAINS.items()
        if name in entries and entries[name] != c.explorer_url
    ]
    assert not mismatched, "Explorer URL drift between webapp and Python: " + "; ".join(mismatched)


def test_python_chains_file_parses():
    """Cheap guard: chains.py is edited by hand often and is imported at boot."""
    ast.parse((REPO_ROOT / "bot" / "config" / "chains.py").read_text())
