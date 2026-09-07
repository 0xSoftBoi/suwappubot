"""The warmer that runs between publishes."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools import publish_ipfs as ipfs
from tools import warm_ipfs as warm


@pytest.fixture(autouse=True)
def _no_registry(monkeypatch):
    """No test asks Ethereum what the name points at. The run does, before
    it warms anything, and four public endpoints at a 20-second timeout is
    not something a test suite should be doing.
    """
    monkeypatch.setattr(warm, "contenthash", lambda *_a, **_kw: "")


def build(root: Path, marks: dict[str, list[str]] | None = None) -> Path:
    """A `dist/` with a boot set and, optionally, some compiled marks."""
    (root / "index.html").write_text("<!doctype html>")
    (root / "main.dart.js").write_text("//")
    for chain, files in (marks or {}).items():
        directory = root / "curve" / "tokens" / chain
        directory.mkdir(parents=True, exist_ok=True)
        for name in files:
            (directory / name).write_bytes(b"\x89PNG")
    return root


def options(**kw):
    """The parsed arguments, with the defaults the CLI would supply."""
    base = {
        "tiers": warm.DEFAULT_TIERS,
        "chains": [],
        "boot_only": False,
        "boot": True,
        "all_marks": False,
        "dist": Path("."),
        "chunk": warm.CHUNK,
        "workers": warm.MARK_WORKERS,
        "deadline": warm.WARM_DEADLINE,
        "show": 20,
    }
    base.update(kw)
    return type("Options", (), base)()


# -- what gets asked for ---------------------------------------------------


def test_the_marks_are_what_publishing_leaves_out(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@40.png", "0xaa@80.png"]})

    assert ipfs.boot_files(root) == ["index.html", "main.dart.js"]
    assert warm.mark_files(root, (40, 80), []) == [
        "curve/tokens/xdai/0xaa@40.png",
        "curve/tokens/xdai/0xaa@80.png",
    ]


def test_only_the_tiers_asked_for(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": [f"0xaa@{t}.png" for t in (20, 40, 80, 160)]})

    assert warm.mark_files(root, (80,), []) == ["curve/tokens/xdai/0xaa@80.png"]
    assert len(warm.mark_files(root, (20, 40, 80, 160), [])) == 4


def test_a_chain_filter_narrows_it(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png"], "ethereum": ["0xbb@80.png"]})

    assert warm.mark_files(root, (80,), ["xdai"]) == ["curve/tokens/xdai/0xaa@80.png"]
    assert len(warm.mark_files(root, (80,), [])) == 2


def test_the_order_is_stable_across_runs(tmp_path: Path) -> None:
    root = build(tmp_path, {"b": ["0x02@80.png", "0x01@80.png"], "a": ["0x03@80.png"]})

    assert warm.mark_files(root, (80,), []) == warm.mark_files(root, (80,), [])
    assert warm.mark_files(root, (80,), []) == [
        "curve/tokens/a/0x03@80.png",
        "curve/tokens/b/0x01@80.png",
        "curve/tokens/b/0x02@80.png",
    ]


def test_a_build_with_no_marks_compiled_is_not_an_error(tmp_path: Path) -> None:
    assert warm.mark_files(build(tmp_path), (80,), []) == []


def test_the_boot_set_is_part_of_the_default_run(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png"]})

    assert warm.plan(root, options(all_marks=True)) == [
        "index.html",
        "main.dart.js",
        "curve/tokens/xdai/0xaa@80.png",
    ]
    assert warm.plan(root, options(boot=False, all_marks=True)) == [
        "curve/tokens/xdai/0xaa@80.png"
    ]


def test_the_bundles_are_warmed_and_the_loose_marks_are_not(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png", "marks@80.bin", "marks@80.json"]})

    assert warm.plan(root, options(boot=False)) == [
        "curve/tokens/xdai/marks@80.bin",
        "curve/tokens/xdai/marks@80.json",
    ]
    assert "curve/tokens/xdai/0xaa@80.png" in warm.plan(root, options(all_marks=True))


def test_the_bundles_come_before_the_marks_they_back(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png", "marks@80.bin", "marks@80.json"]})

    paths = warm.plan(root, options(all_marks=True))

    assert paths.index("curve/tokens/xdai/marks@80.bin") < paths.index(
        "curve/tokens/xdai/0xaa@80.png"
    )


def test_the_boot_set_comes_first(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png"]})

    paths = warm.plan(root, options(all_marks=True))

    assert paths[:2] == ["index.html", "main.dart.js"]
    assert paths[-1] == "curve/tokens/xdai/0xaa@80.png"


def test_either_half_can_be_asked_for_alone(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["0xaa@80.png"]})

    assert warm.plan(root, options(boot_only=True)) == ["index.html", "main.dart.js"]
    assert warm.plan(root, options(boot=False, all_marks=True)) == [
        "curve/tokens/xdai/0xaa@80.png"
    ]


# -- tiers -----------------------------------------------------------------


def test_tiers_are_read_the_way_a_person_writes_them() -> None:
    assert warm.parse_tiers("80") == (80,)
    assert warm.parse_tiers("40,80") == (40, 80)
    assert warm.parse_tiers("40, 80") == (40, 80)


def test_all_means_whatever_the_app_compiles() -> None:
    from ui.assets import MARK_TIERS

    assert warm.parse_tiers("all") == MARK_TIERS
    assert set(warm.DEFAULT_TIERS) <= set(MARK_TIERS)


# -- the gateways ----------------------------------------------------------


def test_both_gateways_are_warmed_by_default() -> None:
    assert "https://curve.eth.limo" in warm.GATEWAYS
    assert "https://curve.eth.link" in warm.GATEWAYS


def test_it_pulls_whole_files_rather_than_sampling(monkeypatch) -> None:
    seen: dict = {}

    def fake_verify(_cid, paths, **kw):
        seen.update(kw)
        seen["paths"] = paths
        return {}

    monkeypatch.setattr(warm, "verify", fake_verify)
    warm.warm_one("https://curve.eth.limo", ["index.html"], options(deadline=1, show=5))

    assert seen["whole"] is True
    assert seen["workers"] == warm.MARK_WORKERS
    assert seen["gateway"] == "https://curve.eth.limo"


def test_a_gateway_that_will_not_serve_something_is_reported(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        warm, "verify", lambda _c, _p, **_k: {"main.dart.wasm": ("unfound", 504, 17.6)}
    )
    bad = warm.warm_one("https://curve.eth.limo", ["main.dart.wasm"], options(deadline=1, show=5))

    out = capsys.readouterr().out
    assert bad
    assert "main.dart.wasm" in out and "504" in out


def test_a_long_failure_list_is_truncated(monkeypatch, capsys) -> None:
    failures = {f"curve/tokens/xdai/{i}@80.png": ("unfound", 504, 17.0) for i in range(50)}
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: failures)

    warm.warm_one("https://x", list(failures), options(deadline=1, show=5))

    out = capsys.readouterr().out
    assert "... and 45 more" in out


# -- the script itself -----------------------------------------------------


def _warmed_by(monkeypatch, root: Path, *flags: str) -> list[str]:
    """Every path one run of the CLI actually asks for."""
    asked: list[str] = []

    def watch(_cid, paths, **_kw):
        asked.extend(paths)
        return {}

    monkeypatch.setattr(warm, "verify", watch)
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), *flags])
    warm.main()
    return asked


def test_running_it_with_no_flags_warms_what_a_visitor_fetches(
    monkeypatch, tmp_path: Path
) -> None:
    root = with_chain_marks(build(tmp_path, {"xdai": ["marks@80.bin"]}), ["ethereum"])

    warmed = _warmed_by(monkeypatch, root)

    assert "index.html" in warmed                     # it loads at all
    assert "curve/tokens/xdai/marks@80.bin" in warmed  # the coins
    assert "curve/chains/marks@80.bin" in warmed       # the networks


def test_the_boot_set_can_still_be_skipped(monkeypatch, tmp_path: Path) -> None:
    root = with_chain_marks(build(tmp_path), ["ethereum"])

    warmed = _warmed_by(monkeypatch, root, "--no-boot")

    assert "curve/chains/marks@80.bin" in warmed, "it still warms the marks"
    assert "index.html" not in warmed


def test_no_build_says_so_rather_than_warming_nothing(monkeypatch, tmp_path: Path, capsys) -> None:
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(tmp_path / "gone")])

    assert warm.main() == 2
    assert "no build" in capsys.readouterr().out


def test_everything_served_exits_zero(monkeypatch, tmp_path: Path) -> None:
    root = build(tmp_path)
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--boot-only"])
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: {})

    assert warm.main() == 0


def test_anything_left_cold_exits_nonzero(monkeypatch, tmp_path: Path, capsys) -> None:
    root = build(tmp_path)
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--boot-only"])
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: {"index.html": ("unfound", 504, 17.0)})

    assert warm.main() == 1
    assert "drifted" in capsys.readouterr().out


def test_an_interrupt_is_a_supported_way_to_leave(monkeypatch, tmp_path: Path, capsys) -> None:
    root = build(tmp_path)
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--boot-only"])

    def interrupt(*_a, **_k):
        raise KeyboardInterrupt

    monkeypatch.setattr(warm, "verify", interrupt)

    assert warm.main() == 130
    assert "stays warm" in capsys.readouterr().out


# -- reporting while it works ----------------------------------------------


def test_progress_is_reported_while_it_works_not_at_the_end(monkeypatch, capsys) -> None:
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: {})
    paths = [f"f{i}.png" for i in range(200)]

    warm.warm_one("https://x", paths, options(chunk=64))

    bars = [line for line in capsys.readouterr().out.splitlines() if "retrievable" in line]
    assert len(bars) >= 4  # 200 files in batches of 64, not one line at the end


def test_the_batches_cover_every_file_exactly_once() -> None:
    assert warm.batched([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert warm.batched([], 64) == []
    assert sum(len(b) for b in warm.batched(list(range(3435)), 64)) == 3435


def test_every_batch_is_asked_for(monkeypatch) -> None:
    asked: list[str] = []

    def fake_verify(_cid, paths, **_kw):
        asked.extend(paths)
        return {}

    monkeypatch.setattr(warm, "verify", fake_verify)
    paths = [f"f{i}.png" for i in range(150)]

    warm.warm_one("https://x", paths, options(chunk=64))

    assert asked == paths


def test_one_unfindable_file_does_not_hold_up_the_rest(monkeypatch) -> None:
    seen: list[float] = []

    def fake_verify(_cid, _paths, **kw):
        seen.append(kw["deadline"])
        return {}

    monkeypatch.setattr(warm, "verify", fake_verify)
    warm.warm_one("https://x", ["a", "b"], options(chunk=1, deadline=7200.0))

    assert seen == [warm.CHUNK_DEADLINE, warm.CHUNK_DEADLINE]
    assert warm.CHUNK_DEADLINE < 7200.0


def test_the_run_stops_at_its_own_deadline(monkeypatch, capsys) -> None:
    clock = iter([0.0, 0.0, 10_000.0, 10_000.0, 10_000.0])
    monkeypatch.setattr(warm.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: {})

    warm.warm_one("https://x", ["a", "b", "c", "d"], options(chunk=2, deadline=60.0))

    assert "not reached" in capsys.readouterr().out


def test_the_size_is_stated_up_front(monkeypatch, tmp_path, capsys) -> None:
    root = build(tmp_path)
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--boot-only"])
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **_k: {})

    warm.main()

    assert "MB" in capsys.readouterr().out


def test_the_rate_is_measured_rather_than_predicted() -> None:
    assert warm.rate_text(0, 100, 0, 5.0) == ""
    assert warm.rate_text(100, 100, 1000, 0.0) == ""

    assert "left" in warm.rate_text(50, 100, 1024 * 50, 60.0)


def test_files_a_second_leads_because_the_byte_rate_is_meaningless() -> None:
    text = warm.rate_text(128, 3358, 8 * 1024 * 54, 54.0)

    assert text.index("files/s") < text.index("KB/s")
    assert "2.4 files/s" in text


def test_the_marks_get_more_workers_than_the_boot_set(monkeypatch, tmp_path) -> None:
    root = build(tmp_path, {"xdai": ["marks@80.bin", "marks@80.json"]})
    seen = {}
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **kw: seen.update(kw) or {})

    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--no-boot"])
    warm.main()
    assert seen["workers"] == warm.MARK_WORKERS == 8

    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root)])
    warm.main()
    assert seen["workers"] == ipfs.WARM_WORKERS == 2


def test_the_worker_count_can_be_overridden(monkeypatch, tmp_path) -> None:
    root = build(tmp_path, {"xdai": ["marks@80.bin", "marks@80.json"]})
    seen = {}
    monkeypatch.setattr(warm, "verify", lambda _c, _p, **kw: seen.update(kw) or {})
    monkeypatch.setattr("sys.argv", ["warm_ipfs.py", "--dist", str(root), "--workers", "3"])

    warm.main()

    assert seen["workers"] == 3


def test_the_weight_is_what_the_run_will_actually_pull(tmp_path: Path) -> None:
    root = build(tmp_path)

    assert warm.weight(root, ["index.html", "main.dart.js"]) > 0
    assert warm.weight(root, ["not-in-this-build.png"]) == 0


def test_no_time_left_is_no_estimate() -> None:
    assert warm.remaining_text(0, 100, 10.0) == ""
    assert warm.remaining_text(100, 100, 10.0) == ""
    assert "left" in warm.remaining_text(50, 100, 60.0)


def test_both_halves_of_a_split_chain_are_warmed(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {"ethereum": ["marks@80.bin", "marks@80.json",
                      "marks@80-rest.bin", "marks@80-rest.json"]},
    )

    paths = warm.bundle_files(root, (80,), [])

    assert paths == [
        "curve/tokens/ethereum/marks@80.bin",
        "curve/tokens/ethereum/marks@80.json",
        "curve/tokens/ethereum/marks@80-rest.bin",
        "curve/tokens/ethereum/marks@80-rest.json",
    ]


def test_a_chain_with_no_tail_is_not_asked_for_one(tmp_path: Path) -> None:
    root = build(tmp_path, {"xdai": ["marks@80.bin", "marks@80.json"]})

    assert warm.bundle_files(root, (80,), []) == [
        "curve/tokens/xdai/marks@80.bin",
        "curve/tokens/xdai/marks@80.json",
    ]


def with_chain_marks(root: Path, names: list[str]) -> Path:
    """The network marks as `build_assets` writes them: one file per network
    per tier, beside the bundle they are the fallback for.
    """
    directory = root / "curve" / "chains"
    directory.mkdir(parents=True, exist_ok=True)
    for name in names:
        for tier in (20, 40, 80, 160):
            (directory / f"{name}@{tier}.png").write_bytes(b"\x89PNG")
    for tier in (40, 80):
        (directory / f"marks@{tier}.bin").write_bytes(b"\x89PNG")
        (directory / f"marks@{tier}.json").write_text("{}")
    return root


def test_the_network_marks_are_warmed_at_every_tier(tmp_path: Path) -> None:
    root = with_chain_marks(build(tmp_path), ["ethereum", "xdai"])

    assert warm.chain_files(root) == [
        "curve/chains/ethereum@160.png",
        "curve/chains/ethereum@20.png",
        "curve/chains/ethereum@40.png",
        "curve/chains/ethereum@80.png",
        "curve/chains/xdai@160.png",
        "curve/chains/xdai@20.png",
        "curve/chains/xdai@40.png",
        "curve/chains/xdai@80.png",
    ]


def test_the_curve_mark_is_warmed_too(tmp_path: Path) -> None:
    root = build(tmp_path)
    branding = root / "curve" / "branding"
    branding.mkdir(parents=True)
    (branding / "logo.svg").write_text("<svg/>")

    assert "curve/branding/logo.svg" in warm.plan(root, options())


def test_the_network_marks_are_warmed_without_being_asked_for(tmp_path: Path) -> None:
    root = with_chain_marks(build(tmp_path), ["ethereum"])

    paths = warm.plan(root, options())

    assert "curve/chains/ethereum@160.png" in paths
    assert "curve/chains/marks@80.bin" in paths
    assert paths.index("curve/chains/marks@80.bin") < paths.index(
        "curve/chains/ethereum@160.png"
    )


def test_naming_chains_still_means_those_chains_marks(tmp_path: Path) -> None:
    root = with_chain_marks(build(tmp_path, {"xdai": ["marks@80.bin"]}), ["ethereum"])

    paths = warm.plan(root, options(chains=["xdai"], boot=False))

    assert paths == ["curve/tokens/xdai/marks@80.bin"]
