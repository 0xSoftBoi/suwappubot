/**
 * Welcome / onboarding screen.
 */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useState } from 'react'
import { colors, spacing, radius } from '../../lib/theme'

export default function WelcomeScreen() {
  const { registerWithPasskey, loginWithOAuth } = useAuth()
  const router = useRouter()
  const [isRegistering, setIsRegistering] = useState(false)

  const handleCreateAccount = async () => {
    setIsRegistering(true)
    try {
      const success = await registerWithPasskey()
      if (success) {
        router.replace('/(tabs)')
      }
    } finally {
      setIsRegistering(false)
    }
  }

  const handleOAuth = async (provider: 'google' | 'twitter') => {
    const success = await loginWithOAuth(provider)
    if (success) {
      router.replace('/(tabs)')
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>Suwappu</Text>
        <Text style={styles.tagline}>Cross-chain trading{'\n'}powered by AI</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleCreateAccount}
          disabled={isRegistering}
        >
          <Text style={styles.primaryButtonText}>
            {isRegistering ? 'Creating...' : 'Create Account with Face ID'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text style={styles.secondaryButtonText}>Sign In</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.oauthRow}>
          <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuth('google')}>
            <Text style={styles.oauthButtonText}>Google</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.oauthButton} onPress={() => handleOAuth('twitter')}>
            <Text style={styles.oauthButtonText}>X (Twitter)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: 120,
    paddingBottom: 60,
  },
  hero: { alignItems: 'center' },
  logo: { fontSize: 42, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  tagline: { fontSize: 18, color: colors.textSecondary, textAlign: 'center', lineHeight: 26 },
  actions: { gap: spacing.lg },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.text, fontSize: 17, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textTertiary, paddingHorizontal: spacing.md, fontSize: 13 },
  oauthRow: { flexDirection: 'row', gap: spacing.md },
  oauthButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  oauthButtonText: { color: colors.text, fontSize: 15, fontWeight: '500' },
})
