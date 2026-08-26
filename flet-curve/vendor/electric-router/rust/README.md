# erouter-solve

The router's hot path in Rust: `active_set_solve` and the primitives it runs
once per pivot (component reachability, Laplacian assembly, dense LU).

Written to run in three places without changing:

* **CPython**, as a PyO3 extension (`--features python`), used by
  `erouter.core.accel` when it imports.
* **Pyodide**, the same extension built for `wasm32-unknown-emscripten`, which
  is what the Flet frontend loads.
* **A bare wasm module** for a Web Worker, via the `rlib` and a thin
  `wasm-bindgen` wrapper, for a frontend that would rather not go through
  Python at all.

Consequences for how it is written, all of them load-bearing:

* **No I/O, no threads, no clock, no allocator tricks.**  A Web Worker has no
  filesystem and no `std::time`; anything that touches them will compile on the
  host and fail in the browser.
* **No BLAS or LAPACK.**  The dense solves are n ~ 50 (median measured on
  mainnet) and at that size a hand-written LU with partial pivoting beats the
  cost of binding a Fortran library that has no wasm build.  It is ~40 lines
  and it is in `lu.rs`.
* **Deterministic.**  No parallelism and no floating-point reassociation, so a
  quote is reproducible across the three targets.  The Python implementation
  stays the reference; `tests/test_accel_differential.py` differs them, and
  both are differed against OSQP (§13.3).

`erouter.core` must remain importable with nothing but numpy, so this is never
a hard dependency: `accel.py` tries the import and the pure-Python path answers
when it is absent.

## Status

**Opt-in, not yet the default.**  Set `EROUTER_ACCEL=1` to route through it.

What is established: it reproduces `core/solve.py` to 1e-12 on six shaped
problems and twelve fuzzed graphs, honours pins and forbidden arcs identically,
and matches OSQP's objective on all of them (`tests/test_accel_differential.py`).
The whole Python suite passes with it enabled.

What is not: on real quotes it still diverges where the solve does not converge
cleanly.  `USDC->WETH $20M` returned 9,052 WETH through Python and 4,681
through Rust.  Those quotes reach `maxit`, cycle under Bland's rule and return
`PARTIAL` -- paths a clean synthetic problem never takes, which is why the unit
differential passed while the real quote did not.  **The lesson is about the
tests, not the port**: a differential over problems that converge in a handful
of pivots cannot cover a solver whose interesting behaviour is what it does
when it fails to converge.

It is also not yet faster end to end -- 0.9x on four of five real quotes.  The
solve is about a quarter of a warm quote, and marshalling the arrays across the
boundary costs roughly what the arithmetic saves.  The 20x seen on a 20-node
synthetic problem is real and irrelevant: the measured per-pivot system is
n = 49 median, and the crossing happens 45 times a quote.

### What to do next, in order

1. **Force the hard paths in the differential.**  Small `maxit`, graphs built
   to cycle, `partial_ok=True`.  Until those are covered the port cannot be
   trusted, and with them the remaining divergence is findable in minutes.
2. **Then fix the divergence**, which is somewhere in the cycling and
   exhaustion branches -- the same region where a phantom `CLEANUP_ROUNDS`
   phase (reverted in the Python, ported from memory) was already found and
   removed.
3. **Then reconsider the boundary.**  Lists cost; numpy's buffer protocol would
   avoid a copy, at the price of the numpy C API and a harder Pyodide build.
   Or move more of the pipeline across -- `calibrate` is another ~25% and has
   no such marshalling problem, since it is called far less often.

### Browser build

Built, and it is the `wasm-bindgen` route rather than the Pyodide wheel.

A `wasm32-unknown-emscripten` extension would have to match the Emscripten
version Pyodide was built with *and* be built with a pyo3 that supports its
CPython -- Pyodide 314.0.3 is CPython 3.14, which pyo3 0.23 does not target.
A `wasm-bindgen` module has neither constraint: it is the same Rust for the
browser's own target, and `src/erouter/wasm/` presents the PyO3 spelling to
Python, so `core/accel.py` never learns which one answered.

    ./scripts/build_wasm.sh          # -> rust/wasm/pkg/

1.43 MB, 467 kB gzipped, carrying the solver *and* the EVM (see `evm/`).
`tests/test_wasm_differential.py` differs it against the native extension and
requires **byte equality** -- same crate, same compiler (`rust-toolchain.toml`
pins 1.96.1), and `sqrt` is the only non-trivially-rounded operation in the
solver, which IEEE-754 requires be correctly rounded on both targets.  The
hard paths are in there too: `maxit` exhaustion, cycling under Bland's rule,
`partial_ok`.  Those are what the earlier port got wrong while passing every
clean problem.

### Toolchain

The system `rust-bin` has x86_64 std only, so this needs rustup, and a
`wasm-bindgen` CLI whose version *equals* the crate's -- it refuses a mismatch,
which is why `wasm/Cargo.toml` pins it with `=`.

    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.96.1
    ~/.cargo/bin/rustup target add wasm32-unknown-unknown
    curl -L https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.127/\
    wasm-bindgen-0.2.127-x86_64-unknown-linux-musl.tar.gz \
        | tar xz -C ~/.local/bin --strip-components=1 --wildcards '*/wasm-bindgen'
    uv tool install maturin==1.14.1

Nothing needs root and nothing replaces `/usr/bin/cargo`.
