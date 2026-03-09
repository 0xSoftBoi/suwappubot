import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Suwappu",
    identifier: "bot.suwappu.desktop",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  release: {
    baseUrl: "https://releases.suwappu.bot",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/desktop-bridge.ts",
      },
    },
    copy: {
      // Vite-built webapp (Telegram script stripped by build-webapp.sh)
      "dist/webapp/index.html": "views/mainview/index.html",
      "dist/webapp/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
