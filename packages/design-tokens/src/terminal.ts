/**
 * @suwappu/design-tokens — ANSI Terminal Colors
 *
 * True-color (24-bit) ANSI escape sequences for TUI/CLI apps.
 */

/**
 * ANSI 24-bit foreground color codes for key brand and semantic colors.
 *
 * Usage:
 *   console.log(`${ansiColors.sakuraPink}Hello${ansiColors.reset}`)
 */
export const ansiColors = {
  // Brand
  sakuraPinkLight: '\x1b[38;2;255;248;238m',
  sakuraPink: '\x1b[38;2;246;207;133m',
  magenta: '\x1b[38;2;229;141;43m',
  rose: '\x1b[38;2;244;201;99m',
  magentaMid: '\x1b[38;2;211;115;34m',
  purple: '\x1b[38;2;183;93;33m',
  purpleDeep: '\x1b[38;2;91;58;36m',

  // Secondary
  sky: '\x1b[38;2;234;244;255m',
  cyan: '\x1b[38;2;216;238;248m',
  blue: '\x1b[38;2;165;203;238m',
  navy: '\x1b[38;2;52;80;106m',
  ocean: '\x1b[38;2;107;152;191m',

  // Semantic
  success: '\x1b[38;2;115;195;143m',
  warning: '\x1b[38;2;231;199;106m',
  error: '\x1b[38;2;217;120;99m',
  info: '\x1b[38;2;127;182;232m',

  // Impact
  impactNegligible: '\x1b[38;2;74;222;128m',
  impactLow: '\x1b[38;2;34;197;94m',
  impactMedium: '\x1b[38;2;250;204;21m',
  impactHigh: '\x1b[38;2;249;115;22m',
  impactSevere: '\x1b[38;2;239;68;68m',

  // Transaction states
  txPending: '\x1b[38;2;245;158;11m',
  txConfirming: '\x1b[38;2;59;130;246m',
  txBridging: '\x1b[38;2;139;92;246m',
  txSuccess: '\x1b[38;2;34;197;94m',
  txFailed: '\x1b[38;2;239;68;68m',
  txExpired: '\x1b[38;2;107;114;128m',

  // Trading
  bull: '\x1b[38;2;34;197;94m',
  bear: '\x1b[38;2;239;68;68m',

  // Terminal surface
  terminalText: '\x1b[38;2;47;34;26m',
  terminalTextSecondary: '\x1b[38;2;123;106;87m',
  terminalTextMuted: '\x1b[38;2;173;152;126m',

  // Chain brands
  chainEthereum: '\x1b[38;2;98;126;234m',
  chainSolana: '\x1b[38;2;153;69;255m',
  chainBase: '\x1b[38;2;0;82;255m',
  chainArbitrum: '\x1b[38;2;40;160;240m',
  chainOptimism: '\x1b[38;2;255;4;32m',

  // Formatting
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  reset: '\x1b[0m',
} as const

export type AnsiColorKey = keyof typeof ansiColors

/**
 * Wrap text with an ANSI color code and automatic reset.
 *
 * @example
 *   colorize('Swap complete!', 'success') // green text, auto-reset
 */
export function colorize(text: string, color: AnsiColorKey): string {
  return `${ansiColors[color]}${text}${ansiColors.reset}`
}
