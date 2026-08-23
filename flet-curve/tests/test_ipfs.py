"""Pinning the web build, without a Pinata account or a network."""

from __future__ import annotations

import base64
import io
import json
import tarfile
import textwrap
import types
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from tools import publish_ipfs as ipfs


def build(tmp_path: Path, files: dict[str, str]) -> Path:
    root = tmp_path / "dist"
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


# -- the body ---------------------------------------------------------------


def test_the_declared_length_is_exactly_what_goes_out(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "a/b.js": "x" * 5000, "e.txt": ""})
    parts = ipfs.uploads(root, "site")
    fields = ipfs.fields_for("site")

    declared = ipfs.content_length(parts, fields, "BOUND")
    emitted = sum(len(chunk) for chunk in ipfs.body(parts, fields, "BOUND"))

    assert declared == emitted


def test_a_file_part_is_named_for_its_place_in_the_folder(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "curve/tokens/a.png": "img"})

    named = dict(ipfs.uploads(root, "flet-curve"))

    assert set(named) == {"flet-curve/index.html", "flet-curve/curve/tokens/a.png"}


def test_every_file_goes_up_under_the_same_field_name(tmp_path: Path) -> None:
    root = build(tmp_path, {"a.js": "1", "b/c.js": "2"})
    parts = ipfs.uploads(root, "site")

    raw = b"".join(ipfs.body(parts, {}, "BOUND")).decode()

    assert raw.count('name="file"') == 2
    assert raw.endswith("--BOUND--\r\n")


def test_the_options_ask_for_a_cid_a_subdomain_gateway_can_hold() -> None:
    options = json.loads(ipfs.fields_for("x")["pinataOptions"])
    assert options["cidVersion"] == 1


# -- building first ---------------------------------------------------------


def test_the_build_runs_the_console_script_not_dash_m() -> None:
    command = ipfs.flet_cli()

    assert command.endswith("flet")
    assert "-m" not in command


# -- the app package --------------------------------------------------------


def test_the_package_is_wrapped_as_text_and_the_page_follows(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "index.html": '<head><base href="./"></head>'
            '<script>appPackageUrl: "app.tar.gz"</script>',
        },
    )
    (root / "app.tar.gz").write_bytes(b"\x1f\x8b pretend gzip")

    assert ipfs.wrap_package(root) is True
    assert not (root / "app.tar.gz").exists()
    assert '"app-package.json"' in (root / "index.html").read_text(encoding="utf-8")

    payload = json.loads((root / ipfs.PACKAGE_TO).read_text(encoding="utf-8"))
    assert base64.b64decode(payload[ipfs.PACKAGE_KEY]) == b"\x1f\x8b pretend gzip"


def test_the_worker_can_read_what_the_wrapper_writes(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    root.mkdir()
    (root / "index.html").write_text('appPackageUrl: "app.tar.gz"', encoding="utf-8")
    with tarfile.open(root / "app.tar.gz", "w:gz") as archive:
        member = tarfile.TarInfo("main.py")
        member.size = len(b"print('hi')\n")
        archive.addfile(member, io.BytesIO(b"print('hi')\n"))

    ipfs.wrap_package(root)

    blob = json.loads((root / ipfs.PACKAGE_TO).read_text())[ipfs.PACKAGE_KEY]
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(blob))) as archive:
        assert archive.getnames() == ["main.py"]
        assert archive.extractfile("main.py").read() == b"print('hi')\n"


def test_wrapping_a_build_that_is_already_wrapped_does_nothing(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "x", ipfs.PACKAGE_TO: "{}"})
    assert ipfs.wrap_package(root) is False


def test_the_archive_is_not_wrapped_without_the_line_that_points_at_it(
    tmp_path: Path,
) -> None:
    root = build(tmp_path, {"index.html": "<head>nothing here</head>", "app.tar.gz": "x"})
    with pytest.raises(SystemExit, match="appPackageUrl"):
        ipfs.wrap_package(root)
    assert (root / "app.tar.gz").is_file()


# -- the worker patch -------------------------------------------------------


def worker_source() -> str:
    """The two lines of Flet's worker that the patch anchors on."""
    return (
        "            from urllib.parse import urlparse\n"
        + ipfs.WORKER_ANCHOR
        + '\n                _archive_format = "zip"\n'
        + ipfs.WORKER_UNPACK
        + "\n"
    )


