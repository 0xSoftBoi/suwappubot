/**
 * @suwappu/design-tokens — CSS Custom Properties Generator
 *
 * Generates a CSS string with all tokens as `--suwappu-*` custom properties.
 * Mirrors webapp/src/theme/suwappu.css but generated from canonical tokens.
 */

import { designTokens } from './tokens'

const t = designTokens

/**
 * Generate a CSS string containing all design tokens as custom properties.
 *
 * @param theme - 'sakura' (default consumer theme) or 'professional' (terminal theme)
 * @returns A CSS string suitable for injection into a `<style>` tag or stylesheet.
 */
export function generateCssVars(theme: 'sakura' | 'professional' = 'sakura'): string {
  const lines: string[] = []

  const push = (name: string, value: string | number) => {
    lines.push(`  --suwappu-${name}: ${value};`)
  }

  lines.push(':root {')

  // Primary colors
  push('sakura-pink-light', t.colors.brand.sakuraPinkLight)
  push('sakura-pink-mid', t.colors.brand.sakuraPinkMid)
  push('magenta-core', t.colors.brand.magentaCore)
  push('rose-gradient-start', t.colors.brand.roseGradientStart)
  push('magenta-gradient-mid', t.colors.brand.magentaGradientMid)
  push('deep-purple-gradient-end', t.colors.brand.deepPurpleGradientEnd)
  push('royal-purple-deep', t.colors.brand.royalPurpleDeep)

  // Sakura scale
  for (const [step, value] of Object.entries(t.colors.brand.sakura)) {
    push(`sakura-${step}`, value)
  }

  // Secondary colors
  push('sky-highlight', t.colors.secondary.sky)
  push('soft-cyan', t.colors.secondary.cyan)
  push('clear-blue', t.colors.secondary.blue)
  push('navy-text', t.colors.secondary.navy)
  push('deep-ocean', t.colors.secondary.ocean)

  // Semantic colors
  push('success', t.colors.semantic.success)
  push('warning', t.colors.semantic.warning)
  push('error', t.colors.semantic.error)
  push('info', t.colors.semantic.info)

  // Impact colors
  for (const [key, value] of Object.entries(t.colors.impact)) {
    push(`impact-${key}`, value)
  }

  // Transaction state colors
  for (const [key, value] of Object.entries(t.colors.txState)) {
    push(`tx-${key}`, value)
  }

  // Chain colors
  for (const [key, value] of Object.entries(t.colors.chain)) {
    push(`chain-${key}`, value)
  }

  // Provider colors
  for (const [key, value] of Object.entries(t.colors.provider)) {
    push(`provider-${key}`, value)
  }

  // Neutral colors
  push('white', t.colors.neutral.white)
  push('background', t.colors.neutral.background)
  push('text-primary', t.colors.neutral.textPrimary)
  push('text-secondary', t.colors.neutral.textSecondary)
  push('border', t.colors.neutral.border)

  // Opacity colors
  push('overlay-light', t.colors.opacity.overlayLight)
  push('overlay-medium', t.colors.opacity.overlayMedium)
  push('overlay-heavy', t.colors.opacity.overlayHeavy)
  push('glass-effect', t.colors.opacity.glassEffect)
  push('shadow-tint', t.colors.opacity.shadowTint)

  // Trading colors
  push('trading-bull', t.colors.trading.bull)
  push('trading-bear', t.colors.trading.bear)
  push('trading-bull-dim', t.colors.trading.bullDim)
  push('trading-bear-dim', t.colors.trading.bearDim)

  // Gradients
  push('gradient-primary', t.gradients.primaryBrand)
  push('gradient-button-hover', t.gradients.buttonHover)
  push('gradient-card-ambient', t.gradients.cardAmbient)
  push('gradient-glass-light', t.gradients.glassLight)
  push('gradient-glass-dark', t.gradients.glassDark)
  push('gradient-petal', t.gradients.petalGradient)
  push('gradient-feature-card', t.gradients.featureCard)

  // Typography
  push('font-display', t.typography.fontFamilies.display)
  push('font-heading', t.typography.fontFamilies.heading)
  push('font-body', t.typography.fontFamilies.body)
  push('font-ui', t.typography.fontFamilies.ui)

  // Spacing
  for (const [key, value] of Object.entries(t.spacing.scale)) {
    push(`space-${key}`, `${value}px`)
  }

  // Border radius
  for (const [key, value] of Object.entries(t.borderRadius)) {
    push(`radius-${key}`, value === 0 ? '0' : `${value}px`)
  }

  // Shadows
  push('shadow-1', t.shadows.level1)
  push('shadow-2', t.shadows.level2)
  push('shadow-3', t.shadows.level3)
  push('shadow-4', t.shadows.level4)
  push('shadow-inset', t.shadows.inset)
  push('shadow-glow', t.shadows.glow)
  push('shadow-button', t.shadows.buttonPrimary)
  push('shadow-button-hover', t.shadows.buttonHover)

  // Animation timing
  push('timing-fast', t.animations.timing.fast)
  push('timing-normal', t.animations.timing.normal)
  push('timing-slow', t.animations.timing.slow)
  push('timing-very-slow', t.animations.timing.verySlow)
  push('easing-default', t.animations.easing.default)
  push('easing-bounce', t.animations.easing.bounce)
  push('easing-spring', t.animations.easing.spring)

  lines.push('}')

  // Theme-specific surface overrides
  if (theme === 'sakura') {
    lines.push('')
    lines.push('.dark,')
    lines.push('[data-theme="dark"] {')
    push('background', t.colors.surface.sakura.background)
    push('surface', t.colors.surface.sakura.surface)
    push('surface-elevated', t.colors.surface.sakura.surfaceElevated)
    push('text-primary', t.colors.surface.sakura.textPrimary)
    push('text-secondary', t.colors.surface.sakura.textSecondary)
    push('border', t.colors.surface.sakura.border)
    lines.push('}')
  } else {
    lines.push('')
    lines.push(':root {')
    push('background', t.colors.surface.professional.background)
    push('bg-secondary', t.colors.surface.professional.bgSecondary)
    push('bg-tertiary', t.colors.surface.professional.bgTertiary)
    push('panel', t.colors.surface.professional.panel)
    push('border', t.colors.surface.professional.border)
    push('border-active', t.colors.surface.professional.borderActive)
    push('text-primary', t.colors.surface.professional.text)
    push('text-secondary', t.colors.surface.professional.textSecondary)
    push('text-muted', t.colors.surface.professional.textMuted)
    lines.push('}')
  }

  return lines.join('\n')
}
