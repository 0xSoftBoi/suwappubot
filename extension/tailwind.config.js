/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Suwappu brand surface palette (dark-first, matches terminal/).
        bg: "#0a0b0e",
        surface: "#13151a",
        elevated: "#1c1f27",
        border: "#272b35",
        accent: "#6ee7b7",
        "accent-dim": "#34d399",
        danger: "#f87171",
        warn: "#fbbf24",
        muted: "#8b909a",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