def test_the_worker_learns_to_unwrap_and_skips_the_old_path(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    root.mkdir()
    (root / ipfs.WORKER).write_text(worker_source(), encoding="utf-8")

    assert ipfs.patch_worker(root) is True
    patched = (root / ipfs.WORKER).read_text(encoding="utf-8")

    assert '.endswith(".json")' in patched
    assert "if _archive_format:" in patched
    assert ipfs.WORKER_UNPACK.strip() in patched


def test_patching_a_patched_worker_does_nothing(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    root.mkdir()
    (root / ipfs.WORKER).write_text(worker_source(), encoding="utf-8")
    ipfs.patch_worker(root)
    assert ipfs.patch_worker(root) is False


def test_a_worker_that_has_changed_shape_stops_the_run(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    root.mkdir()
    (root / ipfs.WORKER).write_text("something else entirely", encoding="utf-8")
    with pytest.raises(SystemExit, match="changed shape"):
        ipfs.patch_worker(root)


def test_the_python_injected_into_the_worker_parses() -> None:
    branch = "\n".join(ipfs.WORKER_PATCH.splitlines()[:-1])  # drop the trailing elif
    body = textwrap.indent(textwrap.dedent(branch), "    ")
    compile(
        f"async def _run(response, _archive_path, _archive_format):\n{body}\n    pass",
        "<worker patch>",
        "exec",
    )


class FakeSuffixGateway:
    """A gateway that refuses some suffixes before resolving anything."""

    def __init__(self, refuses: tuple[str, ...]) -> None:
        self.refuses = refuses
        self.asked: list[str] = []

    def get(self, url: str, **_kw):
        self.asked.append(url)
        refused = url.endswith(self.refuses)
        body = "Resource Not Found" if refused else (
            "failed to resolve /ipfs/bafyfake/x: no link named"
        )
        return types.SimpleNamespace(text=body, status_code=404)


def test_a_file_that_does_not_exist_is_what_removes_the_confound() -> None:
    gateway = FakeSuffixGateway((".zip", ".tgz"))

    assert not ipfs.suffix_served(gateway, "https://curve.eth.limo", ".zip")
    assert ipfs.suffix_served(gateway, "https://curve.eth.limo", ".bin")
    assert all(ipfs.PROBE_ABSENT in url for url in gateway.asked)


def test_the_probe_pins_nothing_and_writes_nothing(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "x"})
    before = sorted(p.name for p in root.rglob("*"))

    ipfs.suffix_served(FakeSuffixGateway(()), "https://curve.eth.limo", ".zip")

    assert sorted(p.name for p in root.rglob("*")) == before


def test_an_unreachable_gateway_does_not_read_as_a_refusal() -> None:

    class Dead:
        def get(self, url: str, **_kw):
            raise OSError("no route to host")

    assert ipfs.suffix_served(Dead(), "https://curve.eth.limo", ".zip")


def test_the_allowed_suffixes_are_probed_as_controls() -> None:
    assert ".bin" in ipfs.PROBE_SUFFIXES
    assert set(ipfs.REFUSED_SUFFIXES) < set(ipfs.PROBE_SUFFIXES)


def test_gz_is_not_refused_and_that_is_a_correction() -> None:
    assert ".gz" not in ipfs.REFUSED_SUFFIXES
    assert ".tgz" in ipfs.REFUSED_SUFFIXES
    assert not "x.tar.gz".endswith(ipfs.REFUSED_SUFFIXES)
    assert "x.tar.bz2".endswith(ipfs.REFUSED_SUFFIXES)


# -- the check before the upload -------------------------------------------


def test_a_key_in_the_build_is_found_in_a_plain_file(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "config.json": '{"jwt":"SEKRIT"}'})
    assert ipfs.leaked(root, "SEKRIT") == ["config.json"]


def test_a_key_inside_the_python_tarball_is_found_too(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})
    buffer = io.BytesIO(b'jwt = "SEKRIT"\n')
    with tarfile.open(root / "app.tar.gz", "w:gz") as archive:
        info = tarfile.TarInfo("src/local_config.toml")
        info.size = len(buffer.getvalue())
        archive.addfile(info, buffer)

    assert ipfs.leaked(root, "SEKRIT") == ["app.tar.gz:src/local_config.toml"]


def test_the_renamed_package_is_still_searched(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})
    buffer = io.BytesIO(b'jwt = "SEKRIT"\n')
    with tarfile.open(root / "app.tgz", "w:gz") as archive:
        info = tarfile.TarInfo("src/local_config.toml")
        info.size = len(buffer.getvalue())
        archive.addfile(info, buffer)

    assert ipfs.leaked(root, "SEKRIT") == ["app.tgz:src/local_config.toml"]


def test_a_key_is_still_found_once_the_package_is_wrapped(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {"index.html": f'<script>appPackageUrl: "{ipfs.PACKAGE_FROM}"</script>'},
    )
    buffer = io.BytesIO(b'jwt = "SEKRIT"\n')
    with tarfile.open(root / ipfs.PACKAGE_FROM, "w:gz") as archive:
        info = tarfile.TarInfo("src/local_config.toml")
        info.size = len(buffer.getvalue())
        archive.addfile(info, buffer)
    assert ipfs.wrap_package(root) is True

    assert ipfs.leaked(root, "SEKRIT") == [
        f"{ipfs.PACKAGE_TO}:src/local_config.toml"
    ]


def test_a_key_in_the_wrapped_package_is_named_once(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})
    buffer = io.BytesIO(b'jwt = "SEKRIT"\n')
    with tarfile.open(root / ipfs.PACKAGE_FROM, "w:gz") as archive:
        info = tarfile.TarInfo("src/local_config.toml")
        info.size = len(buffer.getvalue())
        archive.addfile(info, buffer)

    assert ipfs.leaked(root, "SEKRIT") == [
        f"{ipfs.PACKAGE_FROM}:src/local_config.toml"
    ]


def test_a_clean_build_reports_nothing(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "main.dart.js": "console.log(1)"})
    assert ipfs.leaked(root, "SEKRIT") == []


# -- compiled bytecode ------------------------------------------------------


def _packaged(root: Path, members: dict[str, bytes]) -> None:
    """Write `app.tar.gz` holding exactly these members."""
    with tarfile.open(root / ipfs.PACKAGE_FROM, "w:gz") as archive:
        for name, payload in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))


def test_bytecode_below_the_top_level_is_found(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})
    _packaged(
        root,
        {
            "curve/abi.py": b"x = 1\n",
            "curve/__pycache__/abi.cpython-313.pyc": b"\x00\x00",
            "ui/__pycache__/assets.cpython-313.pyc": b"\x00\x00",
        },
    )

    assert ipfs.bytecode(root) == [
        f"{ipfs.PACKAGE_FROM}:curve/__pycache__/abi.cpython-313.pyc",
        f"{ipfs.PACKAGE_FROM}:ui/__pycache__/assets.cpython-313.pyc",
    ]


