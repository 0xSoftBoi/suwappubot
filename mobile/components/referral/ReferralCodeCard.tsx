/**
 * Referral code display + copy/share buttons.
 */
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import { colors, spacing, radius } from '../../lib/theme'

interface ReferralCodeCardProps {
  code: string
  timesUsed: number
}

export default function ReferralCodeCard({ code, timesUsed }: ReferralCodeCardProps) {
  const handleCopy = async () => {
    await Clipboard.setStringAsync(code)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const handleShare = async () => {
    await Share.share({
      message: `Join Suwappu and trade crypto across 7+ chains! Use my referral code: ${code}\n\nhttps://app.suwappu.xyz/ref/${code}`,
    })
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Your Referral Code</Text>
      <View style={styles.codeRow}>
        <Text style={styles.code}>{code}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.iconButton} onPress={handleCopy}>
            <FontAwesome name="copy" size={16} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
            <FontAwesome name="share" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.usage}>Used {timesUsed} times</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  code: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'SpaceMono',
    letterSpacing: 2,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  usage: { fontSize: 13, color: colors.textTertiary, marginTop: spacing.sm },
})
