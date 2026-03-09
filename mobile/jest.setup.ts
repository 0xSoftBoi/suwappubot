/**
 * Jest setup — mock Expo modules that aren't available in test environment.
 */

// Mock expo-secure-store
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {}
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value
    }),
    getItemAsync: jest.fn(async (key: string) => store[key] || null),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key]
    }),
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