def test_bytecode_is_found_after_the_package_is_wrapped(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {"index.html": f'<script>appPackageUrl: "{ipfs.PACKAGE_FROM}"</script>'},
    )
    _packaged(root, {"curve/__pycache__/abi.cpython-313.pyc": b"\x00\x00"})
    assert ipfs.wrap_package(root) is True
    assert not (root / ipfs.PACKAGE_FROM).exists()

    assert ipfs.bytecode(root) == [
        f"{ipfs.PACKAGE_TO}:curve/__pycache__/abi.cpython-313.pyc"
    ]


def test_loose_bytecode_in_the_build_counts_too(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "__pycache__/x.pyc": "junk"})
    assert ipfs.bytecode(root) == ["__pycache__/x.pyc"]


def test_a_build_with_no_bytecode_reports_nothing(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})
    _packaged(root, {"curve/abi.py": b"x = 1\n"})
    assert ipfs.bytecode(root) == []


def test_the_build_runs_with_bytecode_writing_off() -> None:
    assert ipfs.build_env()["PYTHONDONTWRITEBYTECODE"] == "1"


# -- the base href ----------------------------------------------------------


def test_the_page_is_pointed_at_its_own_directory(tmp_path: Path) -> None:
    index = tmp_path / "index.html"
    index.write_text('<head><base href="/">\n</head>', encoding="utf-8")

    assert ipfs.make_relative(index) is True
    assert '<base href="./">' in index.read_text(encoding="utf-8")


def test_making_it_relative_twice_changes_nothing(tmp_path: Path) -> None:
    index = tmp_path / "index.html"
    index.write_text('<head><base href="./"></head>', encoding="utf-8")
    assert ipfs.make_relative(index) is False


def test_an_index_with_no_base_tag_stops_the_run(tmp_path: Path) -> None:
    index = tmp_path / "index.html"
    index.write_text("<head></head>", encoding="utf-8")
    with pytest.raises(SystemExit, match="patcher"):
        ipfs.make_relative(index)


# -- credentials ------------------------------------------------------------


def test_the_environment_wins_over_the_file(monkeypatch) -> None:
    monkeypatch.setenv("PINATA_JWT", "from-env")
    assert ipfs.token({"jwt": "from-file"}) == "from-env"


def test_the_file_is_used_when_the_environment_is_empty(monkeypatch) -> None:
    monkeypatch.delenv("PINATA_JWT", raising=False)
    assert ipfs.token({"jwt": "from-file"}) == "from-file"


def test_no_key_anywhere_says_where_to_put_one(monkeypatch) -> None:
    monkeypatch.delenv("PINATA_JWT", raising=False)
    with pytest.raises(SystemExit, match=r"local_secrets\.toml"):
        ipfs.token({})


# -- the request ------------------------------------------------------------


def test_the_upload_is_authorised_declared_and_read_back(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "a.js": "x" * 100})
    parts = ipfs.uploads(root, "site")
    fields = ipfs.fields_for("site")
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["length"] = request.headers.get("content-length")
        seen["chunked"] = request.headers.get("transfer-encoding")
        seen["body"] = request.read()
        return httpx.Response(200, json={"IpfsHash": "bafyOK", "PinSize": 7})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    answer = ipfs.pin(parts, fields, "the-jwt", timeout=5, client=client)

    assert answer["IpfsHash"] == "bafyOK"
    assert seen["url"] == ipfs.PIN_URL
    assert seen["auth"] == "Bearer the-jwt"
    assert seen["chunked"] is None
    assert int(seen["length"]) == len(seen["body"])


def test_a_refusal_is_reported_rather_than_returned(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>"})

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="UNAUTHORIZED")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(SystemExit, match=r"401.*UNAUTHORIZED"):
        ipfs.pin(ipfs.uploads(root, "s"), {}, "bad", timeout=5, client=client)


# -- routes that survive a gateway ------------------------------------------


def test_routes_live_in_the_fragment() -> None:
    import tomllib

    root = Path(ipfs.__file__).resolve().parent.parent
    config = tomllib.loads((root / "pyproject.toml").read_text())
    web = config["tool"]["flet"]["web"]

    assert web["route_url_strategy"] == "hash"


def test_the_strategy_is_passed_as_a_flag_because_the_key_is_not_read() -> None:
    source = Path(ipfs.__file__).read_text()

    assert "--route-url-strategy" in source
    assert ipfs.ROUTE_STRATEGY == "hash"


def test_the_effective_strategy_is_the_last_one_named(tmp_path) -> None:
    index = tmp_path / "index.html"
    index.write_text(
        '<script>var flet = { routeUrlStrategy: "path" }</script>\n'
        '<script>flet.routeUrlStrategy="hash";</script>\n'
    )
    assert ipfs.route_strategy(index) == "hash"

    index.write_text('<script>var flet = { routeUrlStrategy: "path" }</script>')
    assert ipfs.route_strategy(index) == "path"

    index.write_text("<script>nothing to see</script>")
    assert ipfs.route_strategy(index) == ""


def test_the_base_href_stays_relative() -> None:
    assert ipfs.BASE_RELATIVE == '<base href="./">'
    assert ipfs.BASE_ABSOLUTE == '<base href="/">'


# -- running it the way anybody runs it -------------------------------------


