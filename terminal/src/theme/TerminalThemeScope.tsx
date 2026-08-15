import type { CSSProperties, ReactNode } from "react";
import { designTokens } from "@suwappu/design-tokens";

/**
 * Terminal theme modes.
 *
 * `institutional` is the DEFAULT dark register (Bloomberg-style near-black +
 * persimmon accent). The four light modes survive as dormant opt-ins for a
 * future light toggle — there is no switcher UI today.
 */
export type TerminalThemeMode =
  | "institutional"
  | "precision"
  | "desk"
  | "studio"
  | "summer-breeze";

type TerminalThemeVars = Record<`--terminal-${string}`, string>;

/**
 * Colour channels ("r g b" triplets) consumed by `tailwind.config.js` through
 * `rgb(var(--terminal-c-*) / <alpha-value>)`. Keeping them as channels is what
 * lets Tailwind opacity modifiers (`bg-terminal-bg-tertiary/50`,
 * `bg-sakura-500/10`, `bg-bull/15`, …) keep working per-theme.
 */
type ChannelKey =
  | "canvas"
  | "bg"
  | "bg-secondary"
  | "bg-tertiary"
  | "panel"
  | "border"
  | "border-active"
  | "text"
  | "text-secondary"
  | "text-muted"
  | "accent"
  | "accent-bright"
  | "accent-deep"
  | "on-accent"
  | "up"
  | "down"
  | "up-dim"
  | "down-dim"
  | "warn"
  | "sakura-50"
  | "sakura-100"
  | "sakura-200"
  | "sakura-300"
  | "sakura-400"
  | "sakura-500"
  | "sakura-600"
  | "sakura-700"
  | "sakura-800"
  | "sakura-900";

type ChannelMap = Record<ChannelKey, string>;

/** Persimmon ramp (light themes) — mirrors designTokens.colors.brand.persimmon. */
const lightSakuraRamp = {
  "sakura-50": "255 252 247",
  "sakura-100": "255 246 234",
  "sakura-200": "252 230 194",
  "sakura-300": "246 207 133",
  "sakura-400": "237 166 80",
  "sakura-500": "229 141 43",
  "sakura-600": "211 115 34",
  "sakura-700": "183 93 33",
  "sakura-800": "134 69 33",
  "sakura-900": "91 58 36",
} as const;

/**
 * Institutional dark register. 50–300 are warm near-black persimmon washes
 * (they are backgrounds in the dark register, not tints); 400–700 are the
 * persimmon accents (they are text/border/fill); 800–900 are deep persimmon.
 */
const institutionalChannels: ChannelMap = {
  canvas: "8 9 12", // #08090C
  bg: "10 11 15", // #0A0B0F
  "bg-secondary": "18 21 27", // #12151B control
  "bg-tertiary": "22 26 33", // #161A21 control-hover / inset-raised
  panel: "14 16 20", // #0E1014
  border: "30 32 37", // #1E2025 — solid equivalent of the hairline over panel
  "border-active": "111 72 30", // persimmon 45% over panel
  text: "236 237 239", // #ECEDEF
  "text-secondary": "155 161 171", // #9BA1AB
  "text-muted": "107 114 128", // #6B7280
  accent: "229 141 43", // #E58D2B
  "accent-bright": "246 169 60", // #F6A93C
  "accent-deep": "201 115 29", // #C9731D
  "on-accent": "10 11 15", // text colour on persimmon fills (AA)
  up: "47 191 113", // #2FBF71
  down: "229 72 77", // #E5484D
  "up-dim": "18 37 27", // #12251B
  "down-dim": "42 21 23", // #2A1517
  warn: "229 161 60", // #E5A13C
  "sakura-50": "21 18 14", // #15120E
  "sakura-100": "27 23 16", // #1B1710
  "sakura-200": "36 29 20", // #241D14
  "sakura-300": "58 43 24", // #3A2B18
  "sakura-400": "246 169 60", // #F6A93C
  "sakura-500": "229 141 43", // #E58D2B
  "sakura-600": "216 128 31", // #D8801F
  "sakura-700": "201 115 29", // #C9731D
  "sakura-800": "162 87 26", // #A2571A
  "sakura-900": "124 65 20", // #7C4114
};

