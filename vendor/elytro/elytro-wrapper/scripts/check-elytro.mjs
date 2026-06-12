/**
 * Ensures @elytro/cli is installed globally.
 * Runs as part of postinstall before the model download.
 */

import { execSync } from "child_process";

function isElytroInstalled() {
    try {
        execSync("elytro --version", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

if (isElytroInstalled()) {
    console.log("[elytro-wrapper] @elytro/cli is already installed.");
} else {
    console.log(
        "[elytro-wrapper] @elytro/cli not found. Installing globally..."
    );
    try {
        execSync("npm install -g @elytro/cli", { stdio: "inherit" });
        console.log("[elytro-wrapper] @elytro/cli installed successfully.");
    } catch (err) {
        console.error(
            "[elytro-wrapper] Failed to install @elytro/cli automatically."
        );
        console.error(
            "[elytro-wrapper] Please install it manually: npm install -g @elytro/cli"
        );
        // Non-fatal: don't block the rest of postinstall.
    }
}