def test_the_script_runs_as_a_script(tmp_path) -> None:
    import io
    import shutil
    import subprocess
    import sys
    import tarfile

    import flet_web

    root = Path(ipfs.__file__).resolve().parent.parent
    web = Path(flet_web.__file__).parent / "web"

    dist = tmp_path / "dist"
    (dist / "assets/fonts").mkdir(parents=True)
    (dist / "index.html").write_text(
        '<html><head><base href="/">'
        '<script>flet.routeUrlStrategy="hash";'
        'appPackageUrl: "app.tar.gz"</script></head></html>',
        encoding="utf-8",
    )
    shutil.copy(web / "assets/fonts/MaterialIcons-Regular.otf",
                dist / "assets/fonts/MaterialIcons-Regular.otf")
    shutil.copy(web / "python-worker.js", dist / "python-worker.js")
    with tarfile.open(dist / "app.tar.gz", "w:gz") as archive:
        member = tarfile.TarInfo("main.py")
        member.size = 0
        archive.addfile(member, io.BytesIO(b""))

    done = subprocess.run(
        [sys.executable, str(root / "tools/publish_ipfs.py"),
         "--dry-run", "--no-build", "--dist", str(dist)],
        capture_output=True, text=True, cwd=root, timeout=120,
        check=False,
    )

    assert "ModuleNotFoundError" not in done.stderr, done.stderr
    assert "Traceback" not in done.stderr, done.stderr
    assert done.returncode == 0, done.stderr
    cut = (dist / "assets/fonts/MaterialIcons-Regular.otf").stat().st_size
    assert cut < 50_000, f"the font was not subset ({cut} bytes)"


def test_publishing_compiles_the_marks_first() -> None:
    source = Path(ipfs.__file__).read_text(encoding="utf-8")

    assert "build_assets.py" in source, "publishing must compile the marks"
    body = source[source.index("if not options.no_build:") :]
    assert body.index("compile_assets()") < body.index("publish()"), (
        "the marks have to be compiled before `flet publish` packs src/"
    )


# -- what a gateway will not serve ------------------------------------------
# Two rules, measured separately, and neither predicts the other.


def test_the_stdlib_zip_is_reported_and_does_not_stop_the_upload(
    tmp_path: Path,
) -> None:
    root = build(tmp_path, {"index.html": "<html>", "pyodide/python_stdlib.zip": "PK"})
    assert ipfs.refused_by_gateway(root) == ["pyodide/python_stdlib.zip"]


def test_a_wheel_is_the_same_bytes_and_is_left_alone(tmp_path: Path) -> None:
    root = build(tmp_path, {"pyodide/packaging-26.1-py3-none-any.whl": "PK\x03\x04"})
    assert ipfs.refused_by_gateway(root) == []


def test_a_build_with_nothing_refused_is_quiet(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "<html>", "main.dart.js": "//"})
    assert ipfs.refused_by_gateway(root) == []


# -- proving the pin before a name points at it -----------------------------


def test_the_lazy_token_art_is_not_verified(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "index.html": "<html>",
            "main.dart.js": "//",
            "curve/tokens/ethereum/0xabc@20.png": "x",
        },
    )
    assert ipfs.boot_files(root) == ["index.html", "main.dart.js"]


def test_the_pyodide_copy_nothing_ever_asks_for_is_not_verified(
    tmp_path: Path,
) -> None:
    root = build(
        tmp_path,
        {
            "index.html": "<html>",
            "pyodide/python_stdlib.zip": "PK",
            "pyodide/package.json": "{}",
        },
    )
    assert ipfs.boot_files(root) == ["index.html"]


def test_a_fast_failure_is_a_refusal_and_a_slow_one_is_not_yet() -> None:
    assert ipfs.classify(404, 0.3) == "refused"
    assert ipfs.classify(504, 17.5) == "unfound"
    assert ipfs.classify(200, 0.4) == "served"
    assert ipfs.classify(206, 1.2) == "served"
    assert ipfs.classify("ReadTimeout", 45.0) == "unfound"


class FakeGateway:
    """Answers each path from a script, one entry per attempt."""

    def __init__(self, answers: dict[str, list[tuple[int, float]]]) -> None:
        self.answers = {k: list(v) for k, v in answers.items()}
        self.asked: list[str] = []

    def probe(
        self, _client, url: str, *, whole: bool = False, timeout: float = 45.0
    ) -> tuple[int, float]:
        # whichever host it went to, and whether the CID is in the
        # hostname or in the path.
        path = url.split("bafyfake/", 1)[-1] if "bafyfake/" in url else url.split("/", 3)[-1]
        self.asked.append(path)
        self.whole = whole
        queue = self.answers.get(path, [(200, 0.1)])
        return queue.pop(0) if len(queue) > 1 else queue[0]


def run_verify(monkeypatch, gateway: FakeGateway, paths: list[str], **kw) -> dict:
    monkeypatch.setattr(ipfs, "probe", gateway.probe)
    return ipfs.verify(
        "bafyfake", paths, client=object(), sleep=lambda _s: None, **kw
    )


def test_the_bar_moves_while_a_round_is_still_running(monkeypatch) -> None:
    """A round is one probe per outstanding file, and a file nobody can
    find takes the full timeout -- 58 of those, six at a time, is seven
    minutes. Reported only at the end of a round, that is a bar that has
    not moved, which reads as a hung script. It was read as one.
    """
    gateway = FakeGateway({"a.js": [(200, 0.2)], "b.js": [(200, 0.3)]})
    seen: list[tuple[int, int]] = []

    monkeypatch.setattr(ipfs, "probe", gateway.probe)
    ipfs.verify(
        "bafyfake",
        ["a.js", "b.js"],
        client=object(),
        sleep=lambda _s: None,
        on_round=lambda served, total, _e: seen.append((served, total)),
    )

    assert seen == [(1, 2), (2, 2)], "once per file, not once per round"


def test_a_pin_that_is_fully_retrievable_passes(monkeypatch) -> None:
    gateway = FakeGateway({"index.html": [(200, 0.2)], "main.dart.js": [(206, 0.4)]})
    assert run_verify(monkeypatch, gateway, ["index.html", "main.dart.js"]) == {}


