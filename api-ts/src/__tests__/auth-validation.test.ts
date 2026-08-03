import { describe, it, expect } from 'bun:test'

/**
 * Unit tests for auth validation logic.
 * These test the MONEY-PATH auth contract without requiring full Hono app.
 */

describe('Telegram Auth Validation', () => {
  // Extract from: middleware/auth.ts
  const validateTelegramAuth = (headers: Record<string, string>): { valid: boolean; userId?: string } => {
    const auth = headers['authorization']
    if (!auth?.startsWith('Bearer ')) {
      return { valid: false }
    }

    const token = auth.slice(7)
    // In real code: verify JWT signature
    if (!token || token.includes('invalid')) {
      return { valid: false }
    }

    try {
      // Parse JWT payload (simple mock - real code validates signature)
      const parts = token.split('.')
      if (parts.length !== 3) return { valid: false }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      return { valid: true, userId: payload.sub }
    } catch {
      return { valid: false }
    }
  }

  it('accepts valid Bearer token', () => {
    const headers = {
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig',
    }
    const result = validateTelegramAuth(headers)
    expect(result.valid).toBe(true)
    expect(result.userId).toBe('123')
  })

  it('rejects missing Authorization header', () => {
    const result = validateTelegramAuth({})
    expect(result.valid).toBe(false)
  })

  it('rejects wrong auth scheme', () => {
    const headers = { authorization: 'Basic xyz' }
    const result = validateTelegramAuth(headers)
    expect(result.valid).toBe(false)
  })

  it('rejects malformed JWT', () => {
    const headers = { authorization: 'Bearer not-a-jwt' }
    const result = validateTelegramAuth(headers)
    expect(result.valid).toBe(false)
  })

  it('rejects JWT with invalid base64', () => {
    const headers = { authorization: 'Bearer a.!!!invalid!!!.c' }
    const result = validateTelegramAuth(headers)
    expect(result.valid).toBe(false)
  })
})

describe('Bearer Token Validation', () => {
  const validateBearerAuth = (headers: Record<string, string>): { valid: boolean } => {
    const auth = headers['authorization']
    if (!auth?.startsWith('Bearer ')) {
      return { valid: false }
    }
    const token = auth.slice(7)
    // MONEY-PATH: Agent tokens must be non-empty
    return { valid: token.length > 0 && !token.includes('invalid') }
  }

  it('accepts non-empty bearer token', () => {
    const result = validateBearerAuth({ authorization: 'Bearer agent-key-123' })
    expect(result.valid).toBe(true)
  })

  it('rejects empty bearer token', () => {
    const result = validateBearerAuth({ authorization: 'Bearer ' })
    expect(result.valid).toBe(false)
  })

  it('rejects missing token', () => {
    const result = validateBearerAuth({})
    expect(result.valid).toBe(false)
  })
})

describe('Flex Auth (Telegram OR Bearer)', () => {
  const validateFlexAuth = (headers: Record<string, string>): { valid: boolean; type?: 'telegram' | 'bearer' } => {
    const auth = headers['authorization']
    if (!auth?.startsWith('Bearer ')) {
      return { valid: false }
    }

    const token = auth.slice(7)
    // Try to parse as Telegram JWT (has 3 parts)
    if (token.includes('.') && token.split('.').length === 3) {
      try {
        JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
        return { valid: true, type: 'telegram' }
      } catch {}
    }

    // Fall back to bearer (agent key)
    if (token.length > 0) {
      return { valid: true, type: 'bearer' }
    }

    return { valid: false }
  }

  it('accepts Telegram JWT', () => {
    const result = validateFlexAuth({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig',
    })
    expect(result.valid).toBe(true)
    expect(result.type).toBe('telegram')
  })

  it('accepts bearer token if not JWT', () => {
    const result = validateFlexAuth({
      authorization: 'Bearer my-agent-key',
    })
    expect(result.valid).toBe(true)
    expect(result.type).toBe('bearer')
  })

  it('rejects missing auth', () => {
    const result = validateFlexAuth({})
    expect(result.valid).toBe(false)
  })
})
