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
  sakuraPinkLight: '\x1b[38;2;255;209;220m',
  sakuraPink: '\x1b[38;2;255;183;197m',
  magenta: '\x1b[38;2;233;30;140m',
  rose: '\x1b[38;2;248;165;194m',
  magentaMid: '\x1b[38;2;196;69;105m',
  purple: '\x1b[38;2;108;52;131m',
  purpleDeep: '\x1b[38;2;74;35;90m',

  // Secondary
  sky: '\x1b[38;2;232;244;253m',
  cyan: '\x1b[38;2;179;229;252m',
  blue: '\x1b[38;2;135;206;235m',
  navy: '\x1b[38;2;26;35;126m',
  ocean: '\x1b[38;2;13;27;76m',

  // Semantic
  success: '\x1b[38;2;168;230;163m',
  warning: '\x1b[38;2;255;228;160m',
  error: '\x1b[38;2;248;160;160m',
  info: '\x1b[38;2;144;202;249m',

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
  terminalText: '\x1b[38;2;226;226;240m',
  terminalTextSecondary: '\x1b[38;2;136;136;160m',
  terminalTextMuted: '\x1b[38;2;85;85;106m',

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
