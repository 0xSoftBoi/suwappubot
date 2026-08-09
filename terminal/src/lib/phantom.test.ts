import { describe, expect, test } from 'bun:test'
import { siwsInputFromChallenge } from './phantom'

describe('siwsInputFromChallenge', () => {
  const address = '9xQeWvG816bUx9EPfEZw6j5JksZQ3Jk8G1zZr1VYp8BZ'
  const challenge = `terminal.suwappu.bot wants you to sign in with your Solana account:
${address}

Sign in to Suwappu

URI: https://terminal.suwappu.bot
Version: 1
Nonce: abcdEFGH1234
Issued At: 2026-08-08T12:00:00Z
Expiration Time: 2026-08-08T12:10:00Z`

  test('maps the server challenge to Wallet-Standard SIWS fields', () => {
    expect(siwsInputFromChallenge(challenge, address)).toEqual({
      domain: 'terminal.suwappu.bot',
      address,
      statement: 'Sign in to Suwappu',
      uri: 'https://terminal.suwappu.bot',
      version: '1',
      nonce: 'abcdEFGH1234',
      issuedAt: '2026-08-08T12:00:00Z',
      expirationTime: '2026-08-08T12:10:00Z',
    })
  })

  test('rejects a challenge for a different address', () => {
    expect(() => siwsInputFromChallenge(challenge, 'DifferentAddress1111111111111111111111111')).toThrow()
  })
})
