/**
 * More tab — Settings, Alerts, Orders, Sniping, and Subscription.
 */
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'

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
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 24 },
  userCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  userName: { fontSize: 20, fontWeight: '600', color: '#fff' },
  userAddress: { fontSize: 13, color: '#666', marginTop: 4, fontFamily: 'SpaceMono' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 32,
  },
  gridItem: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    width: '48%',
    alignItems: 'center',
    gap: 8,
  },
  gridIcon: { fontSize: 28 },
  gridLabel: { fontSize: 14, color: '#fff', fontWeight: '500' },
  logoutButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: { color: '#f87171', fontSize: 16, fontWeight: '500' },
})
