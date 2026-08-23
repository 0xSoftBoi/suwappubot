// Runs `erouter.wasm` under a real Pyodide, outside a browser.
//
// The shim is the one piece of this repo that only ever executes somewhere
// CPython is not, and the differences are not theoretical: `JsBuffer` has
// `to_bytes` and no `destroy`, so three of its eight entry points raised
// `AttributeError: destroy` on every quote while passing every test here.
// Nothing but a real Pyodide would have said so.
//
//     node tests/js/pyodide_harness.mjs <script.py> [pyodide-dir]
//
// The Pyodide distribution is the one `flet publish` caches, so the version
// under test is the version that ships.  Called by tests/test_pyodide_shim.py.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PKG = join(ROOT, "src/erouter");
const WASM = join(ROOT, "rust/wasm/pkg");
const DIST = process.argv[3]
  || join(process.env.HOME, ".flet/cache/pyodide/314.0.3");

const { loadPyodide } = await import(join(DIST, "pyodide.mjs"));
const py = await loadPyodide({ indexURL: DIST + "/" });
await py.loadPackage("numpy");

// Copy the router package into Pyodide's filesystem.
function copyInto(from, to) {
  py.FS.mkdirTree(to);
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (statSync(source).isDirectory()) {
      if (name === "__pycache__") continue;
      copyInto(source, join(to, name));
    } else if (name.endsWith(".py")) {
      py.FS.writeFile(join(to, name), readFileSync(source));
    }
  }
}
copyInto(PKG, "/erouter");

// The glue, loaded the way the shim loads it -- as an ES module -- and handed
// the wasm bytes directly, since Node's fetch has no `file:` scheme.
const glue = await import(WASM + "/erouter_wasm.js");
await glue.default({ module_or_path: readFileSync(WASM + "/erouter_wasm_bg.wasm") });
py.registerJsModule("erouter_wasm_glue", glue);

py.runPython(`
import sys
sys.path.insert(0, "/")
`);
const code = readFileSync(process.argv[2], "utf8");
try {
  const out = await py.runPythonAsync(code);
  console.log(String(out));
} catch (err) {
  console.log("PYTHON ERROR:\n" + err.message);
}
