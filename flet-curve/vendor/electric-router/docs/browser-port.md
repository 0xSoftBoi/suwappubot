# Porting the router into a Flet frontend

Written for an agent doing the port. Read `theory.md` for what the thing is,
and `router.md` if the frontend is going to execute rather than only quote;
this is only what it takes to run it in a browser.

The target is Flet on Pyodide in a Web Worker, whose runtime dependency list is
`flet` + `flet-charts`. No web3.py, no eth-abi, no titanoboa: compiled
dependencies make a wasm32 build either impossible or enormous.

**The port has been designed for since the first commit.** Most of the work is
filling seams that already exist, not carving new ones. What follows is where
they are and where the traps are.

---

## 1. What you are porting

`src/erouter/core/` and nothing else. Its module-scope imports, measured:

```
__future__ bisect collections copy dataclasses decimal enum functools
heapq math numpy os shutil time typing
```

stdlib plus numpy. `tests/test_purity.py` fails the build if `boa`, `requests`,
`eth_abi`, `web3`, `vyper`, `urllib` or a module-scope `scipy` appears there.
**Run it first and run it last** — it is the only thing standing between you and
a rewrite discovered on port day.

`os` is one `environ.get`, `shutil` is `get_terminal_size`. Both exist in
Pyodide.

## 2. The four seams

### Transport — already a Protocol

`core/transport.py` is the entire surface between the solver and a chain: run
this `eth_call` at this block. Hand it the frontend's own provider.
`flet-curve-demo` already exposes the shape (`WalletProvider.request` /
`.call`).

`Answer` is **three-state on purpose** and you must keep it that way. A Curve
pool that does not implement a function returns *empty data* rather than
reverting, and `decode_uint("0x") == 0`, so conflating "call succeeded" with
"call returned a value" quotes real mainnet pools at zero. `Status` is
`VALUE | WRONG_ABI | REVERTED | MISSING`.

### Quoter — already deployed

`RouteQuoter.vy` is live at **`0x9a32418b9fd744efd6820577037529d5ba9de679`** on
every supported chain, deployed through the canonical CREATE2 proxy so the
address is a function of the initcode. `core/quoter.py` builds its calldata and
decodes its replies with no help from `dev/`.

This is what removes boa from the browser entirely. The state-override host in
`dev/boa_host.py` exists for chains where the quoter is not deployed yet and for
tests; production does not need it. Note that changing `RouteQuoter.vy` moves
the address.

### Universe — no seam exists yet, build one

There is **no `UniverseSource` protocol** in the tree; the plan proposed one and
it was never built. `dev/universe.py` and `dev/curve_api.py` are the reference
implementation, and `curve_api.py` is `urllib`, so it cannot come as-is.

`flet-curve-demo/src/curve/api.py` already implements this shape
(`CurveApi.list_pools`, TTL cache, `PoolFeed` cursor). Define the protocol
against what `load_pools` actually returns — a list of `PoolSpec` — and let the
frontend supply it. Two API traps that will bite: the default urllib UA gets
**403**, and `lp_token_address` is `null` in the list response, so LP tokens are
resolved on-chain.

### Rendering — already split

`core/rendermodel.py` emits a structured `Diagram` — buses, branches, elements,
annotations, node potentials. `core/render_text.py` is one consumer of it. Flet
renders the same model with controls instead of box-drawing characters. Do not
parse the terminal output.

## 3. The Rust extension

`rust/` is already written for three targets and the constraints are in
`Cargo.toml` rather than in someone's memory:

```toml
crate-type = ["cdylib", "rlib"]      # Python ext, bare wasm, and linkable core
[features]
bench  = []                          # native only: pulls in a clock
python = ["dep:pyo3"]                # optional, so the core compiles without Python
```

- **CPython**: `maturin build --features python`, PyO3 with `abi3-py311`.
- **Pyodide**: the same extension for `wasm32-unknown-emscripten`. The
  Emscripten version must match the one the target Pyodide was built with —
  this is the usual source of a wheel that builds and will not load.
- **Bare wasm for a Worker**: the `rlib` plus a thin `wasm-bindgen` wrapper, for
  a frontend that would rather not cross into Python at all.

Three properties are load-bearing and you must not regress them:

