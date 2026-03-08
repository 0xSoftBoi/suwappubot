import { View, StyleSheet, ActivityIndicator } from 'react-native'
import { WebView } from 'react-native-webview'
import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Privacy Policy' }} />
      <View style={styles.container}>
        <WebView
          source={{ uri: 'https://suwappu.xyz/privacy' }}
          style={styles.webview}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.text} size="large" />
            </View>
          )}
        />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  webview: { flex: 1, backgroundColor: colors.bg },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
})
