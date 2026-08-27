"""Generated-asset validation gate (W3.4).

Tektonic put every AI-generated effect through a four-step gate before it could enter
the bank, with two automatic retries that fed the failure back to the model:

    1. syntax check          ast.parse()
    2. export verification    required EFFECT_META and a callable fx_function
    3. test run               against mock audio features and zero-valued input
    4. output shape match     480x640x3, uint8

Forty-three shaders, 2,705 lines, zero compile errors in the production file. That is not
luck; it is the gate.

Our generated assets are SVG rather than GLSL, so the four steps map like this:

    1. parses                 well-formed XML, root is <svg>
    2. declares               viewBox, dimensions, and no unresolved references
    3. renders                every referenced gradient/filter/clip id actually exists,
                              no external fetches, no scripts
    4. conforms               within the collection's declared aspect, size and palette

Step 3 is where the real defects live. A card whose `fill="url(#grad-gain)"` points at a
gradient that was renamed shows as a black or transparent shape - it does not throw, it
does not warn, and it renders wrong for as long as nobody looks. That is the generative
analogue of the boot-import gate we already run on Python.

    python3 scripts/art/validate_asset.py nft/position-cards/preview/*.svg
    python3 scripts/art/validate_asset.py nft --collection nft/position-cards/THEME.md
    python3 scripts/art/validate_asset.py nft art --json .audit/assets.json

Exit 0 when every asset passes, 1 when any fails. This one IS a gate - unlike the money
scanner it has no heuristics, only facts about the file.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from typing import Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scripts.art.canonical_correction import parse_color, read_claimed  # noqa: E402

SVG_NS = "http://www.w3.org/2000/svg"

# Any of these in a distributed asset is either a live network fetch from someone's
# wallet or an execution vector. An NFT renders inside marketplaces and wallets we do
# not control.
FORBIDDEN_TAGS = {"script", "foreignObject", "iframe"}
EXTERNAL_REF = re.compile(r"""(?:href|xlink:href|src)\s*=\s*["'](https?:|//)""", re.IGNORECASE)
URL_REF = re.compile(r"url\(\s*#([A-Za-z0-9_.:-]+)\s*\)")
HREF_REF = re.compile(r"""(?:href|\{http://www\.w3\.org/1999/xlink\}href)""")


@dataclass
class AssetResult:
    path: str
    passed: bool = True
    step: str = "conforms"
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    width: Optional[float] = None
    height: Optional[float] = None
    elements: int = 0

    def fail(self, step: str, message: str) -> "AssetResult":
        self.passed = False
        self.step = step
        self.errors.append(message)
        return self


