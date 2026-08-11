import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { ErrorState, LoadingState, SignedOutState } from '../src/components/screen-state'
import { useWallets } from '../src/hooks/use-gecko'
import { isAuthenticated } from '../src/lib/auth'
import { palette, radius, spacing, styles as s } from '../src/theme'
import type { Wallet } from '../src/types/api'

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

  if (!signedIn) return <SignedOutState />
  if (wallets.isLoading && !wallets.data) return <LoadingState label="Loading your wallet…" />
  if (wallets.isError && !wallets.data) {
    return <ErrorState message="Gecko couldn’t load your wallet." onRetry={() => void wallets.refetch()} />
  }

  const wallet = pickReceiveWallet(wallets.data ?? [])

  if (!wallet) {
    return (
      <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
        <View style={s.card}>
          <Text style={s.heading}>No wallet yet</Text>
          <Text selectable style={local.copy}>Gecko couldn’t find a wallet to receive into.</Text>
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content}>
      <View style={s.card}>
        <Text style={s.muted}>Only send USDC on Base to this address. Other networks or tokens may be lost.</Text>
      </View>

      <View style={[s.card, local.addressCard]}>
        <Text selectable style={local.address}>{wallet.address}</Text>
        <Pressable onPress={() => void copy(wallet.address)} style={local.copyButton}>
          <Text style={local.copyButtonText}>{copied ? 'Copied' : 'Copy address'}</Text>
        </Pressable>
        {/* No QR here — this app has no vetted, zero-native-dependency QR
            generator on hand (react-native-svg would require a native
            rebuild, and a hand-rolled encoder risks producing a code that
            looks right but doesn't scan). Copy + long-press-to-select cover
            the same job until a real QR lib is added deliberately. */}
        <Text style={local.qrNote}>QR code coming soon — copy the address for now.</Text>
      </View>
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  copy: { color: palette.textSecondary, fontSize: 15, lineHeight: 22, paddingTop: spacing.sm },
  addressCard: { alignItems: 'center', gap: spacing.md },
  address: { color: palette.text, fontSize: 15, fontVariant: ['tabular-nums'], textAlign: 'center', letterSpacing: 0.3 },
  copyButton: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: palette.accent, borderRadius: radius.lg, paddingVertical: spacing.md },
  copyButtonText: { color: palette.bg, fontSize: 15, fontWeight: '700' },
  qrNote: { color: palette.textMuted, fontSize: 12, textAlign: 'center' },
})