def test_a_file_still_propagating_is_retried_until_it_lands(monkeypatch) -> None:
    gateway = FakeGateway({"slow.js": [(504, 17.0), (504, 17.0), (200, 0.9)]})

    assert run_verify(monkeypatch, gateway, ["slow.js"]) == {}
    assert gateway.asked == ["slow.js", "slow.js", "slow.js"]


def test_a_refusal_is_never_retried(monkeypatch) -> None:
    gateway = FakeGateway({"pyodide/python_stdlib.zip": [(404, 0.3)]})

    bad = run_verify(monkeypatch, gateway, ["pyodide/python_stdlib.zip"])

    assert bad["pyodide/python_stdlib.zip"][0] == "refused"
    assert gateway.asked == ["pyodide/python_stdlib.zip"], "asked more than once"


def test_the_deadline_ends_a_pin_that_never_propagates(monkeypatch) -> None:
    gateway = FakeGateway({"never.js": [(504, 17.0)]})
    ticks = iter([0.0, 0.0, 10.0, 999.0, 999.0])

    bad = run_verify(
        monkeypatch, gateway, ["never.js"], deadline=60.0, now=lambda: next(ticks)
    )

    assert bad["never.js"][0] == "unfound"


def test_a_file_that_heals_is_dropped_from_the_report(monkeypatch) -> None:
    gateway = FakeGateway({"a.js": [(504, 17.0), (200, 0.3)], "b.js": [(200, 0.1)]})
    assert run_verify(monkeypatch, gateway, ["a.js", "b.js"]) == {}


# -- our own request rate is not the gateway's opinion of the file ----------


def test_being_rate_limited_is_not_a_refusal() -> None:
    assert ipfs.classify(503, 0.2) == "throttled"
    assert ipfs.classify(429, 0.1) == "throttled"
    assert ipfs.classify(404, 0.3) == "refused", "a real refusal still is one"


def test_a_throttled_file_is_retried_until_the_limiter_lets_go(monkeypatch) -> None:
    gateway = FakeGateway({"main.dart.js": [(503, 0.2), (503, 0.1), (200, 0.9)]})

    assert run_verify(monkeypatch, gateway, ["main.dart.js"]) == {}
    assert gateway.asked == ["main.dart.js"] * 3, "gave up on a rate limit"


# -- waiting for the name to move, so one command covers the whole publish --
# The script cannot set the contenthash -- that is a wallet signature -- but
# it can watch for it, which is the difference between warming attached to
# the publish that needs it and a command you have to remember later.


class FakeResolver:
    """A gateway whose `x-ipfs-roots` changes partway through, as ENS does."""

    def __init__(self, roots: list[str]) -> None:
        self.roots = list(roots)
        self.asked = 0

    def get(self, _url, **_kw):
        self.asked += 1
        root = self.roots[min(self.asked - 1, len(self.roots) - 1)]
        return types.SimpleNamespace(headers={"x-ipfs-roots": root} if root else {})


def waiting_for_ens(resolver, **kw):
    return ipfs.wait_for_ens(
        "https://curve.eth.limo",
        "bafynew",
        types.SimpleNamespace(ens_deadline=kw.pop("deadline", 600.0)),
        client=resolver,
        sleep=lambda _s: None,
        **kw,
    )


def test_the_wait_ends_when_the_name_points_at_the_new_build(capsys) -> None:
    resolver = FakeResolver(["bafyold", "bafyold", "bafynew"])

    assert waiting_for_ens(resolver) is True
    assert resolver.asked == 3
    assert "ipfs://bafynew" in capsys.readouterr().out, "must say what to set"


def test_the_old_cid_is_never_mistaken_for_the_new_one(capsys) -> None:
    ticks = iter([0.0, 0.0, 10.0, 20.0, 9999.0, 9999.0, 9999.0])
    resolver = FakeResolver(["bafyold"])

    assert waiting_for_ens(resolver, now=lambda: next(ticks), deadline=60.0) is False
    assert "--warm" in capsys.readouterr().out, "must say how to pick it up"


def test_a_subpath_header_is_read_down_to_its_root() -> None:
    client = types.SimpleNamespace(
        get=lambda *_a, **_kw: types.SimpleNamespace(
            headers={"x-ipfs-roots": "bafyroot,bafychild"}
        )
    )
    assert ipfs.resolved_cid(client, "https://curve.eth.limo") == "bafyroot"


def test_a_gateway_that_says_nothing_is_not_a_match() -> None:
    client = types.SimpleNamespace(
        get=lambda *_a, **_kw: types.SimpleNamespace(headers={})
    )
    assert ipfs.resolved_cid(client, "https://curve.eth.limo") == ""


def test_interrupting_the_ens_wait_leaves_the_pin_verified(capsys) -> None:
    def interrupted(*_a, **_kw):
        raise KeyboardInterrupt

    client = types.SimpleNamespace(get=interrupted)

    assert waiting_for_ens(client) is False
    assert "Nothing is lost" in capsys.readouterr().out


# -- warming: the stage that touches the path a visitor actually takes ------
# eth.limo has no CID gateway (`https://<cid>.ipfs.eth.limo` does not
# resolve, `https://eth.limo/ipfs/<cid>` 404s), so its retrieval path cannot
# be exercised until ENS points at the CID.


def test_warming_reads_whole_files_not_just_the_first_block(monkeypatch) -> None:
    gateway = FakeGateway({"main.dart.js": [(200, 0.9)]})
    monkeypatch.setattr(ipfs, "probe", gateway.probe)

    ipfs.verify(
        "",
        ["main.dart.js"],
        gateway="https://curve.eth.limo",
        client=object(),
        sleep=lambda _s: None,
        whole=True,
    )

    assert gateway.whole is True


