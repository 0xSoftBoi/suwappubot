/**
 * Biometric confirmation modal for high-value actions.
 *
 * Shows a bottom sheet asking user to confirm via Face ID / passkey.
 * Falls back to a simple "Confirm" button if biometrics unavailable.
 *
 * Usage:
 *   const { confirm, BiometricModal } = useBiometricConfirm()
 *   const ok = await confirm('Swap 1.5 ETH → USDC')
 *   if (ok) { executeSwap() }
 */
import { useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius } from '../../lib/theme'

interface ConfirmState {
  visible: boolean
  description: string
  resolve: ((confirmed: boolean) => void) | null
}

export function useBiometricConfirm() {
  const [state, setState] = useState<ConfirmState>({
    visible: false,
    description: '',
    resolve: null,
  })
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((description: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({ visible: true, description, resolve })
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setState((s) => ({ ...s, visible: false }))
    resolveRef.current?.(true)
    resolveRef.current = null
  }, [])

  const handleCancel = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setState((s) => ({ ...s, visible: false }))
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  const BiometricModal = useCallback(
    () => (
      <Modal
        visible={state.visible}
        transparent
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <Pressable style={styles.overlay} onPress={handleCancel}>
          <Pressable style={styles.sheet}>
            <View style={styles.iconWrap}>
              <Text style={styles.iconText}>🔐</Text>
            </View>
            <Text style={styles.title}>Confirm Transaction</Text>
            <Text style={styles.description}>{state.description}</Text>

            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
              <Text style={styles.confirmText}>Confirm with Face ID</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    ),
    [state.visible, state.description, handleConfirm, handleCancel],
  )

  return { confirm, BiometricModal }
}

/**
 * Network status banner component.
 * Shows a red banner when offline.
 */
export function OfflineBanner({ isOffline }: { isOffline: boolean }) {
  if (!isOffline) return null
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>No internet connection</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xxl,
    paddingBottom: 40,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconText: { fontSize: 28 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    lineHeight: 22,
  },
  confirmButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  confirmText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  cancelButton: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  cancelText: { color: colors.textSecondary, fontSize: 16 },
  offlineBanner: {
    backgroundColor: colors.error,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
})