def _num(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    m = re.search(r"-?\d*\.?\d+", value)
    return float(m.group()) if m else None


def validate(
    path: str,
    *,
    palette: Sequence[tuple[str, tuple[float, float, float]]] = (),
    aspect: Optional[float] = None,
    aspect_tolerance: float = 0.02,
    max_bytes: int = 512_000,
    palette_tolerance: float = 60.0,
) -> AssetResult:
    result = AssetResult(path=path)

    # --- Step 1: parses ---------------------------------------------------------------
    try:
        raw = open(path, "rb").read()
    except OSError as exc:
        return result.fail("parses", f"unreadable: {exc}")

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        return result.fail("parses", f"malformed XML: {exc}")

    if root.tag.rsplit("}", 1)[-1] != "svg":
        return result.fail("parses", f"root element is <{root.tag}>, not <svg>")

    # --- Step 2: declares -------------------------------------------------------------
    view_box = root.get("viewBox")
    width, height = _num(root.get("width")), _num(root.get("height"))
    if view_box:
        parts = [float(n) for n in re.findall(r"-?\d*\.?\d+", view_box)]
        if len(parts) < 4:
            result.fail("declares", f"viewBox has {len(parts)} values, needs 4")
        else:
            width, height = width or parts[2], height or parts[3]
    elif width is None or height is None:
        result.fail("declares", "no viewBox and no width/height: renderer size is undefined")

    result.width, result.height = width, height

    if len(raw) > max_bytes:
        result.fail(
            "declares",
            f"{len(raw):,} bytes exceeds {max_bytes:,}; wallets and marketplaces "
            "truncate or refuse oversized inline SVG",
        )

    # --- Step 3: renders --------------------------------------------------------------
    defined_ids: set[str] = set()
    referenced: dict[str, str] = {}
    elements = 0

    for el in root.iter():
        elements += 1
        tag = el.tag.rsplit("}", 1)[-1]
        if tag in FORBIDDEN_TAGS:
            result.fail("renders", f"<{tag}> is not permitted in a distributed asset")
        el_id = el.get("id")
        if el_id:
            defined_ids.add(el_id)
        for attr, value in el.attrib.items():
            if not isinstance(value, str):
                continue
            for ref in URL_REF.findall(value):
                referenced.setdefault(ref, f"<{tag} {attr.rsplit('}', 1)[-1]}>")
            if attr.rsplit("}", 1)[-1] in ("href",) and value.startswith("#"):
                referenced.setdefault(value[1:], f"<{tag} href>")

    result.elements = elements

    text = raw.decode("utf-8", errors="replace")
    if EXTERNAL_REF.search(text):
        result.fail(
            "renders",
            "references an external URL; the asset must be self-contained or it "
            "renders differently (or not at all) once the host is gone",
        )

    dangling = sorted(set(referenced) - defined_ids)
    for ref in dangling:
        result.fail(
            "renders",
            f"{referenced[ref]} points at id '{ref}', which is not defined in this file "
            "- that shape renders black or invisible without raising anything",
        )

    unused = sorted(defined_ids - set(referenced))
    if len(unused) > 12:
        result.warnings.append(
            f"{len(unused)} defined ids are never referenced; dead defs inflate every mint"
        )

    # --- Step 4: conforms -------------------------------------------------------------
    if aspect and width and height and height > 0:
        actual = width / height
        if abs(actual - aspect) > aspect_tolerance * aspect:
            result.fail(
                "conforms",
                f"aspect {actual:.4f} differs from the collection's {aspect:.4f} "
                "- the card will letterbox against its siblings in a grid",
            )

    if palette:
        strays: list[str] = []
        for match in re.finditer(r"#[0-9a-fA-F]{6}\b", text):
            rgb = parse_color(match.group())
            if rgb is None:
                continue
            distance = min(
                math.sqrt(sum((rgb[i] - claimed[i]) ** 2 for i in range(3)))
                for _, claimed in palette
            )
            if distance > palette_tolerance:
                strays.append(match.group().lower())
        unique = sorted(set(strays))
        if unique:
            result.warnings.append(
                f"{len(unique)} colour(s) outside the declared palette: "
                f"{', '.join(unique[:8])}{' ...' if len(unique) > 8 else ''}"
            )

    return result


def collect(roots: Sequence[str]) -> list[str]:
    found: list[str] = []
    for root in roots:
        if os.path.isfile(root):
            if root.endswith(".svg"):
                found.append(root)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
            for name in sorted(filenames):
                if name.endswith(".svg"):
                    found.append(os.path.join(dirpath, name))
    return sorted(found)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("paths", nargs="+")
    p.add_argument("--collection", help="design doc declaring the palette")
    p.add_argument("--aspect", type=float, help="required width/height, e.g. 0.7143")
    p.add_argument("--max-bytes", type=int, default=512_000)
    p.add_argument("--json", dest="json_path")
    p.add_argument("--quiet", action="store_true", help="only print failures")
    args = p.parse_args(argv)

    palette = read_claimed([args.collection]) if args.collection else []
    assets = collect(args.paths)
    if not assets:
        print("no SVG assets found", file=sys.stderr)
        return 1

    results = [
        validate(path, palette=palette, aspect=args.aspect, max_bytes=args.max_bytes)
        for path in assets
    ]
    failed = [r for r in results if not r.passed]
    warned = [r for r in results if r.passed and r.warnings]

    for r in results:
        if r.passed and args.quiet:
            continue
        mark = "PASS" if r.passed else f"FAIL[{r.step}]"
        size = f"{r.width:.0f}x{r.height:.0f}" if r.width and r.height else "?"
        print(f"{mark:14} {os.path.relpath(r.path)}  ({size}, {r.elements} elements)")
        for err in r.errors:
            print(f"               ! {err}")
        for warn in r.warnings:
            print(f"               ~ {warn}")

    print(
        f"\n{len(results)} assets: {len(results) - len(failed)} passed, "
        f"{len(failed)} failed, {len(warned)} passed with warnings"
    )

    if args.json_path:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_path)), exist_ok=True)
        with open(args.json_path, "w") as fh:
            json.dump([asdict(r) for r in results], fh, indent=2)
        print(f"written to {args.json_path}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
