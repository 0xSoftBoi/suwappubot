/**
 * Runtime tests for design tokens package.
 * Verifies token completeness and structural correctness.
 */
import { designTokens } from '../tokens'
import { suwappuPreset, professionalPreset } from '../tailwind-preset'
import { generateCssVars } from '../css-vars'
import { sakuraTheme, professionalTheme } from '../react-native'
import { ansiColors, colorize } from '../terminal'

let passed = 0
let failed = 0

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed++
  } else {
    failed++
    console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  FAIL: ${label}`)
  }
}

console.log('=== Design Tokens Tests ===\n')

// --- Token structure completeness ---
console.log('Token structure:')
assert(designTokens.colors.brand.magentaCore === '#E58D2B', 'brand core')
assert(designTokens.colors.brand.sakura[500] === '#E58D2B', 'sakura 500 alias')
assert(Object.keys(designTokens.colors.chain).length >= 15, 'all 15 chains')
assert(Object.keys(designTokens.colors.provider).length >= 9, 'all 9 providers')
assert(designTokens.colors.impact.severe === '#EF4444', 'impact severe')
assert(designTokens.colors.txState.pending === '#F59E0B', 'tx pending')
assert(designTokens.colors.surface.sakura.background === '#FFFDF9', 'sakura bg')
assert(designTokens.colors.surface.professional.background === '#FFFDF9', 'professional bg')
assert(designTokens.colors.trading.bull === '#22C55E', 'trading bull')
assert(designTokens.colors.trading.bullDim === '#EAF8EF', 'trading bull dim')

// Token values match original webapp tokens
eq(designTokens.colors.brand.sakuraPinkLight, '#FFF8EE', 'compat light alias maps to persimmon cream')
eq(designTokens.colors.chain.ethereum, '#627EEA', 'matches webapp chain.ethereum')
eq(designTokens.colors.chain.solana, '#9945FF', 'matches webapp chain.solana')
eq(designTokens.spacing.scale.md, 16, 'spacing md')
eq(designTokens.borderRadius.lg, 16, 'border radius lg')
eq(designTokens.typography.fontWeights.bold, 700, 'font weight bold')

// --- Tailwind presets ---
console.log('Tailwind presets:')
const sColors = (suwappuPreset.theme.extend.colors as any)
assert(sColors.suwappu['sakura-500'] === '#E58D2B', 'suwappu preset sakura-500')
assert(sColors.suwappu.magenta === '#E58D2B', 'suwappu preset magenta alias')
assert(sColors.suwappu['golden-calyx'] === '#F4C963', 'suwappu preset golden calyx')
assert(sColors.chain.ethereum === '#627EEA', 'suwappu preset chain')
assert(sColors.impact.severe === '#EF4444', 'suwappu preset impact')

const pColors = (professionalPreset.theme.extend.colors as any)
assert(pColors.terminal.bg === '#FFFDF9', 'professional terminal bg')
assert(pColors.bull === '#22C55E', 'professional bull')
assert(pColors.chain.ethereum === '#627EEA', 'professional shares chains')
assert(pColors.sakura[500] === '#E58D2B', 'professional has sakura alias scale')
assert(pColors.persimmon[500] === '#E58D2B', 'professional exposes persimmon scale')

// Animations exist
const sAnim = (suwappuPreset.theme.extend.animation as any)
assert(typeof sAnim['swap-flip'] === 'string', 'suwappu has swap-flip')
assert(typeof sAnim['price-up'] === 'string', 'suwappu has price-up')

// --- CSS vars generator ---
console.log('CSS vars:')
const cssVars = generateCssVars()
assert(cssVars.includes('--suwappu-'), 'has suwappu prefix')
assert(cssVars.includes('#E58D2B') || cssVars.includes('#e58d2b'), 'has persimmon core')
assert(cssVars.includes(':root'), 'has :root selector')

const proCss = generateCssVars('professional')
assert(proCss.includes('#FFFDF9') || proCss.includes('#fffdf9'), 'professional has studio bg')

// --- React Native themes ---
console.log('React Native themes:')
assert(typeof sakuraTheme.colors === 'object', 'sakura has colors')
assert(typeof sakuraTheme.spacing === 'object', 'sakura has spacing')
assert(typeof sakuraTheme.borderRadius === 'object', 'sakura has borderRadius')
assert(typeof sakuraTheme.shadows === 'object', 'sakura has shadows')
assert(typeof sakuraTheme.typography.fontWeights === 'object', 'sakura has fontWeights')

// RN font weights should be strings
eq(sakuraTheme.typography.fontWeights.bold, '700', 'RN font weight is string')
eq(sakuraTheme.typography.fontWeights.regular, '400', 'RN font weight regular')

// Shadows should have RN format
const shadow = sakuraTheme.shadows.level1
assert('shadowColor' in shadow, 'shadow has shadowColor')
assert('shadowOffset' in shadow, 'shadow has shadowOffset')
assert('elevation' in shadow, 'shadow has elevation')

assert(typeof professionalTheme.colors === 'object', 'professional has colors')

// Chain colors available in RN
assert(sakuraTheme.colors.chain.ethereum === '#627EEA', 'RN chain ethereum')
assert(sakuraTheme.colors.chain.solana === '#9945FF', 'RN chain solana')
assert(professionalTheme.colors.surface.panel === '#FFFFFF', 'RN professional panel')

// --- Terminal ANSI ---
console.log('Terminal ANSI:')
assert(ansiColors.reset === '\x1b[0m', 'reset code')
assert(ansiColors.magenta.includes('\x1b[38;2;'), 'magenta is 24-bit')
const colored = colorize('hello', 'magenta')
assert(colored.includes('hello'), 'colorize includes text')
assert(colored.includes('\x1b[0m'), 'colorize includes reset')
assert(ansiColors.terminalText === '\x1b[38;2;47;34;26m', 'terminal text matches studio palette')

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
