import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SignedOutState } from '../../src/components/screen-state'
import { useAskGecko } from '../../src/hooks/use-gecko'
import { analytics } from '../../src/lib/analytics'
import { getAuthRevision, isAuthenticated } from '../../src/lib/auth'
import { palette, spacing, styles as s } from '../../src/theme'

const STARTERS = ['What changed?', 'How concentrated am I?', 'What have I done lately?']
type Exchange = { id: number; authRevision: number; question: string; answer: string }

export default function AskScreen() {
  const signedIn = isAuthenticated()
  const authRevision = getAuthRevision()
  const ask = useAskGecko()
  const [text, setText] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [suggestions, setSuggestions] = useState(STARTERS)

  const submit = useCallback((prompt?: string) => {
    const question = (prompt ?? text).trim()
    if (!question || ask.isPending || !signedIn) return
    ask.reset()
    setText('')
    ask.mutate(question, {
      onSuccess: (response) => {
        setExchanges((current) => [
          ...current,
          { id: Date.now(), authRevision, question, answer: response.answer },
        ])
        if (response.suggestions?.length) setSuggestions(response.suggestions)
      },
      onError: () => setText(question),
    })
  }, [ask, authRevision, signedIn, text])

  useEffect(() => { analytics.screen('Ask') }, [])

  if (!signedIn) return <SignedOutState />

  return (
    <ScrollView style={s.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.heading}>Ask about your money</Text>
        <Text style={local.copy}>Gecko can explain what it can see. This preview can’t move money.</Text>
      </View>
      {exchanges.filter((exchange) => exchange.authRevision === authRevision).map((exchange) => (
        <View key={exchange.id} style={local.exchange}>
          <Text selectable style={local.question}>{exchange.question}</Text>
          <Text selectable style={local.answer}>{exchange.answer}</Text>
        </View>
      ))}
      <View style={local.suggestions}>
        {suggestions.slice(0, 3).map((suggestion) => <Pressable key={suggestion} onPress={() => submit(suggestion)} style={local.chip}><Text style={local.chipText}>{suggestion}</Text></Pressable>)}
      </View>
      <View style={local.composer}>
        <TextInput value={text} onChangeText={setText} maxLength={1000} placeholder="Ask Gecko…" placeholderTextColor={palette.textMuted} style={local.input} returnKeyType="send" onSubmitEditing={() => submit()} editable={!ask.isPending} />
        <Pressable onPress={() => submit()} disabled={!text.trim() || ask.isPending} style={[local.send, (!text.trim() || ask.isPending) && local.sendDisabled]}><Text style={local.sendText}>{ask.isPending ? 'Thinking…' : 'Ask'}</Text></Pressable>
      </View>
      {ask.isError ? <Text selectable style={local.error}>I couldn’t answer that. Check your connection and try again.</Text> : null}
    </ScrollView>
  )
}

const local = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  copy: { color: palette.textSecondary, fontSize: 15, lineHeight: 22, paddingTop: spacing.xs },
  exchange: { gap: spacing.sm },
  question: { alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: palette.surfaceElevated, color: palette.text, padding: spacing.md, borderRadius: 16, overflow: 'hidden' },
  answer: { color: palette.text, fontSize: 16, lineHeight: 24 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipText: { color: palette.textSecondary, fontSize: 13, fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, minHeight: 48, color: palette.text, backgroundColor: palette.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, borderRadius: 14, paddingHorizontal: spacing.md, fontSize: 16 },
  send: { minHeight: 48, justifyContent: 'center', backgroundColor: palette.accent, borderRadius: 14, paddingHorizontal: spacing.md },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: palette.bg, fontWeight: '700' },
  error: { color: palette.danger, fontSize: 13 },
})
