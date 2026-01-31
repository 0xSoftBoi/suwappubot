/**
 * Settings screen — slippage, notifications, 2FA, account info.
 */
import { useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import Slider from '@react-native-community/slider'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { colors, spacing, radius } from '../../../lib/theme'

export default function SettingsScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['userProfile'],
    queryFn: () => api.getUserPreferences(),
  })

  const prefs = data?.preferences
  const user = data?.user

  const [slippage, setSlippage] = useState(50) // basis points
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [twoFaThreshold, setTwoFaThreshold] = useState(100)
  const [mevProtection, setMevProtection] = useState(true)

  useEffect(() => {
    if (prefs) {
      setSlippage(prefs.defaultSlippage ?? 50)
      setNotificationsEnabled(prefs.notificationsEnabled ?? true)
      setTwoFaEnabled(prefs.twoFaEnabled ?? false)
      setTwoFaThreshold(prefs.twoFaThreshold ?? 100)
    }
  }, [prefs])

  const updateMutation = useMutation({
    mutationFn: (update: Record<string, unknown>) => api.updateUserPreferences(update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile'] })
    },
  })

  const saveSlippage = (value: number) => {
    const bps = Math.round(value)
    setSlippage(bps)
    updateMutation.mutate({ defaultSlippage: bps })
  }

  const toggleNotifications = (value: boolean) => {
    setNotificationsEnabled(value)
    updateMutation.mutate({ notificationsEnabled: value })
  }

  const toggleTwoFa = (value: boolean) => {
    setTwoFaEnabled(value)
    updateMutation.mutate({ twoFaEnabled: value })
  }

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.text} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Trading */}
      <Text style={styles.sectionTitle}>Trading</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Default Slippage</Text>
          <Text style={styles.value}>{(slippage / 100).toFixed(1)}%</Text>
        </View>
        <Slider
          minimumValue={50}
          maximumValue={500}
          step={10}
          value={slippage}
          onSlidingComplete={saveSlippage}
          onValueChange={setSlippage}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.borderLight}
          thumbTintColor={colors.primary}
        />
        <Text style={styles.hint}>0.5% - 5.0% (higher = more tolerance for price movement)</Text>

        <View style={[styles.row, { marginTop: spacing.lg }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>MEV Protection</Text>
            <Text style={styles.hint}>Use Jito/CoW for sandwich attack prevention</Text>
          </View>
          <Switch
            value={mevProtection}
            onValueChange={setMevProtection}
            trackColor={{ false: colors.borderLight, true: colors.success }}
          />
        </View>
      </View>

      {/* Notifications */}
      <Text style={styles.sectionTitle}>Notifications</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Push Notifications</Text>
            <Text style={styles.hint}>Alerts, order fills, DCA executions</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={toggleNotifications}
            trackColor={{ false: colors.borderLight, true: colors.success }}
          />
        </View>
      </View>

      {/* Security */}
      <Text style={styles.sectionTitle}>Security</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>2FA for Transactions</Text>
            <Text style={styles.hint}>Require confirmation for large trades</Text>
          </View>
          <Switch
            value={twoFaEnabled}
            onValueChange={toggleTwoFa}
            trackColor={{ false: colors.borderLight, true: colors.success }}
          />
        </View>
        {twoFaEnabled && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={styles.row}>
              <Text style={styles.label}>2FA Threshold</Text>
              <Text style={styles.value}>${twoFaThreshold}</Text>
            </View>
            <Slider
              minimumValue={10}
              maximumValue={10000}
              step={10}
              value={twoFaThreshold}
              onSlidingComplete={(v) => {
                const val = Math.round(v)
                setTwoFaThreshold(val)
                updateMutation.mutate({ twoFaThreshold: val })
              }}
              onValueChange={(v) => setTwoFaThreshold(Math.round(v))}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.borderLight}
              thumbTintColor={colors.primary}
            />
            <Text style={styles.hint}>Require 2FA for trades above this USD amount</Text>
          </View>
        )}
      </View>

      {/* Account */}
      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.card}>
        {user?.username && (
          <View style={styles.row}>
            <Text style={styles.label}>Username</Text>
            <Text style={styles.value}>{user.username}</Text>
          </View>
        )}
        {user?.firstName && (
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>
              {user.firstName} {user.lastName || ''}
            </Text>
          </View>
        )}
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Text style={styles.label}>App Version</Text>
          <Text style={styles.value}>1.0.0</Text>
        </View>
      </View>

      {/* Legal */}
      <Text style={styles.sectionTitle}>Legal</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/(features)/legal/privacy' as any)}
        >
          <Text style={styles.label}>Privacy Policy</Text>
          <Text style={styles.value}>&#x203A;</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, { marginTop: spacing.lg }]}
          onPress={() => router.push('/(features)/legal/terms' as any)}
        >
          <Text style={styles.label}>Terms of Service</Text>
          <Text style={styles.value}>&#x203A;</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl, paddingBottom: 60 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.xxl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  value: {
    fontSize: 16,
    color: colors.textSecondary,
    fontFamily: 'SpaceMono',
  },
  hint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
})