/** Warm light themes (precision / desk / studio). */
const warmLightChannels: ChannelMap = {
  canvas: "255 250 243",
  bg: "255 250 243",
  "bg-secondary": "255 255 255",
  "bg-tertiary": "255 248 238",
  panel: "255 255 255",
  border: "222 206 179",
  "border-active": "207 174 120",
  text: "47 34 26",
  "text-secondary": "122 98 74",
  "text-muted": "154 132 108",
  accent: "229 141 43",
  "accent-bright": "237 166 80",
  "accent-deep": "183 93 33",
  "on-accent": "255 255 255",
  up: "34 197 94",
  down: "239 68 68",
  "up-dim": "234 248 239",
  "down-dim": "252 237 234",
  warn: "217 119 6",
  ...lightSakuraRamp,
};

/** Summer-breeze light theme (cool canvas, persimmon accent). */
const summerBreezeChannels: ChannelMap = {
  canvas: "247 253 255",
  bg: "237 248 251",
  "bg-secondary": "239 251 255",
  "bg-tertiary": "229 249 253",
  panel: "241 252 255",
  border: "185 223 233",
  "border-active": "66 184 215",
  text: "23 50 74",
  "text-secondary": "79 111 127",
  "text-muted": "120 153 168",
  accent: "229 141 43",
  "accent-bright": "237 166 80",
  "accent-deep": "183 93 33",
  "on-accent": "255 255 255",
  up: "34 197 94",
  down: "239 68 68",
  "up-dim": "234 248 239",
  "down-dim": "252 237 234",
  warn: "217 119 6",
  ...lightSakuraRamp,
};

function channelVars(channels: ChannelMap): TerminalThemeVars {
  const vars = {} as TerminalThemeVars;
  for (const [key, value] of Object.entries(channels)) {
    vars[`--terminal-c-${key}`] = value;
  }
  return vars;
}

const summerBreezeGradients = designTokens.gradients.summerBreeze;
const summerBreezeColors = designTokens.colors.surface.summerBreeze;
const summerBreezeRadii = {
  panel: `${designTokens.borderRadius.md}px`,
  inset: `${designTokens.borderRadius.sm}px`,
  card: "6px",
  control: `${designTokens.borderRadius.sm}px`,
  pill: `${designTokens.borderRadius.sm}px`,
};

/** Glossy top edge used by light themes; institutional keeps a faint hairline. */
const lightEdgeHighlight =
  "linear-gradient(90deg, transparent, rgba(255,255,255,0.82), transparent)";

const shellBackgrounds: Record<TerminalThemeMode, string> = {
  institutional:
    "radial-gradient(120% 60% at 70% -10%, rgba(229,141,43,0.06), transparent 50%), linear-gradient(180deg, #08090C 0%, #0A0B0F 100%)",
  precision:
    "radial-gradient(circle at top right, rgba(229,141,43,0.14), transparent 24%), radial-gradient(circle at left center, rgba(248,228,190,0.24), transparent 18%), linear-gradient(180deg, #fffefb 0%, #fffaf3 100%)",
  desk: "radial-gradient(circle at top right, rgba(244,201,99,0.18), transparent 28%), radial-gradient(circle at left center, rgba(248,228,190,0.4), transparent 22%), linear-gradient(180deg, #fffefb 0%, #fff9f0 100%)",
  studio:
    "radial-gradient(circle at top right, rgba(244,201,99,0.22), transparent 30%), radial-gradient(circle at left center, rgba(234,244,255,0.35), transparent 26%), linear-gradient(180deg, #fffefb 0%, #fff7ed 100%)",
  "summer-breeze": summerBreezeGradients.shellBackground,
};