def test_an_ens_host_needs_no_cid_and_formats_to_itself() -> None:
    assert ipfs.WARM_GATEWAY.format(cid="bafyfake") == ipfs.WARM_GATEWAY


def test_warming_is_paced_so_it_does_not_become_the_problem() -> None:
    assert ipfs.WARM_WORKERS < ipfs.VERIFY_WORKERS


def test_warming_asks_the_ens_host_for_the_boot_set(monkeypatch, capsys) -> None:
    gateway = FakeGateway({"index.html": [(200, 0.2)], "main.dart.js": [(200, 0.4)]})
    monkeypatch.setattr(ipfs, "probe", gateway.probe)

    code = ipfs.warm(
        "https://curve.eth.limo",
        ["index.html", "main.dart.js"],
        types.SimpleNamespace(verify_deadline=60.0),
    )

    assert code == 0
    assert sorted(gateway.asked) == ["index.html", "main.dart.js"]
    assert "curve.eth.limo" in capsys.readouterr().out


def test_warming_reports_what_is_still_cold_and_says_to_run_again(
    monkeypatch, capsys
) -> None:
    font = "assets/fonts/MaterialIcons-Regular.otf"
    monkeypatch.setattr(ipfs, "verify", lambda *a, **kw: {font: ("unfound", 504, 17.4)})

    code = ipfs.warm(
        "https://curve.eth.limo", [font], types.SimpleNamespace(verify_deadline=60.0)
    )

    out = capsys.readouterr().out
    assert code == 1
    assert font in out
    assert "Run it again" in out


def test_interrupting_a_warm_keeps_what_it_already_fetched(
    monkeypatch, capsys
) -> None:

    def interrupted(*_a, **_kw):
        raise KeyboardInterrupt

    monkeypatch.setattr(ipfs, "verify", interrupted)

    code = ipfs.warm(
        "https://curve.eth.limo",
        ["index.html"],
        types.SimpleNamespace(verify_deadline=60.0),
    )

    assert code == 130
    assert "stays warm" in capsys.readouterr().out


def test_the_pre_ens_pass_does_not_claim_to_have_checked_eth_limo(
    monkeypatch, capsys
) -> None:
    gateway = FakeGateway({"index.html": [(200, 0.2)]})
    monkeypatch.setattr(ipfs, "probe", gateway.probe)

    ipfs.wait_until_findable(
        "bafyfake",
        ["index.html"],
        types.SimpleNamespace(
            verify_gateway=ipfs.VERIFY_GATEWAY, verify_deadline=60.0
        ),
    )

    out = capsys.readouterr().out
    assert "does not say eth.limo can" in out
    assert "--warm" in out


# -- the CID comes first, and the waiting is its own phase ------------------
# The upload succeeding and the network being able to find the result are two
# questions with two answers, and the second can legitimately take a quarter
# of an hour.


def test_the_bar_fills_with_what_is_retrievable() -> None:
    assert "[" + "-" * 28 + "]" in ipfs.progress_bar(0, 92, 0.0)
    assert "[" + "#" * 28 + "]" in ipfs.progress_bar(92, 92, 1.0)
    assert "46/92 retrievable" in ipfs.progress_bar(46, 92, 0.0)
    assert "4m03s" in ipfs.progress_bar(1, 92, 243.0)


def test_an_empty_build_does_not_divide_by_zero() -> None:
    assert ipfs.progress_bar(0, 0, 0.0)


def test_the_bar_redraws_in_place_only_on_a_terminal() -> None:

    class Pipe(io.StringIO):
        def isatty(self) -> bool:
            return False

    class Terminal(io.StringIO):
        def isatty(self) -> bool:
            return True

    piped, terminal = Pipe(), Terminal()
    for stream in (piped, terminal):
        report = ipfs.ProgressReporter(stream)
        report(1, 2, 0.0)
        report(2, 2, 1.0)

    assert "\r" not in piped.getvalue()
    assert piped.getvalue().count("\n") == 2
    assert terminal.getvalue().count("\r") == 2
    assert "\n" not in terminal.getvalue()


def test_a_piped_bar_is_written_at_intervals_and_at_the_end() -> None:
    """It moves per file now. A terminal redraws in place and can take
    every one of them; a log would take 58 lines a round.
    """

    class Pipe(io.StringIO):
        def isatty(self) -> bool:
            return False

    piped = Pipe()
    report = ipfs.ProgressReporter(piped, every=20.0)
    for served in range(1, 8):  # one a second, all within one interval
        report(served, 58, float(served))
    report(58, 58, 8.0)

    assert piped.getvalue().count("\n") == 2, "the first, then the finish"
    assert "58/58" in piped.getvalue()


def test_the_cid_is_printed_before_any_waiting(capsys) -> None:
    ipfs.show_pin("bafyexample", duplicate=True)
    out = capsys.readouterr().out

    assert "bafyexample" in out
    assert "already pinned" in out
    assert "https://bafyexample.ipfs.dweb.link/" in out
    assert "ipfs://bafyexample/" in out


def waiting_options(**kw):
    import types

    return types.SimpleNamespace(
        verify_gateway=ipfs.VERIFY_GATEWAY, verify_deadline=90.0, **kw
    )


def test_interrupting_the_wait_keeps_the_pin_and_says_how_to_resume(
    monkeypatch, capsys
) -> None:

    def interrupted(*_a, **_kw):
        raise KeyboardInterrupt

    monkeypatch.setattr(ipfs, "verify", interrupted)

    code = ipfs.wait_until_findable("bafyexample", ["index.html"], waiting_options())
    out = capsys.readouterr().out

    assert code == 130
    assert "The pin is fine" in out
    assert "--verify-only bafyexample" in out


