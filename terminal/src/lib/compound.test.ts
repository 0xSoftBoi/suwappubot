import { describe, expect, test } from 'bun:test'
import { parseCompoundMarkets } from './compound'

// Trimmed from a real v3-api.compound.finance/market/all-networks/all-contracts/summary
// response (captured 2026-08-25).
describe('parseCompoundMarkets', () => {
  test('parses a happy-path market and converts utilization from 1e18 fixed-point', () => {
    const payload = [
      {
        chain_id: 1,
        comet: { address: '0xc3d688b66703497daa19211eedff47f25384cdc3' },
        borrow_apr: '0.071035967506608',
        supply_apr: '0.05995286474832',
        total_borrow_value: '324075190.5701599162086',
        total_supply_value: '356666899.13585423817336',
        total_collateral_value: '715463378.09298034363041103755360306',
        utilization: '908621046555114617',
        base_usd_price: '0.99986388',
        collateral_asset_symbols: ['COMP', 'WBTC', 'WETH'],
      },
    ]
    const markets = parseCompoundMarkets(payload)
    expect(markets).toHaveLength(1)
    const m = markets[0]
    expect(m.chainId).toBe(1)
    expect(m.chainName).toBe('Ethereum')
    expect(m.cometAddress).toBe('0xc3d688b66703497daa19211eedff47f25384cdc3')
    expect(m.borrowAprPct).toBeCloseTo(7.1035967506608, 6)
    expect(m.supplyAprPct).toBeCloseTo(5.995286474832, 6)
    expect(m.utilizationPct).toBeCloseTo(90.8621046555115, 4)
    expect(m.totalSupplyUsd).toBeCloseTo(356666899.13585424, 1)
    expect(m.collateralSymbols).toEqual(['COMP', 'WBTC', 'WETH'])
  })

  test('labels an unrecognized chain id numerically', () => {
    const payload = [
      { chain_id: 999999, comet: { address: '0xabc' }, collateral_asset_symbols: [] },
    ]
    expect(parseCompoundMarkets(payload)[0].chainName).toBe('Chain 999999')
  })

  test('drops entries missing chain_id or comet address', () => {
    const payload = [
      { comet: { address: '0xabc' } },
      { chain_id: 1, comet: {} },
      null,
      { chain_id: 1, comet: { address: '0xdef' } },
    ]
    expect(parseCompoundMarkets(payload).map((m) => m.cometAddress)).toEqual(['0xdef'])
  })

  test('returns empty array for non-array payload', () => {
    expect(parseCompoundMarkets({})).toEqual([])
    expect(parseCompoundMarkets(null)).toEqual([])
  })
})
