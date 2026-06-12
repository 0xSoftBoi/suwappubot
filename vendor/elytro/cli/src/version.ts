import { createRequire } from "node:module";

/**
 * Package version.
 *
 * At build time tsup replaces `__PACKAGE_VERSION__` with the literal version
 * string from package.json.  At dev time (tsx) the global doesn't exist, so we
 * fall back to reading package.json at runtime via createRequire.
 */

declare const __PACKAGE_VERSION__: string;

function resolveVersion(): string {
  // Build-time injection (tsup define)
  if (typeof __PACKAGE_VERSION__ !== "undefined") {
    return __PACKAGE_VERSION__;
  }

  // Dev-time fallback (tsx / ts-node)
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export const VERSION = resolveVersion();
