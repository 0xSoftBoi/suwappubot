"""The 10,000-card sweep, and the graph that drives it.

A validator that never fires is decoration, so most of this file injects a
specific defect and asserts the sweep catches it. The end-to-end case renders
real cards through the real renderer.
"""

import importlib.util
import json
import os
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(REPO, "nft", "position-cards")


def _load(name):
    if CARDS not in sys.path:
        sys.path.insert(0, CARDS)
    spec = importlib.util.spec_from_file_location(name, os.path.join(CARDS, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def sweep():
    return _load("sweep")


@pytest.fixture(scope="module")
def graph_mod():
    return _load("graph")


@pytest.fixture(scope="module")
def ctx(sweep):
    cfg, registry = sweep.load_config(), sweep.load_registry()
    corpus = sweep.n_corpus({"config": cfg, "allocation": sweep.n_allocation({})})
    return cfg, registry, corpus


# ── the corpus actually covers the collection ────────────────────────────────


def test_allocation_is_cap_exact_and_covers_every_ticker(sweep):
    """tickerCap[i] is a hard on-chain limit. A corpus that oversells a ticker
    is testing a state the contract can never reach; one that undersells leaves
    real cards unexercised."""
    args = json.load(open(os.path.join(CARDS, "deploy_args.json")))
    alloc = sweep.n_allocation({})
    assert len(alloc) == sweep.SUPPLY
    counts = {t: alloc.count(t) for t in args["ticker_order"]}
    assert counts == dict(zip(args["ticker_order"], args["caps"]))


def test_corpus_hits_every_grade_boundary_exactly(sweep, ctx):
    """An off-by-one in grade_for lives precisely at min_return_bps. The corpus
    must contain each edge and the value one bp below it."""
    cfg, _, corpus = ctx
    seen = {r["ret_bps"] for r in corpus}
    for g in cfg["grades"]:
        edge = g["min_return_bps"]
        if edge == -1_000_000:
            continue
        assert edge in seen, f"grade edge {edge} never rendered"
        assert edge - 1 in seen, f"one bp below {edge} never rendered"
    assert None in seen, "the unpriced path is never exercised"


def test_every_ticker_and_grade_appears(sweep, ctx):
    """The collection covers the 35 PRICED tickers, not all 96 tokenized
    equities in the registry — a position on an unpriced ticker could never
    show a return, which is the whole card."""
    cfg, registry, corpus = ctx
    priced = set(json.load(open(os.path.join(CARDS, "deploy_args.json")))["ticker_order"])
    assert len(priced) == 35 and priced < set(registry)
    assert {r["ticker"] for r in corpus} == priced
    grades = set()
    for r in corpus:
        if r["ret_bps"] is None:
            grades.add("Unpriced")
        else:
            grades.add(sweep.grade_for(cfg, r["ret_bps"])["name"])
    assert grades == {g["name"] for g in cfg["grades"]} | {"Unpriced"}


# ── the validators bite ──────────────────────────────────────────────────────


def _one(sweep, ctx, token_id=1):
    cfg, registry, corpus = ctx
    row = corpus[token_id - 1]
    svg, meta = sweep.render_one(cfg, registry, row)
    return cfg, registry, row, svg, meta


def test_a_clean_card_reports_nothing(sweep, ctx):
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    assert sweep.validate(cfg, registry, row, svg, meta) == []


def test_malformed_svg_is_caught(sweep, ctx):
    """An unescaped & in a company name is the classic way a whole collection
    renders as a broken-image icon in every wallet at once."""
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    broken = svg.replace("<text", "<text foo=bar", 1)
    problems = sweep.validate(cfg, registry, row, broken, meta)
    assert any("not well-formed" in p for p in problems), problems


def test_a_wrong_grade_is_caught(sweep, ctx):
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    for a in meta["attributes"]:
        if a["trait_type"] == "Grade":
            a["value"] = "Moonshot" if a["value"] != "Moonshot" else "Underwater"
    assert any("grade" in p for p in sweep.validate(cfg, registry, row, svg, meta))


def test_a_wrong_badge_is_caught(sweep, ctx):
    """Rank 1 must carry Founder. Silently dropping it devalues the earliest
    mints, which are the ones sold on being early."""
    cfg, registry, row, svg, meta = _one(sweep, ctx, token_id=1)
    meta["attributes"] = [a for a in meta["attributes"] if a["trait_type"] != "Badge"]
    assert any("badge" in p for p in sweep.validate(cfg, registry, row, svg, meta))


def test_a_mismatched_ticker_trait_is_caught(sweep, ctx):
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    for a in meta["attributes"]:
        if a["trait_type"] == "Ticker":
            a["value"] = "ZZZZ"
    assert any("Ticker trait" in p for p in sweep.validate(cfg, registry, row, svg, meta))


def test_a_relative_url_is_caught(sweep, ctx):
    """A relative image URL resolves against the marketplace's own domain, so
    every card 404s."""
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    meta["image"] = "/card/1.svg"
    assert any("non-absolute" in p for p in sweep.validate(cfg, registry, row, svg, meta))


def test_a_missing_disclaimer_is_caught(sweep, ctx):
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    meta["description"] = "A position on something."
    assert any("disclaimer" in p for p in sweep.validate(cfg, registry, row, svg, meta))


def test_equity_language_is_caught(sweep, ctx):
    """These are collectibles. A card that reads as a claim on a real security
    is the one failure mode that is not fixable after the mint."""
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    meta["description"] += " Entitles the holder to shareholder voting rights."
    problems = sweep.validate(cfg, registry, row, svg, meta)
    assert any("compliance" in p for p in problems), problems


def test_the_disclaimer_itself_does_not_trip_the_compliance_check(sweep, ctx):
    """It is the NEGATION of those phrases — 'confers no shareholder or voting
    rights'. Scanning it fired on all 10,000 cards and would have buried a real
    hit in the noise."""
    cfg, registry, row, svg, meta = _one(sweep, ctx)
    assert cfg["collection"]["compliance"] in meta["description"]
    assert "shareholder" in cfg["collection"]["compliance"]
    assert sweep.validate(cfg, registry, row, svg, meta) == []


def test_unpriced_cards_must_not_claim_a_return(sweep, ctx):
    cfg, registry, corpus = ctx
    row = next(r for r in corpus if r["ret_bps"] is None)
    svg, meta = sweep.render_one(cfg, registry, row)
    assert sweep.validate(cfg, registry, row, svg, meta) == []
    traits = {a["trait_type"]: a["value"] for a in meta["attributes"]}
    assert traits["Grade"] == "Unpriced" and "Return %" not in traits


# ── rendering is deterministic and per-token ─────────────────────────────────


def test_rendering_is_byte_identical_across_calls(sweep, ctx):
    """A marketplace caches the image it first fetched. If the next render
    differs byte for byte, the cached art and the live art drift apart."""
    cfg, registry, corpus = ctx
    for tid in (1, 501, 4_213, 9_999):
        a, _ = sweep.render_one(cfg, registry, corpus[tid - 1])
        b, _ = sweep.render_one(cfg, registry, corpus[tid - 1])
        assert a == b, f"#{tid} render is not deterministic"


def test_no_two_cards_in_a_shard_are_byte_identical(sweep, ctx):
    """Every card carries its own rank, so identical bytes mean the id never
    reached the canvas."""
    cfg, registry, corpus = ctx
    seen = {}
    for row in corpus[:300]:
        svg, _ = sweep.render_one(cfg, registry, row)
        seen.setdefault(svg, []).append(row["token_id"])
    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    assert not dupes, f"identical cards: {list(dupes.values())[:3]}"


# ── the graph runner ─────────────────────────────────────────────────────────


def test_graph_caches_by_content_and_reruns_only_what_changed(graph_mod, tmp_path):
    calls = {"a": 0, "b": 0}

    def build(version_b):
        g = graph_mod.Graph(cache_dir=str(tmp_path))
        g.node("a", [], lambda _: (calls.__setitem__("a", calls["a"] + 1), 1)[1])
        g.node(
            "b",
            ["a"],
            lambda i: (calls.__setitem__("b", calls["b"] + 1), i["a"] + 1)[1],
            version=version_b,
        )
        return g

    assert build("1").run("b")["b"] == 2
    assert calls == {"a": 1, "b": 1}
    build("1").run("b")  # nothing changed: both cached
    assert calls == {"a": 1, "b": 1}
    build("2").run("b")  # b's version bumped: b re-runs, a does not
    assert calls == {"a": 1, "b": 2}


def test_graph_rejects_cycles_and_unknown_nodes(graph_mod):
    g = graph_mod.Graph()
    g.node("x", ["y"], lambda i: 1)
    g.node("y", ["x"], lambda i: 1)
    with pytest.raises(graph_mod.NodeError, match="cycle"):
        g.run("x")

    g2 = graph_mod.Graph()
    g2.node("x", ["nope"], lambda i: 1)
    with pytest.raises(graph_mod.NodeError, match="unknown node"):
        g2.run("x")


def test_graph_survives_a_corrupt_cache_entry(graph_mod, tmp_path):
    """A run killed mid-write must cost one node, not wedge every future run."""
    ran = {"n": 0}
    g = graph_mod.Graph(cache_dir=str(tmp_path))
    g.node("a", [], lambda _: (ran.__setitem__("n", ran["n"] + 1), 7)[1])
    assert g.run("a")["a"] == 7
    for f in os.listdir(tmp_path):
        open(os.path.join(tmp_path, f), "w").write("{not json")
    g2 = graph_mod.Graph(cache_dir=str(tmp_path))
    g2.node("a", [], lambda _: (ran.__setitem__("n", ran["n"] + 1), 7)[1])
    assert g2.run("a")["a"] == 7
    assert ran["n"] == 2


def test_graph_resolves_every_declared_dependency(sweep):
    """`corpus` does not depend on `registry`, so running it alone left the
    registry unresolved and the sweep crashed on out['registry']."""
    g = sweep.build_graph(workers=2)
    names = {name for name, _, _ in g.describe("inputs")}
    assert {"config", "registry", "allocation", "corpus", "inputs"} <= names