def test_a_pin_still_propagating_says_to_come_back(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        ipfs, "verify", lambda *a, **kw: {"slow.js": ("unfound", 504, 17.0)}
    )

    code = ipfs.wait_until_findable("bafyexample", ["slow.js"], waiting_options())
    out = capsys.readouterr().out

    assert code == 1
    assert "not found yet" in out
    assert "Do not point ENS at this CID yet" in out
    assert "--verify-only bafyexample" in out


def test_a_refusal_does_not_suggest_waiting_longer(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        ipfs, "verify", lambda *a, **kw: {"a.zip": ("refused", 404, 0.3)}
    )

    code = ipfs.wait_until_findable("bafyexample", ["a.zip"], waiting_options())
    out = capsys.readouterr().out

    assert code == 1
    assert "waiting will not help" in out
    assert "--verify-only" not in out


def test_a_pin_the_network_can_find_reports_the_wait_and_passes(
    monkeypatch, capsys
) -> None:
    monkeypatch.setattr(ipfs, "verify", lambda *a, **kw: {})

    code = ipfs.wait_until_findable("bafyexample", ["a", "b"], waiting_options())
    out = capsys.readouterr().out

    assert code == 0
    assert "all 2 retrievable" in out
    assert "safe to point ENS at this CID" in out


def test_the_whole_archive_family_is_reported_not_just_zip(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "a.zip": "x", "c.tgz": "x", "d.tar": "x",
            "e.bz2": "x", "f.xz": "x", "g.7z": "x", "h.zst": "x", "i.jar": "x",
            "b.tar.gz": "x", "j.gz": "x",
            "main.dart.js": "//", "pyodide/pyodide.asm.wasm": "\0",
            "packaging-26.1-py3-none-any.whl": "PK\x03\x04",
        },
    )
    assert ipfs.refused_by_gateway(root) == [
        "a.zip", "c.tgz", "d.tar", "e.bz2", "f.xz", "g.7z", "h.zst", "i.jar",
    ]


# -- what must never be published ------------------------------------------


def test_the_mock_wallet_never_reaches_a_published_build(tmp_path: Path) -> None:
    """It announces itself as an ordinary EIP-6963 wallet and answers with
    fabricated balances and mined receipts, and the app auto-connects a
    lone announced wallet -- so `?mock=1` on a published site would connect
    a fake wallet with no click and report transactions that never
    happened."""
    root = build(tmp_path, {"mock_wallet.js": "// fake", "main.dart.js": "//"})

    assert ipfs.drop_dev_files(root) == ["mock_wallet.js"]
    assert not (root / "mock_wallet.js").exists()
    assert (root / "main.dart.js").exists()


def test_a_build_without_it_is_not_an_error(tmp_path: Path) -> None:
    """`--no-build` pins a dist/ that has already been through this once."""
    assert ipfs.drop_dev_files(build(tmp_path, {"main.dart.js": "//"})) == []


# -- half the pin nobody fetches -------------------------------------------


def test_a_cdn_build_drops_the_copies_it_will_never_serve(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "index.html": "<script>flet.noCdn=false;</script>",
            "canvaskit/canvaskit.wasm": "x" * 500,
            "pyodide/pyodide.mjs": "y" * 300,
            "main.dart.js": "//",
        },
    )

    freed = dict(ipfs.drop_cdn_copies(root))

    assert set(freed) == {"canvaskit", "pyodide"}
    assert not (root / "canvaskit").exists()
    assert not (root / "pyodide").exists()
    assert (root / "main.dart.js").exists()


def test_a_no_cdn_build_keeps_them_because_it_serves_them(tmp_path: Path) -> None:
    root = build(
        tmp_path,
        {
            "index.html": "<script>flet.noCdn=true;</script>",
            "canvaskit/canvaskit.wasm": "x" * 500,
            "pyodide/pyodide.mjs": "y" * 300,
        },
    )

    assert ipfs.drop_cdn_copies(root) == []
    assert (root / "canvaskit").is_dir()
    assert (root / "pyodide").is_dir()


@pytest.mark.parametrize(
    "text,is_cdn",
    [
        ("flet.noCdn=false;", True),
        ("flet.noCdn = false;", True),
        ("flet.noCdn=true;", False),
        ("flet.noCdn = true ;", False),
        ("", True),  # Flet's own default
    ],
)
def test_the_cdn_question_is_read_out_of_the_build(tmp_path: Path, text, is_cdn) -> None:
    index = tmp_path / "index.html"
    index.write_text(text)
    assert ipfs.cdn_build(index) is is_cdn


def test_a_missing_index_reads_as_a_cdn_build(tmp_path: Path) -> None:
    assert ipfs.cdn_build(tmp_path / "nothing-here.html") is True


def test_main_dart_wasm_is_not_treated_as_cdn_served() -> None:
    assert not any("wasm" in name for name in ipfs.CDN_SERVED)
    assert ipfs.CDN_SERVED == ("canvaskit", "pyodide")


def test_dropping_is_measured_so_the_run_can_say_what_it_saved(tmp_path: Path) -> None:
    root = build(tmp_path, {"index.html": "x", "canvaskit/a.wasm": "z" * 1000})

    assert dict(ipfs.drop_cdn_copies(root))["canvaskit"] == 1000


# -- which gateway proves it ----------------------------------------------


BYTES = b'{"version":"1.0.0"}'


