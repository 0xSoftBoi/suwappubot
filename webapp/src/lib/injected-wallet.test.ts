import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  connectEvmWallet,
  connectPhantomWallet,
  encodeBase58,
  signEvmMessage,
  signPhantomMessage,
} from './injected-wallet'

describe('injected wallet auth', () => {
  beforeEach(() => {
    delete (window as any).ethereum
    delete window.phantom
    delete window.solana
  })

  it('connects and signs with an injected EVM provider', async () => {
    const request = mock(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111']
      if (method === 'personal_sign') return '0xsigned'
      throw new Error(`Unexpected method: ${method}`)
    })
    ;(window as any).ethereum = { request }

    const address = await connectEvmWallet()
    const signature = await signEvmMessage(address, 'Sign in to Suwappu')

    expect(address).toBe('0x1111111111111111111111111111111111111111')
    expect(signature).toBe('0xsigned')
    expect(request.mock.calls[1][0]).toEqual({
      method: 'personal_sign',
      params: ['0x5369676e20696e20746f2053757761707075', address],
    })
  })

  it('encodes Phantom signatures as base58', () => {
    expect(encodeBase58(new Uint8Array())).toBe('')
    expect(encodeBase58(new Uint8Array([0]))).toBe('1')
    expect(encodeBase58(new TextEncoder().encode('Hello World'))).toBe('JxF12TrwUP45BMd')
  })

  it('connects and signs with Phantom', async () => {
    const signMessage = mock(async () => ({ signature: new Uint8Array([0]) }))
    window.phantom = {
      solana: {
        isPhantom: true,
        publicKey: null,
        connect: async () => ({ publicKey: { toString: () => 'PhantomAddress' } }),
        signMessage,
      },
    }

    expect(await connectPhantomWallet()).toBe('PhantomAddress')
    expect(await signPhantomMessage('Suwappu challenge')).toBe('1')
    expect(new TextDecoder().decode(signMessage.mock.calls[0][0])).toBe('Suwappu challenge')
  })

  it('fails with actionable guidance when no wallet is injected', async () => {
    await expect(connectEvmWallet()).rejects.toThrow('Open Suwappu in MetaMask')
    await expect(connectPhantomWallet()).rejects.toThrow('Open Suwappu in the Phantom browser')
  })
})
