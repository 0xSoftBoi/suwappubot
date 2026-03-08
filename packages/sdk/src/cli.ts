#!/usr/bin/env bun
/**
 * CLI entry point for @suwappu/sdk
 * Usage: suwappu <command> [args...]
 *
 * Re-exports the openclaw CLI with the `suwappu` binary name.
 */

import "./index"; // ensure module resolution
// Re-run the openclaw CLI
await import("@suwappu/openclaw/src/cli");
