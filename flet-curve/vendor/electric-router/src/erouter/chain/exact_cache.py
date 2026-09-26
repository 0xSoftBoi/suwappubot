"""Which pools reproduced their own `get_dy`, remembered between runs.

Admitting a pool is expensive and the answer barely changes.  The gate quotes
each candidate six times and compares against arithmetic, which is 2,300 calls
across the universe -- and what it establishes is that a pool's *code* implements
the maths we think it does.  Curve pools are not upgradeable, so that verdict is
good until either side of the comparison changes.

What it saves is the gate and nothing else.  It does *not* let the local EVM skip
those pools' storage: they are computed from that same storage, so skipping the
sweep relocates the read onto the wire rather than removing it -- measured, and
it turned startup into minutes.  See `tests/test_startup_cost.py`.

**What voids a verdict.**  Anything that changes either side of the comparison:

* the maths on our side -- hence `fingerprint`, over the source of every module
  that participates.  Edit `core/stableswap.py` and every stableswap verdict on
  every chain is discarded.
* the parameters on the pool's side.  These are *not* cached: `A`, `gamma`, the
  fee terms, the ramp state and the balances are re-read every run, and a pool
  mid-ramp is refused there as before.  The verdict records which invariant and
  which variant matched, never the numbers.

**What it does not protect against** is a pool whose behaviour changes without
its code or its readable parameters changing.  Those are excluded at build time
rather than trusted here: a twocrypto pool with a `POLICY` contract is refused
before the gate, because its fee can vary with trade size and one probe would
agree at the size it was taken.

`trust` takes a `resample` set so a caller can force pools back through the gate.
Nothing passes one today; it is there for a scheduled audit.
"""

from __future__ import annotations

import hashlib
import json
import tokenize
from dataclasses import dataclass, field
from pathlib import Path

VERSION = 1

#: A run refusing more than this share of what it knows is reporting an
#: outage, not a universe.  Sits well above the 13-of-375 (3.5%) a healthy
#: mainnet rebuild produces and well below the 73-of-377 (19%) that one bad
#: batch produced.  See `ExactCache.save`.
MASS_REFUSAL_SHARE = 0.15

#: ...and refusing fewer than this many is not evidence of anything.  A run
#: that looks at three pools and refuses one is not an outage, it is a small
#: universe, and a batch failure that touches a handful costs little either
#: way.  The failure this guards against was 58 at once.
MASS_REFUSAL_FLOOR = 10
DEFAULT_DIR = Path(__file__).resolve().parents[3] / "data" / "exact"

#: Every module whose source decides whether a pool reproduces its own quote:
#: the invariants themselves, and the readers that choose which variant to try.
MATH_SOURCES = (
    ("core", "stableswap.py"),
    ("core", "twocrypto.py"),
    ("core", "tricrypto.py"),
    ("core", "cryptoswap.py"),
    ("chain", "stable_params.py"),
    ("chain", "twocrypto_params.py"),
    ("chain", "tricrypto_params.py"),
    # Decides which variant a wrapped-token or oracle-priced pool is built
    # from, so it decides verdicts as much as the invariants do.
    ("chain", "lending_params.py"),
)


def _code_only(source: str) -> bytes:
    """The module's tokens, without comments, docstrings or line breaks.

    Hashing the raw bytes made a *documentation* edit discard every verdict on
    every chain: trimming comments in `cryptoswap.py` and the three readers
    moved the fingerprint and cost a full re-gate -- 2,406 probes against the 84
    a warm cache needs.  What decides whether a pool reproduces its own quote is
    the arithmetic, so that is what is hashed.

    Any real edit still moves it.  Token types and strings are both in the
    stream, so a changed constant, a renamed variable or a reordered expression
    is caught; `INDENT`/`DEDENT` keep block structure, so moving a line into or
    out of a branch is caught too.  A string used as a *value* is kept -- only
    one standing alone as a statement is a docstring.
    """
    import ast
    import io
    import tokenize

    docstrings = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)) and ast.get_docstring(node, clean=False) is not None:
            first = node.body[0]
            docstrings.add((first.lineno, first.col_offset))

    kept: list[str] = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE,
                          tokenize.ENCODING, tokenize.ENDMARKER):
            continue
        if token.type == tokenize.STRING and token.start in docstrings:
            continue
        if token.type in (tokenize.INDENT, tokenize.DEDENT):
            kept.append(str(token.type))          # depth, not whitespace width
            continue
        kept.append(f"{token.type}:{token.string}")
    return "\n".join(kept).encode()


