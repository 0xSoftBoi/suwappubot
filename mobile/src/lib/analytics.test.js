import { describe, expect, test } from 'bun:test'
// Import from analytics-privacy.ts directly, not analytics.ts — the client
// file transitively pulls in React Native (via api.ts/auth.ts), which plain
// `bun test` can't evaluate. The privacy helpers have no such dependency.
import { bucketUsd, redactProps } from './analytics-privacy'

describe('bucketUsd', () => {
  test('buckets amounts into privacy-safe ranges', () => {
    expect(bucketUsd(0)).toBe('0')
    expect(bucketUsd(-5)).toBe('0')
    expect(bucketUsd(Number.NaN)).toBe('0')
    expect(bucketUsd(5)).toBe('0-10')
    expect(bucketUsd(9.99)).toBe('0-10')
    expect(bucketUsd(10)).toBe('10-100')
    expect(bucketUsd(99)).toBe('10-100')
    expect(bucketUsd(100)).toBe('100-1k')
    expect(bucketUsd(999)).toBe('100-1k')
    expect(bucketUsd(1_000)).toBe('1k-10k')
    expect(bucketUsd(9_999)).toBe('1k-10k')
    expect(bucketUsd(10_000)).toBe('10k+')
    expect(bucketUsd(1_000_000)).toBe('10k+')
  })
})

describe('redactProps', () => {
  test('drops forbidden keys outright, regardless of value', () => {
    const out = redactProps({
      address: 'harmless string',
      wallet: 'harmless string',
      txHash: 'harmless string',
      recipient: 'harmless string',
      ens: 'harmless string',
      amount: 42,
      text: 'what the user typed',
      screen_name: 'Earn',
    })
    expect(out).toEqual({ screen_name: 'Earn' })
  })

  test('drops hex wallet addresses and tx hashes wherever they appear', () => {
    const out = redactProps({
      note: '0x1234567890abcdef1234567890abcdef12345678',
      status: 'ok',
      detail: '0x' + 'a'.repeat(64),
    })
    expect(out).toEqual({ status: 'ok' })
  })

  test('drops ENS names and emails', () => {
    const out = redactProps({
      resolved: 'vitalik.eth',
      contact: 'user@example.com',
      method: 'ens',
    })
    expect(out).toEqual({ method: 'ens' })
  })

  test('drops long free-text values even under a safe key name', () => {
    const out = redactProps({
      description: 'a'.repeat(65),
      short: 'a'.repeat(64),
    })
    expect(out).toEqual({ short: 'a'.repeat(64) })
  })

  test('keeps safe primitives: bucketed amounts, enums, counts, booleans', () => {
    const out = redactProps({
      amount_bucket: '10-100',
      http_status: 200,
      status: 'ok',
      recipient_type: 'hex',
      signed_in: true,
    })
    expect(out).toEqual({
      amount_bucket: '10-100',
      http_status: 200,
      status: 'ok',
      recipient_type: 'hex',
      signed_in: true,
    })
  })

  test('drops nested objects/arrays and undefined values', () => {
    const out = redactProps({
      nested: { foo: 'bar' },
      list: [1, 2, 3],
      missing: undefined,
      kept: 1,
    })
    expect(out).toEqual({ kept: 1 })
  })

  test('handles no props', () => {
    expect(redactProps(undefined)).toEqual({})
  })
})