const themeVars: Record<TerminalThemeMode, TerminalThemeVars> = {
  /**
   * INSTITUTIONAL — the shipped register.
   * Structure comes from hairlines, not shadows: every `--terminal-shadow-*`
   * is `none` or a 1px ring so legacy references degrade gracefully. The one
   * real shadow is `--terminal-shadow-overlay` (modals / command palette).
   */
  institutional: {
    ...channelVars(institutionalChannels),
    "--terminal-color-scheme": "dark",
    "--terminal-shell-background": shellBackgrounds.institutional,
    "--terminal-panel-background": "#0E1014",
    "--terminal-inset-background": "#0B0C10",
    "--terminal-card-background": "#101318",
    "--terminal-control-background": "#12151B",
    "--terminal-control-background-hover": "#161A21",
    "--terminal-control-background-active": "#181C24",
    "--terminal-border-color": "rgba(236,237,239,0.07)",
    "--terminal-border-active-color": "rgba(229,141,43,0.45)",
    "--terminal-hairline": "rgba(236,237,239,0.07)",
    "--terminal-hairline-strong": "rgba(236,237,239,0.13)",
    "--terminal-accent-wash": "rgba(229,141,43,0.10)",
    "--terminal-accent-glow": "rgba(229,141,43,0.35)",
    "--terminal-up-wash": "rgba(47,191,113,0.10)",
    "--terminal-down-wash": "rgba(229,72,77,0.10)",
    "--terminal-radius-panel": "12px",
    "--terminal-radius-inset": "10px",
    "--terminal-radius-card": "8px",
    "--terminal-radius-control": "8px",
    "--terminal-radius-pill": "999px",
    "--terminal-shadow-panel": "none",
    "--terminal-shadow-panel-elevated": "0 0 0 1px rgba(236,237,239,0.13)",
    "--terminal-shadow-inset": "none",
    "--terminal-shadow-card": "none",
    "--terminal-shadow-control": "none",
    "--terminal-shadow-raised": "0 0 0 1px rgba(236,237,239,0.13)",
    "--terminal-shadow-overlay":
      "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(236,237,239,0.07)",
    "--terminal-button-background": "#E58D2B",
    "--terminal-button-background-hover": "#F6A93C",
    "--terminal-button-background-active": "#C9731D",
    "--terminal-button-foreground": "#0A0B0F",
    "--terminal-button-shadow": "none",
    "--terminal-button-shadow-hover": "none",
    "--terminal-heading-tracking": "-0.02em",
    "--terminal-caption-tracking": "0.08em",
    "--terminal-space-page": "12px",
    "--terminal-space-panel": "10px",
    "--terminal-space-inset": "8px",
    "--terminal-space-card": "7px",
    "--terminal-space-section": "8px",
    "--terminal-edge-highlight":
      "linear-gradient(90deg, transparent, rgba(236,237,239,0.06), transparent)",
    "--terminal-panel-orb": "none",
    "--terminal-inset-orb": "none",
    "--terminal-card-orb": "none",
    "--terminal-control-orb": "none",
  },
  precision: {
    ...channelVars(warmLightChannels),
    "--terminal-color-scheme": "light",
    "--terminal-shell-background": shellBackgrounds.precision,
    "--terminal-panel-background": "rgba(255, 255, 255, 0.96)",
    "--terminal-inset-background": "rgba(255, 249, 240, 0.92)",
    "--terminal-card-background": "rgba(255, 255, 255, 0.94)",
    "--terminal-control-background": "rgba(255, 255, 255, 0.94)",
    "--terminal-control-background-hover": "#ffffff",
    "--terminal-control-background-active": "#ffffff",
    "--terminal-border-color": "#deceb3",
    "--terminal-border-active-color": "#cfae78",
    "--terminal-hairline": "rgba(176,126,64,0.18)",
    "--terminal-hairline-strong": "rgba(176,126,64,0.32)",
    "--terminal-accent-wash": "rgba(229,141,43,0.10)",
    "--terminal-accent-glow": "rgba(229,141,43,0.35)",
    "--terminal-up-wash": "rgba(34,197,94,0.12)",
    "--terminal-down-wash": "rgba(239,68,68,0.12)",
    "--terminal-radius-panel": "18px",
    "--terminal-radius-inset": "14px",
    "--terminal-radius-card": "12px",
    "--terminal-radius-control": "12px",
    "--terminal-radius-pill": "14px",
    "--terminal-shadow-panel":
      "0 18px 36px rgba(176,126,64,0.12), 0 6px 14px rgba(216,200,166,0.14), inset 0 1px 0 rgba(255,255,255,0.86)",
    "--terminal-shadow-panel-elevated":
      "0 24px 52px rgba(176,126,64,0.16), 0 10px 20px rgba(216,200,166,0.16), inset 0 1px 0 rgba(255,255,255,0.9)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255,255,255,0.84), 0 0 0 1px rgba(255,255,255,0.24)",
    "--terminal-shadow-card":
      "0 4px 12px rgba(176,126,64,0.08), inset 0 1px 0 rgba(255,255,255,0.62)",
    "--terminal-shadow-control":
      "inset 0 1px 0 rgba(255,255,255,0.88), 0 1px 2px rgba(216,200,166,0.14)",
    "--terminal-shadow-raised":
      "0 8px 18px rgba(176,126,64,0.12), inset 0 1px 0 rgba(255,255,255,0.88)",
    "--terminal-shadow-overlay":
      "0 24px 60px rgba(176,126,64,0.22), 0 0 0 1px rgba(176,126,64,0.14)",
    "--terminal-button-background":
      "linear-gradient(180deg, #efb84a 0%, #e58d2b 100%)",
    "--terminal-button-background-hover":
      "linear-gradient(180deg, #f4c963 0%, #d37322 100%)",
    "--terminal-button-background-active":
      "linear-gradient(180deg, #e0a63c 0%, #b75d21 100%)",
    "--terminal-button-foreground": "#ffffff",
    "--terminal-button-shadow":
      "0 10px 20px rgba(229,141,43,0.18), inset 0 1px 0 rgba(255,255,255,0.34)",
    "--terminal-button-shadow-hover":
      "0 14px 26px rgba(229,141,43,0.24), inset 0 1px 0 rgba(255,255,255,0.38)",
    "--terminal-heading-tracking": "-0.045em",
    "--terminal-caption-tracking": "0.2em",
    "--terminal-space-page": "12px",
    "--terminal-space-panel": "10px",
    "--terminal-space-inset": "8px",
    "--terminal-space-card": "7px",
    "--terminal-space-section": "8px",
    "--terminal-edge-highlight": lightEdgeHighlight,
    "--terminal-panel-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, transparent 36%)",
    "--terminal-inset-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 42%)",
    "--terminal-card-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 38%)",
    "--terminal-control-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 48%)",
  },
  desk: {
    ...channelVars(warmLightChannels),
    "--terminal-color-scheme": "light",
    "--terminal-shell-background": shellBackgrounds.desk,
    "--terminal-panel-background": "#ffffff",
    "--terminal-inset-background": "#fff8ee",
    "--terminal-card-background": "rgba(255, 255, 255, 0.92)",
    "--terminal-control-background": "#ffffff",
    "--terminal-control-background-hover": "#ffffff",
    "--terminal-control-background-active": "#ffffff",
    "--terminal-border-color": "#e6d9c3",
    "--terminal-border-active-color": "#d8be90",
    "--terminal-hairline": "rgba(176,126,64,0.18)",
    "--terminal-hairline-strong": "rgba(176,126,64,0.32)",
    "--terminal-accent-wash": "rgba(229,141,43,0.10)",
    "--terminal-accent-glow": "rgba(229,141,43,0.35)",
    "--terminal-up-wash": "rgba(34,197,94,0.12)",
    "--terminal-down-wash": "rgba(239,68,68,0.12)",
    "--terminal-radius-panel": "22px",
    "--terminal-radius-inset": "18px",
    "--terminal-radius-card": "16px",
    "--terminal-radius-control": "16px",
    "--terminal-radius-pill": "18px",
    "--terminal-shadow-panel":
      "0 20px 44px rgba(176,126,64,0.14), 0 10px 22px rgba(216,200,166,0.18), inset 0 1px 0 rgba(255,255,255,0.84)",
    "--terminal-shadow-panel-elevated":
      "0 28px 60px rgba(176,126,64,0.18), 0 12px 24px rgba(216,200,166,0.2), inset 0 1px 0 rgba(255,255,255,0.9)",
    "--terminal-shadow-inset": "inset 0 1px 0 rgba(255,255,255,0.8)",
    "--terminal-shadow-card":
      "0 4px 10px rgba(176,126,64,0.08), inset 0 1px 0 rgba(255,255,255,0.62)",
    "--terminal-shadow-control":
      "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(216,200,166,0.2)",
    "--terminal-shadow-raised":
      "0 8px 18px rgba(176,126,64,0.12), inset 0 1px 0 rgba(255,255,255,0.88)",
    "--terminal-shadow-overlay":
      "0 24px 60px rgba(176,126,64,0.22), 0 0 0 1px rgba(176,126,64,0.14)",
    "--terminal-button-background":
      "linear-gradient(180deg, #f1bf57 0%, #e58d2b 100%)",
    "--terminal-button-background-hover":
      "linear-gradient(180deg, #f4c963 0%, #d37322 100%)",
    "--terminal-button-background-active":
      "linear-gradient(180deg, #e0a63c 0%, #b75d21 100%)",
    "--terminal-button-foreground": "#ffffff",
    "--terminal-button-shadow":
      "0 12px 24px rgba(229,141,43,0.22), inset 0 1px 0 rgba(255,255,255,0.36)",
    "--terminal-button-shadow-hover":
      "0 16px 30px rgba(229,141,43,0.26), inset 0 1px 0 rgba(255,255,255,0.4)",
    "--terminal-heading-tracking": "-0.04em",
    "--terminal-caption-tracking": "0.22em",
    "--terminal-space-page": "14px",
    "--terminal-space-panel": "11px",
    "--terminal-space-inset": "9px",
    "--terminal-space-card": "8px",
    "--terminal-space-section": "9px",
    "--terminal-edge-highlight": lightEdgeHighlight,
    "--terminal-panel-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 36%)",
    "--terminal-inset-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 42%)",
    "--terminal-card-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 38%)",
    "--terminal-control-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.24) 0%, transparent 48%)",
  },
  studio: {
    ...channelVars(warmLightChannels),
    "--terminal-color-scheme": "light",
    "--terminal-shell-background": shellBackgrounds.studio,
    "--terminal-panel-background": "rgba(255, 255, 255, 0.94)",
    "--terminal-inset-background": "rgba(255, 249, 240, 0.86)",
    "--terminal-card-background": "rgba(255, 255, 255, 0.9)",
    "--terminal-control-background": "rgba(255, 255, 255, 0.9)",
    "--terminal-control-background-hover": "#ffffff",
    "--terminal-control-background-active": "#ffffff",
    "--terminal-border-color": "#eadac1",
    "--terminal-border-active-color": "#d8be90",
    "--terminal-hairline": "rgba(176,126,64,0.18)",
    "--terminal-hairline-strong": "rgba(176,126,64,0.32)",
    "--terminal-accent-wash": "rgba(229,141,43,0.10)",
    "--terminal-accent-glow": "rgba(229,141,43,0.35)",
    "--terminal-up-wash": "rgba(34,197,94,0.12)",
    "--terminal-down-wash": "rgba(239,68,68,0.12)",
    "--terminal-radius-panel": "28px",
    "--terminal-radius-inset": "22px",
    "--terminal-radius-card": "18px",
    "--terminal-radius-control": "18px",
    "--terminal-radius-pill": "20px",
    "--terminal-shadow-panel":
      "0 26px 64px rgba(176,126,64,0.16), 0 12px 28px rgba(216,200,166,0.18), inset 0 1px 0 rgba(255,255,255,0.88)",
    "--terminal-shadow-panel-elevated":
      "0 34px 72px rgba(176,126,64,0.18), 0 14px 30px rgba(216,200,166,0.2), inset 0 1px 0 rgba(255,255,255,0.92)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255,255,255,0.78), 0 0 0 1px rgba(255,255,255,0.18)",
    "--terminal-shadow-card":
      "0 6px 14px rgba(176,126,64,0.1), inset 0 1px 0 rgba(255,255,255,0.68)",
    "--terminal-shadow-control":
      "inset 0 1px 0 rgba(255,255,255,0.92), 0 2px 6px rgba(216,200,166,0.18)",
    "--terminal-shadow-raised":
      "0 10px 22px rgba(176,126,64,0.14), inset 0 1px 0 rgba(255,255,255,0.9)",
    "--terminal-shadow-overlay":
      "0 24px 60px rgba(176,126,64,0.22), 0 0 0 1px rgba(176,126,64,0.14)",
    "--terminal-button-background":
      "linear-gradient(180deg, #f4c963 0%, #e58d2b 100%)",
    "--terminal-button-background-hover":
      "linear-gradient(180deg, #f6cf85 0%, #d37322 100%)",
    "--terminal-button-background-active":
      "linear-gradient(180deg, #e0a63c 0%, #b75d21 100%)",
    "--terminal-button-foreground": "#ffffff",
    "--terminal-button-shadow":
      "0 14px 28px rgba(229,141,43,0.24), inset 0 1px 0 rgba(255,255,255,0.38)",
    "--terminal-button-shadow-hover":
      "0 18px 34px rgba(229,141,43,0.28), inset 0 1px 0 rgba(255,255,255,0.42)",
    "--terminal-heading-tracking": "-0.035em",
    "--terminal-caption-tracking": "0.24em",
    "--terminal-space-page": "16px",
    "--terminal-space-panel": "12px",
    "--terminal-space-inset": "10px",
    "--terminal-space-card": "8px",
    "--terminal-space-section": "9px",
    "--terminal-edge-highlight": lightEdgeHighlight,
    "--terminal-panel-orb":
      "radial-gradient(circle at 0% 0%, rgba(255,255,255,0.56), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 40%)",
    "--terminal-inset-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 44%)",
    "--terminal-card-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 40%)",
    "--terminal-control-orb":
      "linear-gradient(180deg, rgba(255,255,255,0.26) 0%, transparent 48%)",
  },
  "summer-breeze": {
    ...channelVars(summerBreezeChannels),
    "--terminal-color-scheme": "light",
    "--terminal-shell-background": summerBreezeGradients.shellBackground,
    "--terminal-panel-background": summerBreezeGradients.panelBackground,
    "--terminal-inset-background": summerBreezeGradients.insetBackground,
    "--terminal-card-background": summerBreezeGradients.cardBackground,
    "--terminal-control-background": summerBreezeGradients.controlBackground,
    "--terminal-control-background-hover":
      summerBreezeGradients.controlBackgroundHover,
    "--terminal-control-background-active":
      summerBreezeGradients.controlBackgroundActive,
    "--terminal-border-color": summerBreezeColors.border,
    "--terminal-border-active-color": summerBreezeColors.borderActive,
    "--terminal-hairline": "rgba(33,88,110,0.16)",
    "--terminal-hairline-strong": "rgba(33,88,110,0.28)",
    "--terminal-accent-wash": "rgba(229,141,43,0.10)",
    "--terminal-accent-glow": "rgba(229,141,43,0.35)",
    "--terminal-up-wash": "rgba(34,197,94,0.12)",
    "--terminal-down-wash": "rgba(239,68,68,0.12)",
    "--terminal-radius-panel": summerBreezeRadii.panel,
    "--terminal-radius-inset": summerBreezeRadii.inset,
    "--terminal-radius-card": summerBreezeRadii.card,
    "--terminal-radius-control": summerBreezeRadii.control,
    "--terminal-radius-pill": summerBreezeRadii.pill,
    "--terminal-shadow-panel":
      "0 28px 90px rgba(14,165,233,0.1), 0 16px 36px rgba(33,88,110,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
    "--terminal-shadow-panel-elevated":
      "0 34px 104px rgba(14,165,233,0.13), 0 18px 42px rgba(33,88,110,0.08), inset 0 1px 0 rgba(255,255,255,0.94)",
    "--terminal-shadow-inset":
      "0 10px 24px rgba(33,88,110,0.04), inset 0 1px 0 rgba(255,255,255,0.82)",
    "--terminal-shadow-card":
      "0 12px 28px rgba(14,165,233,0.07), 0 4px 10px rgba(33,88,110,0.04), inset 0 1px 0 rgba(255,255,255,0.76)",
    "--terminal-shadow-control":
      "0 4px 10px rgba(33,88,110,0.06), inset 0 1px 0 rgba(255,255,255,0.92)",
    "--terminal-shadow-raised":
      "0 14px 28px rgba(14,165,233,0.11), 0 6px 14px rgba(33,88,110,0.06), inset 0 1px 0 rgba(255,255,255,0.94)",
    "--terminal-shadow-overlay":
      "0 24px 60px rgba(33,88,110,0.18), 0 0 0 1px rgba(33,88,110,0.1)",
    "--terminal-button-background": summerBreezeGradients.buttonBackground,
    "--terminal-button-background-hover":
      summerBreezeGradients.buttonBackgroundHover,
    "--terminal-button-background-active":
      summerBreezeGradients.buttonBackgroundHover,
    "--terminal-button-foreground": "#ffffff",
    "--terminal-button-shadow":
      "0 16px 30px rgba(14,165,233,0.22), 0 8px 16px rgba(33,88,110,0.08), inset 0 1px 0 rgba(255,255,255,0.4)",
    "--terminal-button-shadow-hover":
      "0 18px 34px rgba(14,165,233,0.28), 0 10px 20px rgba(33,88,110,0.1), inset 0 1px 0 rgba(255,255,255,0.44)",
    "--terminal-heading-tracking": "-0.04em",
    "--terminal-caption-tracking": "0.24em",
    "--terminal-space-page": "12px",
    "--terminal-space-panel": "10px",
    "--terminal-space-inset": "8px",
    "--terminal-space-card": "7px",
    "--terminal-space-section": "8px",
    "--terminal-edge-highlight": lightEdgeHighlight,
    "--terminal-panel-orb": summerBreezeGradients.panelOrb,
    "--terminal-inset-orb": summerBreezeGradients.insetOrb,
    "--terminal-card-orb": summerBreezeGradients.cardOrb,
    "--terminal-control-orb": summerBreezeGradients.controlOrb,
  },
};

export function TerminalThemeScope({
  children,
  mode = "institutional",
}: {
  children: ReactNode;
  mode?: TerminalThemeMode;
}) {
  const vars = themeVars[mode] ?? themeVars.institutional;

  return (
    <div
      className="terminal-theme-root"
      data-terminal-theme={mode}
      style={vars as CSSProperties}
    >
      {children}
    </div>
  );
}
