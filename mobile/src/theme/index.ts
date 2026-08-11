/**
 * Theme, sourced from @suwappu/design-tokens/react-native so the app is
 * visually identical to the webapp, showcase and terminal without a second
 * copy of the palette drifting out of sync.
 *
 * Styles are resolved once at module scope via StyleSheet.create, never inside
 * render. Inline style objects allocate on every frame and defeat React
 * Native's style registry diffing — on a scrolling list that shows up directly
 * as dropped frames.
 */
import { StyleSheet } from 'react-native'
import { professionalTheme } from '@suwappu/design-tokens/react-native'

export const theme = professionalTheme

const s = theme.colors.surface

export const palette = {
  bg: s.background,
  surface: s.bgSecondary,
  surfaceElevated: s.panel,
  border: s.border,
  borderActive: s.borderActive,
  text: s.text,
  textSecondary: s.textSecondary,
  textMuted: s.textMuted,
  accent: theme.colors.brand.persimmonCore,
  accentSoft: theme.colors.brand.sunlitFlesh,
  success: theme.colors.trading.bull,
  danger: theme.colors.trading.bear,
  warning: theme.colors.semantic.warning,
} as const

export const spacing = theme.spacing
export const radius = theme.borderRadius

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  container: { flex: 1, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  title: { color: palette.text, fontSize: 30, fontWeight: '700' },
  heading: { color: palette.text, fontSize: 17, fontWeight: '600' },
  body: { color: palette.text, fontSize: 16 },
  muted: { color: palette.textMuted, fontSize: 13 },
})
