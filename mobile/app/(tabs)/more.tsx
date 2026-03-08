/**
 * More tab — Settings, Alerts, Orders, Sniping, and Subscription.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { colors, spacing, radius } from '../../lib/theme'

export default function MoreScreen() {
  const router = useRouter()
  const { user, walletAddress, logout } = useAuth()

  const menuItems = [
    { title: 'Price Alerts', icon: '&#x1F514;', route: '/alerts' },
    { title: 'Limit Orders', icon: '&#x1F4C8;', route: '/orders' },
    { title: 'DCA Plans', icon: '&#x1F504;', route: '/dca' },
    { title: 'Token Sniping', icon: '&#x1F3AF;', route: '/sniping' },
    { title: 'Wallets', icon: '&#x1F4B3;', route: '/settings/wallets' },
    { title: 'Settings', icon: '&#x2699;', route: '/settings' },
  ]

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User info */}
      <View style={styles.userCard}>
        <Text style={styles.userName}>
          {user?.firstName || user?.username || 'Suwappu User'}
        </Text>
        {walletAddress && (
          <Text style={styles.userAddress}>
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </Text>
        )}
      </View>

      {/* Menu grid */}
      <View style={styles.grid}>
        {menuItems.map(item => (
          <TouchableOpacity
            key={item.title}
            style={styles.gridItem}
            onPress={() => router.push(`/(features)${item.route}` as any)}
          >
            <Text style={styles.gridIcon}>{item.icon}</Text>
            <Text style={styles.gridLabel}>{item.title}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xxl },
  userCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  userName: { fontSize: 20, fontWeight: '600', color: colors.text },
  userAddress: { fontSize: 13, color: colors.textTertiary, marginTop: spacing.xs, fontFamily: 'SpaceMono' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xxxl,
  },
  gridItem: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '48%',
    alignItems: 'center',
    gap: spacing.sm,
  },
  gridIcon: { fontSize: 28 },
  gridLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  logoutText: { color: colors.error, fontSize: 16, fontWeight: '500' },
})
