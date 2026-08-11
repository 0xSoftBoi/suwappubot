import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { AddMoneyButton } from '../src/components/add-money-button'
import { EmptyAction, ErrorState, InfoNote, LoadingState, SignedOutState } from '../src/components/screen-state'
import { useWallets } from '../src/hooks/use-gecko'
import { analytics } from '../src/lib/analytics'
import { isAuthenticated } from '../src/lib/auth'
import { friendlyMessage } from '../src/lib/messages'
import { palette, radius, spacing, styles as s } from '../src/theme'
import { pickPrimaryEvmWallet } from '../src/lib/wallets'

/** What this address can actually receive, in plain words up front, plus a
 * discoverable technical detail for anyone who wants it — a wrong-network
 * transfer here can be permanently lost, so this can't be softened away
 * entirely, only made honest and skimmable. */
const RECEIVE_DETAIL =
  'This address only accepts USDC (a digital dollar) sent on the Base network. Sending a different token, or sending from a different network, usually can’t be recovered.'

/** Splits an address into readable 4-character groups (`0x12 3456 7890 …`)
 * so it can be read aloud or checked character-by-character without a
 * scanner — this is the fallback for devices where a QR isn't available. */
function chunkAddress(address: string): string {
  const body = address.slice(2)
  const groups = body.match(/.{1,4}/g) ?? []
  return `0x${groups.join(' ')}`
}

export default function ReceiveScreen() {
  const signedIn = isAuthenticated()
  const wallets = useWallets(signedIn)
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (address: string) => {
    analytics.track('funding_method_chosen', { method: 'address_qr' })
    await Clipboard.setStringAsync(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  const share = useCallback(async (address: string) => {
    analytics.track('funding_method_chosen', { method: 'address_qr' })
    try {
      await Share.share({ message: address })
    } catch {
      // User cancelled or the share sheet failed — nothing to recover from here.
    }
  }, [])

  useEffect(() => { analytics.screen('Receive') }, [])

  const noWallet = wallets.data !== undefined && pickPrimaryEvmWallet(wallets.data) === null
  useEffect(() => {
    if (noWallet) analytics.track('empty_state_seen', { screen: 'receive' })
  }, [noWallet])
  useEffect(() => {
    if (!noWallet && wallets.data) analytics.track('funding_method_shown', { method: 'address_qr' })
  }, [noWallet, wallets.data])

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

  const wallet = pickPrimaryEvmWallet(wallets.data ?? [])

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
        {/* No QR here — react-native-svg isn't installed in this app, and
            adding it would require a native rebuild (a hand-rolled QR
            encoder without a real renderer risks producing a code that
            looks right but doesn't scan, which is worse than no QR for a
            money app). Until that dependency is added deliberately, a
            large, chunked, selectable address plus Copy and Share cover
            the same job — anyone sharing this in person can also just
            read it aloud in groups of 4. */}
        <Text
          selectable
          accessibilityLabel={`Your receive address, ${wallet.address}`}
          style={local.address}
        >
          {chunkAddress(wallet.address)}
        </Text>
        <View style={local.actionRow}>
          <Pressable onPress={() => void copy(wallet.address)} accessibilityRole="button" accessibilityLabel="Copy address" style={[local.copyButton, local.actionButton]}>
            <Text style={local.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
          <Pressable onPress={() => void share(wallet.address)} accessibilityRole="button" accessibilityLabel="Share address" style={[local.shareButton, local.actionButton]}>
            <Text style={local.shareButtonText}>Share</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.muted}>No crypto to send yet? Buy dollars with a debit card instead — they land in this same wallet.</Text>
        <AddMoneyButton variant="secondary" />
      </View>
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  copy: { color: palette.textSecondary, fontSize: 16, lineHeight: 22, paddingTop: spacing.sm },
  addressCard: { alignItems: 'center', gap: spacing.md },
  address: { color: palette.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'center', letterSpacing: 0.5, lineHeight: 32 },
  actionRow: { flexDirection: 'row', alignSelf: 'stretch', gap: spacing.sm },
  actionButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, paddingVertical: spacing.md },
  copyButton: { backgroundColor: palette.accent },
  copyButtonText: { color: palette.bg, fontSize: 16, fontWeight: '700' },
  shareButton: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
  shareButtonText: { color: palette.text, fontSize: 16, fontWeight: '700' },
})
