import type { Config } from 'jest'

const config: Config = {
  preset: 'jest-expo',
  setupFilesAfterSetup: ['./jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/flash-list)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'hooks/**/*.ts',
    '!**/*.d.ts',
  ],
}

export default config