def math_fingerprint() -> str:
    """A digest of the maths, so editing it discards every stale verdict."""
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for package, name in MATH_SOURCES:
        path = root / package / name
        digest.update(name.encode())
        try:
            source = path.read_text()
        except OSError:
            # A missing module is a real difference, not a reason to fall back
            # on a fingerprint that would match a tree that still has it.
            digest.update(b"<missing>")
            continue
        try:
            digest.update(_code_only(source))
        except (SyntaxError, tokenize.TokenError):
            digest.update(source.encode())          # unparseable: hash it whole
    return digest.hexdigest()[:16]


@dataclass(slots=True)
class ExactCache:
    """Per-chain: pool -> the variant that reproduced it, or nothing yet."""

    chain_id: int
    path: Path
    fingerprint: str = ""
    verdicts: dict[str, dict] = field(default_factory=dict)
    #: Pools checked this run and found *not* to reproduce, with why.  Held
    #: for reporting and **never written**: the reason carries the mismatching
    #: wei, which moves with the block, so persisting it rewrote a committed
    #: file on every route.
    refused: dict[str, str] = field(default_factory=dict)
    #: Pools that failed, keyed by the balances they failed at.
    #:
    #: The reason is not written -- that is what churned the file -- but the
    #: *fact* is, because re-deriving it costs a probe per size per direction on
    #: every run.  Once the verdicts are warm those probes are the entire
    #: remaining gate, and all of them are on pools that will never pass.
    #:
    #: Keyed by balances because that is what makes forgetting automatic.  A pool
    #: that answers nothing is empty or holds dust, and a pool in that state does
    #: not trade, so its balances sit still and the record stays valid without
    #: being refreshed.  The moment someone deposits, the key stops matching and
    #: it is checked again -- which is exactly when the answer might have changed.
    unquotable: dict[str, str] = field(default_factory=dict)
    #: Refusals learned *this run*, held back until `save` can see how many
    #: there were.  See `MASS_REFUSAL_SHARE`.
    pending_unquotable: dict[str, str] = field(default_factory=dict, repr=False)
    #: How many refusals the last `save` dropped as an outage, for the caller
    #: to report.  Zero when nothing was dropped.
    mass_refusal: int = 0

    # ------------------------------------------------------------- loading

    @classmethod
    def load(cls, chain_id: int, name: str, directory: Path | None = None):
        path = (directory or DEFAULT_DIR) / f"{name}.json"
        try:
            raw = path.read_bytes()
        except OSError:
            raw = None
        return cls.from_bytes(chain_id, raw, path=path)

    @classmethod
    def from_bytes(cls, chain_id: int, raw: bytes | None, path: Path | None = None):
        """The same file, however it was obtained.

        A browser fetches the verdicts over HTTP.  The fingerprint check is the
        part that matters and is unchanged: a verdict is only believed while
        the maths that earned it is byte-identical, so shipping this file to a
        frontend cannot outlive an edit to an invariant.
        """
        path = path or (DEFAULT_DIR / "unnamed.json")
        current = math_fingerprint()
        try:
            blob = json.loads(raw) if raw else None
        except ValueError:
            blob = None
        if blob is None:
            return cls(chain_id=chain_id, path=path, fingerprint=current)
        if blob.get("version") != VERSION or blob.get("fingerprint") != current:
            # Not an error and not worth warning about -- the maths moved, so
            # every pool gets checked again and the file is rewritten.
            return cls(chain_id=chain_id, path=path, fingerprint=current)
        return cls(
            chain_id=chain_id,
            path=path,
            fingerprint=current,
            verdicts={k.lower(): v for k, v in blob.get("verdicts", {}).items()},
            unquotable={k.lower(): v
                        for k, v in blob.get("unquotable", {}).items()},
        )

    def save(self) -> None:
        """Persist, unless this run looks like an outage rather than a survey.

        A refusal is cached so the next run does not re-probe a pool that holds
        dust.  But the same code path records a pool the endpoint simply declined
        to answer for, and *that* is worth nothing and costs a great deal:
        measured, a rebuild that lost 58 of 266 stableswap models to one bad batch
        made every later quote send 6 routes to the chain instead of 0, taking the
        routing stages from 202 ms to 369 ms.  The entries lapse when balances
        move, so it heals -- slowly, while every quote pays.

        Mass failure is the signal.  Pools do not empty in concert; endpoints fail
        in batches.  So a run that refuses more than a share of everything it
        holds a verdict on is describing the endpoint, and its refusals are
        dropped rather than written.  `warmcache` already refuses to cache its own
        failure this way; this is the same rule for the same reason.
        """
        keep = dict(self.pending_unquotable)
        total = len(self.verdicts) + len(keep)
        if (len(keep) >= MASS_REFUSAL_FLOOR and total
                and len(keep) > MASS_REFUSAL_SHARE * total):
            self.mass_refusal = len(keep)
            keep = {}
        self.unquotable.update(keep)
        # `pending` is not cleared: it is what this run learned, and `skip`
        # reads it.  Dropping it here would make a pool that refused before the
        # save look fresh after it, and would make two saves in one process
        # disagree.  Re-running the decision on the same entries is idempotent.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "version": VERSION,
            "chain_id": self.chain_id,
            "fingerprint": self.fingerprint or math_fingerprint(),
            "verdicts": dict(sorted(self.verdicts.items())),
            "unquotable": dict(sorted(self.unquotable.items())),
        }, indent=1, sort_keys=True) + "\n")

    # ------------------------------------------------------------- reading

    def get(self, pool: str) -> dict | None:
        return self.verdicts.get(pool.lower())

    def record(self, pool: str, variant: dict) -> None:
        key = pool.lower()
        self.verdicts[key] = variant
        self.refused.pop(key, None)
        self.unquotable.pop(key, None)
        self.pending_unquotable.pop(key, None)

    def refuse(self, pool: str, why: str, balances=None) -> None:
        key = pool.lower()
        self.refused[key] = why[:80]
        self.verdicts.pop(key, None)
        if balances is not None:
            self.pending_unquotable[key] = balance_key(balances)

    def readmit(self, pool: str) -> None:
        """Forget a refusal a later reader overturned in the same run.

        No verdict replaces it: `trust` matches against the variants
        `build_exact_pools` offers and these models are built elsewhere, so a
        remembered one could never match.  What must not survive is the
        refusal -- `skip` reads it before the gate, and the reader that rescues
        these pools is fed from `rejected`.  `ETH/aETH` sat in `unquotable` for
        that reason while reproducing its own `get_dy` to the wei.
        """
        key = pool.lower()
        self.refused.pop(key, None)
        self.unquotable.pop(key, None)
        self.pending_unquotable.pop(key, None)

    def skip(self, pool: str, balances) -> bool:
        """Whether this pool failed before, in the state it is in now.

        Reads the refusals learned this run as well as the persisted ones.
        Holding a refusal back from *disk* is about not teaching the next run
        something false; within this one it is still the best thing known, and
        re-probing a pool that just declined would cost the probes the refusal
        exists to save.
        """
        key = pool.lower()
        got = self.unquotable.get(key, self.pending_unquotable.get(key))
        return got is not None and got == balance_key(balances)

    def __len__(self) -> int:
        return len(self.verdicts)


def balance_key(balances) -> str:
    """A short digest of a pool's balances, as the state a failure belongs to."""
    raw = ",".join(str(int(b)) for b in (balances or ()))
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def trust(out, cache, resample, built, key: str) -> bool:
    """Admit a pool on a remembered verdict.  True if it needs no gate.

    `built` is every variant constructed for every pool this run, as
    `(pool, model, variant)`.  The verdict is matched against those rather than
    used to construct one, which is what makes a stale entry harmless: a
    remembered variant that is no longer on offer -- a pool that stopped
    reporting `stored_rates`, a reader that changed what it builds -- simply
    finds no match, and the pool falls through to the gate as if it had never
    been cached.
    """
    if cache is None or key in resample:
        return False
    verdict = cache.get(key)
    if verdict is None:
        return False
    for pool, model, variant in built:
        if pool.address.lower() == key and variant == verdict:
            out.by_pool[key] = model
            out.trusted += 1
            return True
    return False
