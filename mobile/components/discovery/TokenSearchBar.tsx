/**
 * Search input with debounced query for token discovery.
 */
import { useState, useEffect, useRef } from 'react'
import { View, TextInput, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '../../lib/theme'

interface Props {
  onSearch: (query: string) => void
  placeholder?: string
}

export function TokenSearchBar({ onSearch, placeholder = 'Search token name, symbol, or address' }: Props) {
  const [text, setText] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch(text.trim())
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [text, onSearch])

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.xxl, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
})
