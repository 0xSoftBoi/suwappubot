import { afterEach, describe, expect, test } from 'bun:test'
import { EVM_ADDRESS, getEvmWalletActivity, getEvmWalletPortfolio } from './blockscout'

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })

const ME = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('blockscout inspector', () => {
  test('recognises EVM addresses', () => {
    expect(EVM_ADDRESS.test(ME)).toBe(true)
    expect(EVM_ADDRESS.test('So11111111111111111111111111111111111111112')).toBe(false)
  })

  test('maps native + priced ERC-20 balances into the shared portfolio shape', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith(`/addresses/${ME}`)) return Response.json({ coin_balance: '2000000000000000000', exchange_rate: '2400' })
      if (url.endsWith('/token-balances'))
        return Response.json([
          { token: { address: '0xusdc', symbol: 'USDC', name: 'USD Coin', decimals: '6', exchange_rate: '1', type: 'ERC-20' }, value: '5000000' },
          { token: { address: '0xspam', symbol: 'SPAM', name: 'Spam', decimals: '18', exchange_rate: null, type: 'ERC-20' }, value: '1000000000000000000000' },
          { token: { address: '0xnft', symbol: 'NFT', name: 'Nft', decimals: null, type: 'ERC-721' }, value: '1' },
        ])
      throw new Error('unexpected ' + url)
    }) as typeof fetch
    const p = await getEvmWalletPortfolio('ethereum', ME)
    expect(p).not.toBeNull()
    expect(p!.nativeSymbol).toBe('ETH')
    expect(p!.nativeSol).toBe(2)
    expect(p!.nativeUsd).toBe(4800)
    expect(p!.tokens.map((t) => t.symbol)).toEqual(['USDC', 'SPAM'])
    expect(p!.tokens[0].usd).toBe(5)
    expect(p!.totalUsd).toBe(4805)
  })

  test('maps token transfers into activity rows and fails soft', async () => {
    globalThis.fetch = (async () =>
      Response.json({
        items: [
          { transaction_hash: '0xabc', timestamp: '2026-09-02T09:23:59.000000Z', from: { hash: '0x9228040000000000000000000000000000000001' }, to: { hash: ME }, token: { symbol: 'SOS' }, total: { value: '1500000000000000000', decimals: '18' } },
        ],
      })) as typeof fetch
    const rows = await getEvmWalletActivity('base', ME)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ signature: '0xabc', type: 'RECEIVE', source: 'blockscout' })
    expect(rows[0].description).toContain('1.50 SOS from 0x9228')
    expect(await getEvmWalletActivity('bsc', ME)).toEqual([])
  })
})
