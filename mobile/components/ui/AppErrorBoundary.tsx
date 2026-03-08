/**
 * Custom error boundary — dark-themed fallback screen.
 * Replaces expo-router's default ErrorBoundary export.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface Props {
  error: Error
  retry: () => void
}

export function AppErrorBoundary({ error, retry }: Props) {
  if (__DEV__) {
    console.error('[AppErrorBoundary]', error)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>!</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        {error.message || 'An unexpected error occurred.'}
      </Text>
      <TouchableOpacity style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  icon: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.error,
    marginBottom: spacing.lg,
    width: 72,
    height: 72,
    lineHeight: 72,
    textAlign: 'center',
    borderWidth: 3,
    borderColor: colors.error,
    borderRadius: 36,
    overflow: 'hidden',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
