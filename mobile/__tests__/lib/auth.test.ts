/**
 * Tests for lib/auth.ts — JWT token persistence and sync cache.
 */
import * as SecureStore from 'expo-secure-store'
import { saveAuthToken, loadAuthToken, clearAuthToken, getAuthToken, getWalletAddress, isTokenExpiringSoon } from '../../lib/auth'

// Reset module state between tests
beforeEach(async () => {
  jest.clearAllMocks()
  await clearAuthToken()
})

describe('saveAuthToken', () => {
  it('saves token and updates sync cache', async () => {
    await saveAuthToken('jwt-123', '2099-01-01T00:00:00Z', 'passkey', '0xABC')

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('suwappu_auth_token', 'jwt-123')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('suwappu_auth_expiry', '2099-01-01T00:00:00Z')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('suwappu_auth_method', 'passkey')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('suwappu_wallet_address', '0xABC')
  })

  it('getAuthToken returns token synchronously after save', async () => {
    await saveAuthToken('jwt-sync', '2099-01-01T00:00:00Z', 'passkey')
    expect(getAuthToken()).toBe('jwt-sync')
  })
})

describe('loadAuthToken', () => {
  it('returns null when no token saved', async () => {
    const token = await loadAuthToken()
    expect(token).toBeNull()
  })
})

describe('clearAuthToken', () => {
  it('clears all stored values and sync cache', async () => {
    await saveAuthToken('jwt-clear', '2099-01-01T00:00:00Z', 'passkey', '0xDEF')
    await clearAuthToken()

    expect(getAuthToken()).toBeNull()
    expect(getWalletAddress()).toBeNull()
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('suwappu_auth_token')
  })
})

describe('getWalletAddress', () => {
  it('returns wallet address after save', async () => {
    await saveAuthToken('jwt-wa', '2099-01-01T00:00:00Z', 'passkey', '0x123')
    expect(getWalletAddress()).toBe('0x123')
  })

  it('returns null when no wallet saved', () => {
    expect(getWalletAddress()).toBeNull()
  })
})

describe('isTokenExpiringSoon', () => {
  it('returns true when token expires within 1 hour', async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min from now
    await saveAuthToken('jwt-exp', soon, 'passkey')
    expect(isTokenExpiringSoon()).toBe(true)
  })

  it('returns false when token has more than 1 hour', async () => {
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
    await saveAuthToken('jwt-ok', later, 'passkey')
    expect(isTokenExpiringSoon()).toBe(false)
  })
})
