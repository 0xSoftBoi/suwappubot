// Node WASI runner for arbiter-wasm (preview1). Usage:
//   GITHUB_WEBHOOK_SECRET=arbiter-demo-secret node run.mjs < fixture-pass.json
import { readFileSync } from 'node:fs';
import { WASI } from 'node:wasi';
import { argv, env } from 'node:process';

const wasi = new WASI({
  version: 'preview1',
  args: ['arbiter-wasm'],
  env: { GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET || 'arbiter-demo-secret' },
  preopens: {},
});

const wasmPath = argv[2] || new URL('../target/wasm32-wasip1/release/arbiter-wasm.wasm', import.meta.url).pathname;
const bytes = readFileSync(wasmPath);
const mod = await WebAssembly.compile(bytes);
const inst = await WebAssembly.instantiate(mod, wasi.getImportObject());
wasi.start(inst);
