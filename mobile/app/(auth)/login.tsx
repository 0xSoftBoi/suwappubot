/**
 * Login screen — authenticate with existing passkey or OAuth.
 */
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useState } from 'react'

export default function LoginScreen() {
  const { loginWithPasskey, loginWithOAuth } = useAuth()
  const router = useRouter()
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePasskeyLogin = async () => {
    setIsLoggingIn(true)
    setError(null)
    try {
      const success = await loginWithPasskey()
      if (success) {
        router.replace('/(tabs)')
      } else {
        setError('Authentication failed. Try again or use another method.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsLoggingIn(false)
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in with Face ID or Touch ID</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handlePasskeyLogin}
          disabled={isLoggingIn}
        >
          {isLoggingIn ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign In with Passkey</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.oauthButton}
          onPress={() => loginWithOAuth('google').then(ok => ok && router.replace('/(tabs)'))}
        >
          <Text style={styles.oauthButtonText}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.oauthButton}
          onPress={() => loginWithOAuth('twitter').then(ok => ok && router.replace('/(tabs)'))}
        >
          <Text style={styles.oauthButtonText}>Continue with X (Twitter)</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', paddingHorizontal: 24, paddingTop: 60 },
  backButton: { marginBottom: 40 },
  backText: { color: '#888', fontSize: 16 },
  content: { gap: 16 },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 24 },
  error: { color: '#ff4444', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  primaryButton: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#000', fontSize: 17, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#222' },
  dividerText: { color: '#666', paddingHorizontal: 12, fontSize: 13 },
  oauthButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  oauthButtonText: { color: '#fff', fontSize: 15, fontWeight: '500' },
})
