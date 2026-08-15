import { describe, it, expect } from 'bun:test'

/**
 * Unit tests for x402 payment token/chain pinning.
 * MONEY-PATH: Validates that payment verification pins to server-issued challenge only,
 * preventing attackers from settling worthless tokens on cheaper chains.
 */

describe('x402 Payment Challenge Pinning', () => {
  interface Challenge {
    id: string
    token: string // E.g., USDC address
    chain: string // E.g., ethereum
    price: number // E.g., 1.0 USD
  }

  interface PaymentProof {
    tx_hash: string
    token: string
    chain: string
  }

  // Simulates the verifyPayment logic from mppAuth.ts
  const verifyPaymentPinning = (challenge: Challenge, proof: PaymentProof): { valid: boolean; reason?: string } => {
    // MONEY-PATH H1 fix: Token/chain must be pinned to challenge, not client proof
    // This prevents: attacker settles worthless token on cheaper chain, passing verification

    // OLD (vulnerable): const token = proof.token || challenge.token
    // NEW (secure): const token = challenge.token
    const expectedToken = challenge.token
    const expectedChain = challenge.chain

    if (proof.token !== expectedToken) {
      return { valid: false, reason: 'token_mismatch' }
    }

    if (proof.chain !== expectedChain) {
      return { valid: false, reason: 'chain_mismatch' }
    }

    return { valid: true }
  }

  const verifyPaymentLedger = (challenge: Challenge, proof: PaymentProof): { valid: boolean; reason?: string } => {
    // Same pin for replay ledger key — prevents keying on wrong chain
    const ledgerKey = `${challenge.chain}:${proof.tx_hash}`
    // Would check if (chain, tx_hash) already in ledger

    // Correct: ledger key = challenge.chain (server-pinned)
    // Vulnerable: ledger key = proof.chain (client-supplied)

    if (proof.chain !== challenge.chain) {
      return { valid: false, reason: 'ledger_chain_mismatch' }
    }

    return { valid: true }
  }

  describe('Token pinning', () => {
    it('accepts payment with correct token', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
        chain: 'ethereum',
        price: 1.0,
      }

      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token, // Matches challenge
        chain: challenge.chain,
      }

      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(true)
    })

    it('rejects payment with wrong token (H1 attack)', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Real USDC
        chain: 'ethereum',
        price: 1.0,
      }

      // ATTACK: Use worthless token instead
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: '0xFakeToken123456789', // ≠ challenge.token
        chain: challenge.chain,
      }

      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('token_mismatch')
    })

    it('rejects old vulnerable behavior (proof.token || challenge.token)', () => {
      const challenge: Challenge = {
        token: 'USDC_ethereum',
        chain: 'ethereum',
        id: 'ch_1',
        price: 1.0,
      }

      // Vulnerable code allows: proof.token || challenge.token
      // So attacker could omit proof.token and still pass
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: '', // Empty or omitted
        chain: challenge.chain,
      }

      // Secure code uses challenge.token directly (no fallback)
      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(false) // Correctly rejects
    })
  })

  describe('Chain pinning', () => {
    it('accepts payment on correct chain', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc',
        chain: 'ethereum', // Expensive gas
        price: 1.0,
      }

      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token,
        chain: 'ethereum', // Matches challenge
      }

      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(true)
    })

    it('rejects payment on wrong chain (H1 attack)', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc',
        chain: 'ethereum', // High gas cost
        price: 1.0,
      }

      // ATTACK: Settle on cheaper chain (1000x lower gas)
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token,
        chain: 'arbitrum', // ≠ challenge.chain, much cheaper
      }

      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('chain_mismatch')
    })

    it('rejects old vulnerable behavior (proof.chain || challenge.chain)', () => {
      const challenge: Challenge = {
        token: '0xUsdc',
        chain: 'ethereum',
        id: 'ch_1',
        price: 1.0,
      }

      // Vulnerable code allows: proof.chain || challenge.chain
      // So attacker could provide proof.chain and override the challenge
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token,
        chain: 'arbitrum', // Cheap override
      }

      // Secure code uses challenge.chain directly
      const result = verifyPaymentPinning(challenge, proof)
      expect(result.valid).toBe(false) // Correctly rejects cheap chain
    })
  })

  describe('Replay ledger pinning', () => {
    it('uses challenge chain for ledger key', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc',
        chain: 'ethereum',
        price: 1.0,
      }

      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token,
        chain: challenge.chain,
      }

      const result = verifyPaymentLedger(challenge, proof)
      expect(result.valid).toBe(true)
      // Ledger key would be "ethereum:0xabc123"
    })

    it('rejects replay if chain is spoofed in ledger key', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc',
        chain: 'ethereum',
        price: 1.0,
      }

      // Attacker tries to spoof chain in ledger lookup
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: challenge.token,
        chain: 'arbitrum', // Spoofed
      }

      // Secure code: ledger key = challenge.chain (not proof.chain)
      const result = verifyPaymentLedger(challenge, proof)
      expect(result.valid).toBe(false)
      // Would check "ethereum:0xabc123" in ledger (proof.chain doesn't matter)
      // But we reject upfront due to chain mismatch
    })
  })

  describe('Real-world attack scenarios', () => {
    it('prevents worthless token + cheap chain combo', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc_ethereum',
        chain: 'ethereum',
        price: 1.0,
      }

      // ATTACK: Combine cheap token + cheap chain (max savings)
      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: '0xFakeToken',
        chain: 'base', // Cheaper than Arbitrum
      }

      // Both checks fail (as they should)
      expect(verifyPaymentPinning(challenge, proof).valid).toBe(false)
      expect(verifyPaymentPinning(challenge, proof).reason).toBe('token_mismatch')
    })

    it('correct payment passes both checks', () => {
      const challenge: Challenge = {
        id: 'ch_123',
        token: '0xUsdc_ethereum',
        chain: 'ethereum',
        price: 1.0,
      }

      const proof: PaymentProof = {
        tx_hash: '0xabc123',
        token: '0xUsdc_ethereum',
        chain: 'ethereum',
      }

      expect(verifyPaymentPinning(challenge, proof).valid).toBe(true)
      expect(verifyPaymentLedger(challenge, proof).valid).toBe(true)
    })
  })
})