**No I/O, no threads, no clock, no allocator tricks.** A Worker has no
filesystem and no `std::time`. Anything touching them compiles on the host and
fails in the browser — which is why `bench` is a feature and not a default.

**No BLAS or LAPACK.** The dense solves are `n ≈ 50` (median, mainnet) and a
hand-written LU with partial pivoting beats binding a Fortran library that has
no wasm build. It is ~40 lines in `lu.rs`.

**Arrays cross as plain lists, not numpy buffers.** That keeps the extension
clear of the numpy C API, which is the fiddliest part of shipping a native
module into Pyodide, and it is why one wheel works in CPython, in Pyodide and in
a Worker. Do not "optimise" this into a buffer protocol.

`core/accel.py` tries the import and every caller has a pure-Python path when it
is absent, so the frontend degrades rather than fails. Keep it that way.

**Do not ship it as the default yet.** See §6.

## 4. What must not come across

`dev/` is CPython-only by intent. Some of it is portable by accident and that is
a trap: `boa_host.py`, `local_evm.py` and `executor.py` import `boa`/`pyrevm`
*lazily inside functions*, so a module-scope scan calls them clean. They are not.

Genuinely blocked at module scope: `rpc.py` (urllib, threading, concurrent),
`curve_api.py` (urllib), `cli.py`, `config.py` (importlib on a gitignored file),
`cache.py` (tempfile), `state_cache.py` (gzip).

### The subtle one: exact models are split across the boundary

`core/stableswap.py`, `twocrypto.py`, `tricrypto.py`, `vault.py` **evaluate** an
invariant from parameters and are pure. The readers that obtain those parameters
and, crucially, **gate them** — `dev/stable_params.py`, `twocrypto_params.py`,
`tricrypto_params.py`, `vault_params.py`, `lp_params.py`, `lending_params.py`,
`exact_cache.py`, `exact_probe.py` — are in `dev/` by intent, not by dependency.
Measured, every one of them is stdlib + numpy at module scope.

So you have a real choice, and it is the most consequential one in the port:

1. **Move the readers into `core/`** and run the wei-exact gate in the browser.
   It needs only `client.probe()` and `client.raw()`, both of which go through
   the deployed quoter over the transport you already have. Costs a batch of
   probes at startup; keeps the safety argument intact.
2. **Ship verdicts and parameters from a server.** Cheaper at startup, and it
   moves the trust boundary: the frontend would be believing a model it did not
   check. If you do this, ship the `math_fingerprint` with them and refuse a
   mismatch — that is what stops a stale model being trusted after an invariant
   changes.

Do not take a third option where the browser uses the models without the gate.
A model that matches where it was checked and diverges elsewhere is worse than
no model, because nothing downstream will ever ask again.

## 5. Acceptance

```bash
uv run pytest -q tests/test_purity.py      # first and last
uv run python -c "import erouter.core.pipeline"   # with only numpy installed
```

Then, in the target:

- the same route, same pinned block, byte-identical to the CPython answer;
- `Answer.status` distinguishes `WRONG_ABI` from `REVERTED` on a pool that
  implements neither `get_dy` spelling;
- a quote with the Rust extension absent, and one with it present, agreeing;
- the `Diagram` rendering in Flet controls without going through
  `render_text.py`.

## 6. Traps

**The numpy bundle is the one genuine unknown.** scipy is already optional by
construction. If numpy also proves too heavy, the remaining port is a dense-list
rewrite of `solve.py`, `graph.py` and `linalg.py` — bounded, and those
interfaces are already the right shape for it. Measure the bundle before
committing.

**The Rust and Python solvers disagree where the solve does not converge.**
`USDC → WETH $20M` returns 7,166 WETH through Python and 7,185 through Rust at
the same block; at $5M they are identical. Those quotes reach `maxit` and cycle
under Bland's rule. Until that is closed, the browser build should either run
the Python path or surface which solver answered.

**A pinned block is not optional.** Nothing downstream may see `"latest"`. A
quote is only comparable to another if both read the same state, and the pool
list is the one input `--block` does not pin — hence the universe fingerprint.

**Do not port the terminal's numbers.** `amount_out` in the JSON is the chain's
figure where there is one and `modelled_out` is the model's; they agree to a
fraction of a bp until they do not.
