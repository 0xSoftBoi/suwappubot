import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { EmptyAction, ErrorState, InfoNote, LoadingState, SignedOutState } from '../src/components/screen-state'
import { useWallets } from '../src/hooks/use-gecko'
import { analytics } from '../src/lib/analytics'
import { isAuthenticated } from '../src/lib/auth'
import { friendlyMessage } from '../src/lib/messages'
import { palette, radius, spacing, styles as s } from '../src/theme'
import type { Wallet } from '../src/types/api'

/** What this address can actually receive, in plain words up front, plus a
 * discoverable technical detail for anyone who wants it — a wrong-network
 * transfer here can be permanently lost, so this can't be softened away
 * entirely, only made honest and skimmable. */
const RECEIVE_DETAIL =
  'This address only accepts USDC (a digital dollar) sent on the Base network. Sending a different token, or sending from a different network, usually can’t be recovered.'

function pickReceiveWallet(wallets: Wallet[]): Wallet | null {
  const evm = wallets.filter((w) => w.chainType.toLowerCase() === 'evm')
  return evm.find((w) => w.isDefault) ?? evm[0] ?? wallets[0] ?? null
}

export default function ReceiveScreen() {
  const signedIn = isAuthenticated()
  const wallets = useWallets(signedIn)
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (address: string) => {
    await Clipboard.setStringAsync(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  useEffect(() => { analytics.screen('Receive') }, [])

  const noWallet = wallets.data !== undefined && pickReceiveWallet(wallets.data) === null
  useEffect(() => {
    if (noWallet) analytics.track('empty_state_seen', { screen: 'receive' })
  }, [noWallet])

  if (!signedIn) return <SignedOutState />
  if (wallets.isLoading && !wallets.data) return <LoadingState label="Loading your wallet…" />
  if (wallets.isError && !wallets.data) {
    return (
      <ErrorState
        message={`Gecko couldn’t load your wallet right now. ${friendlyMessage(wallets.error)}`}
        onRetry={() => void wallets.refetch()}
      />
    )
  }

  const wallet = pickReceiveWallet(wallets.data ?? [])

  if (!wallet) {
    return (
      <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
        <EmptyAction
          title="No wallet yet"
          body="Gecko couldn’t find a wallet to receive into. This is usually set up when you first sign in — try checking again."
          actionLabel="Check again"
          onAction={() => void wallets.refetch()}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      <View style={s.card}>
        <Text style={s.muted}>Only send dollars to this address. Sending anything else may not arrive.</Text>
        <InfoNote label="What can I receive here?" detail={RECEIVE_DETAIL} />
      </View>

      <View style={[s.card, local.addressCard]}>
        <Text selectable style={local.address}>{wallet.address}</Text>
        <Pressable onPress={() => void copy(wallet.address)} accessibilityRole="button" accessibilityLabel="Copy address" style={local.copyButton}>
          <Text style={local.copyButtonText}>{copied ? 'Copied' : 'Copy address'}</Text>
        </Pressable>
        {/* No QR here — this app has no vetted, zero-native-dependency QR
            generator on hand (react-native-svg would require a native
            rebuild, and a hand-rolled encoder risks producing a code that
            looks right but doesn't scan). Copy + long-press-to-select cover
            the same job until a real QR lib is added deliberately. */}
        <Text style={local.qrNote}>A scannable code is coming soon — copy the address for now.</Text>
      </View>
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  copy: { color: palette.textSecondary, fontSize: 16, lineHeight: 22, paddingTop: spacing.sm },
  addressCard: { alignItems: 'center', gap: spacing.md },
  address: { color: palette.text, fontSize: 16, fontVariant: ['tabular-nums'], textAlign: 'center', letterSpacing: 0.3 },
  copyButton: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  copyButtonText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  qrNote: { color: palette.textMuted, fontSize: 12, textAlign: 'center' },
})
