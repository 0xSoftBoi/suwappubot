// Loader for electric-router's solver+EVM wasm module (erouter-wasm).
//
// The module is built from the vendored fork at
// `flet-curve/vendor/electric-router/rust/wasm` (Rust 1.96.1, wasm-bindgen
// 0.2.127 — both pinned upstream) via `scripts/build-erouter-wasm.sh`; the
// generated glue + binary are committed under `./wasm/` because CI has no
// Rust toolchain. Regenerate with the script whenever the vendored crate
// moves.
//
// `--target web` glue: default export is async init (fetches the .wasm by URL
// relative to the module), everything else is a plain named export once init
// resolves. Vite emits `erouter_wasm_bg.wasm` as an asset via `?url`.

import wasmUrl from './wasm/erouter_wasm_bg.wasm?url'

let ready: Promise<typeof import('./wasm/erouter_wasm')> | null = null

export function loadErouter(): Promise<typeof import('./wasm/erouter_wasm')> {
  if (!ready) {
    ready = (async () => {
      const mod = await import('./wasm/erouter_wasm')
      await mod.default({ module_or_path: wasmUrl })
      return mod
    })()
  }
  return ready
}

export async function erouterVersion(): Promise<string> {
  const mod = await loadErouter()
  return mod.version()
}

export { QuoterClient, QUOTER_ADDRESS, ArcKind } from './quoter'
export type { Leg, Probe, Quote, EthCall } from './quoter'
