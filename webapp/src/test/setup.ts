import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Telegram WebApp
vi.mock('../lib/telegram', () => ({
  getInitData: vi.fn(() => null),
  getTelegramUser: vi.fn(() => null),
  isTelegramWebApp: vi.fn(() => false),
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
vi.stubGlobal('localStorage', localStorageMock)

// Mock navigator.clipboard
vi.stubGlobal('navigator', {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
  share: vi.fn(),
})

// Mock window.matchMedia
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addListener: vi.fn(),
  removeListener: vi.fn(),
})))