class Gateways:
    """Answers per host, so a run can be watched choosing between them."""

    def __init__(self, answers: dict[str, tuple[int | str, bytes, float]]) -> None:
        self.answers = answers
        self.asked: list[str] = []

    def fetch(self, _client, url: str, timeout: float = 12.0):
        host = url.split("/")[2]
        self.asked.append(host)
        for name, answer in self.answers.items():
            if name in host:
                return answer
        return 504, b"", 28.0


def choose(monkeypatch, hosts: Gateways, **kw):
    monkeypatch.setattr(ipfs, "fetch", hosts.fetch)
    return ipfs.pick_gateway("bafyfake", BYTES, client=object(), **kw)


def test_the_first_gateway_that_serves_the_file_is_used(monkeypatch) -> None:
    hosts = Gateways({"ipfs.io": (200, BYTES, 0.3)})

    gateway, tried = choose(monkeypatch, hosts)

    assert "ipfs.io" in gateway
    assert hosts.asked == ["ipfs.io"], "no need to ask further"
    assert len(tried) == 1


def test_a_gateway_that_cannot_find_it_is_passed_over(monkeypatch) -> None:
    """dweb.link sat at 0/58 for three publishes running while another
    gateway had the same CID. The run moves on rather than staking the
    publish on one host.
    """
    hosts = Gateways({"ipfs.io": (504, b"", 28.0), "dweb.link": (200, BYTES, 0.4)})

    gateway, tried = choose(monkeypatch, hosts)

    assert "dweb.link" in gateway
    assert [answer for _host, answer, _s in tried] == ["504", ipfs.SERVED]


def test_a_gateway_that_answers_200_to_everything_is_not_one(monkeypatch) -> None:
    """The service-worker gateways -- inbrowser.link, w3s.link -- return an
    HTML bootstrap for every path and leave the retrieval to the browser.
    To anything that is not a browser they cannot fail, and one was read
    here as "58/58 retrievable in one second" on a pin nothing else could
    serve. So what comes back has to be the file.
    """
    shim = b"<!DOCTYPE html><html>service worker gateway</html>"
    hosts = Gateways({"ipfs.io": (200, shim, 0.2), "dweb.link": (200, BYTES, 0.5)})

    gateway, tried = choose(monkeypatch, hosts)

    assert "dweb.link" in gateway
    assert tried[0][1] == ipfs.NOT_THIS_FILE, "200 is not evidence"


def test_no_gateway_serving_it_names_none(monkeypatch) -> None:
    hosts = Gateways({})

    gateway, tried = choose(monkeypatch, hosts)

    assert gateway == ""
    assert len(tried) == len(ipfs.VERIFY_GATEWAYS), "all of them were asked"


def test_a_pin_nobody_has_yet_is_still_waited_on(monkeypatch, tmp_path) -> None:
    """A gateway answering 504 has not found it *yet*, which is the whole
    reason the file-by-file check retries. Reading that as "cannot be
    checked" stopped a publish whose pin a gateway served 11 seconds later.
    """
    (tmp_path / ipfs.GATEWAY_PROBE_FILE).write_bytes(BYTES)
    hosts = Gateways({})  # every one of them times out
    monkeypatch.setattr(ipfs, "fetch", hosts.fetch)
    options = SimpleNamespace(verify_gateway="", dist=str(tmp_path))

    assert ipfs.chosen_gateway("bafyfake", options) == ipfs.VERIFY_GATEWAYS[0]


def test_only_a_wall_of_wrong_files_leaves_nothing_to_check_with(
    monkeypatch, tmp_path
) -> None:
    """Every candidate a service-worker gateway is the one case with no
    answer in it: not a slow pin, an unusable set of gateways.
    """
    (tmp_path / ipfs.GATEWAY_PROBE_FILE).write_bytes(BYTES)
    shim = (200, b"<!DOCTYPE html>", 0.2)
    hosts = Gateways(dict.fromkeys(("ipfs.io", "dweb.link"), shim))
    monkeypatch.setattr(ipfs, "fetch", hosts.fetch)
    options = SimpleNamespace(verify_gateway="", dist=str(tmp_path))

    assert ipfs.chosen_gateway("bafyfake", options) == ""


def test_a_named_gateway_is_not_second_guessed(monkeypatch) -> None:
    asked = []

    def remember(*args, **_kw):
        asked.append(args)
        return "x", []

    monkeypatch.setattr(ipfs, "pick_gateway", remember)
    options = SimpleNamespace(verify_gateway="https://{cid}.example.test", dist=".")

    assert ipfs.chosen_gateway("bafyfake", options) == "https://{cid}.example.test"
    assert asked == []


def test_the_probe_file_is_one_every_build_writes(tmp_path: Path) -> None:
    """It is compared byte for byte, so it has to be there and it has to be
    small: this is fetched whole, per gateway, before the check starts.
    """
    options = SimpleNamespace(verify_gateway="", dist=str(tmp_path))

    with pytest.raises(SystemExit) as raised:
        ipfs.chosen_gateway("bafyfake", options)

    assert ipfs.GATEWAY_PROBE_FILE in str(raised.value)


def test_the_probe_outlasts_a_gateway_that_is_merely_slow() -> None:
    """A 504 comes back at ~28s and a cold hit took 11. Cutting the probe
    at 12 read a working gateway as a failed one, on a real publish.
    """
    assert ipfs.GATEWAY_PROBE_TIMEOUT > 28.0
    assert ipfs.GATEWAY_PROBE_TIMEOUT <= ipfs.VERIFY_TIMEOUT


def test_every_candidate_returns_bytes_for_a_plain_get() -> None:
    """`trustless-gateway.link` was in this list and could never pass: it
    serves raw blocks and CARs, and answers a plain path GET with a 406.
    """
    assert not any("trustless" in gateway for gateway in ipfs.VERIFY_GATEWAYS)
