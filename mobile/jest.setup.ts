/**
 * Jest setup — mock Expo modules that aren't available in test environment.
 */

// Mock expo-secure-store with clearable store
const secureStoreData: Record<string, string> = {}

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStoreData[key] = value
  }),
  getItemAsync: jest.fn(async (key: string) => secureStoreData[key] || null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStoreData[key]
  }),
}))

// Clear mock store between tests
beforeEach(() => {
  for (const key of Object.keys(secureStoreData)) {
    delete secureStoreData[key]
  }
})

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
  getStringAsync: jest.fn(async () => ''),
}))
