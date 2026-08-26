import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Smoke test for the committed erouter-wasm artifact: instantiate the real
// binary through the real glue and prove the module answers. Runs in bun via
// initSync (no fetch), the same code path the browser's async init compiles
// down to.
describe('erouter wasm module', () => {
  test('instantiates and reports its version', async () => {
    const glue = await import('./wasm/erouter_wasm.js')
    const bytes = readFileSync(join(import.meta.dir, 'wasm', 'erouter_wasm_bg.wasm'))
    glue.initSync({ module: new WebAssembly.Module(bytes) })
    expect(glue.version()).toBe('0.1.0')
  })

  test('exposes the solver and EVM surface the router needs', async () => {
    const glue = await import('./wasm/erouter_wasm.js')
    // wasm-bindgen exports Rust's snake_case as camelCase.
    for (const name of ['calibrate', 'splitAscend', 'findCycle', 'cancelCycles', 'Evm', 'Problem']) {
      expect(typeof (glue as Record<string, unknown>)[name]).not.toBe('undefined')
    }
  })
})
