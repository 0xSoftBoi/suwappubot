import { describe, it, expect } from 'bun:test'
import {
  EXTERNAL_PROVIDERS,
  isExternalProvider,
  isLedgerConnectorId,
  resolveWalletProviderTag,
} from './walletProvider'
import { LEDGER_CONNECTOR_ID, ledgerConnectKitWallet } from './ledgerConnectKit'

describe('isLedgerConnectorId', () => {
  it('matches the Connect Kit connector id', () => {
    expect(isLedgerConnectorId(LEDGER_CONNECTOR_ID)).toBe(true)
    expect(isLedgerConnectorId('ledgerConnectKit')).toBe(true)
  })

  it('matches loosely (case-insensitive, substring)', () => {
    expect(isLedgerConnectorId('ledger')).toBe(true)
    expect(isLedgerConnectorId('Ledger')).toBe(true)
    expect(isLedgerConnectorId('LEDGER-live')).toBe(true)
  })

  it('does not match software wallets or empty input', () => {
    expect(isLedgerConnectorId('metaMask')).toBe(false)
    expect(isLedgerConnectorId('walletConnect')).toBe(false)
    expect(isLedgerConnectorId('coinbaseWallet')).toBe(false)
    expect(isLedgerConnectorId(undefined)).toBe(false)
    expect(isLedgerConnectorId(null)).toBe(false)
    expect(isLedgerConnectorId('')).toBe(false)
  })
})

describe('resolveWalletProviderTag', () => {
  it('tags a Ledger connector as "ledger"', () => {
    expect(resolveWalletProviderTag(LEDGER_CONNECTOR_ID)).toBe('ledger')
    expect(resolveWalletProviderTag('ledger')).toBe('ledger')
  })

  it('tags everything else (incl. unknown/empty) as "external"', () => {
    expect(resolveWalletProviderTag('metaMask')).toBe('external')
    expect(resolveWalletProviderTag('walletConnect')).toBe('external')
    expect(resolveWalletProviderTag(undefined)).toBe('external')
    expect(resolveWalletProviderTag(null)).toBe('external')
  })
})

describe('isExternalProvider', () => {
  it('treats both external and ledger as client-signing (non-custodial)', () => {
    expect(isExternalProvider('external')).toBe(true)
    expect(isExternalProvider('ledger')).toBe(true)
  })

  it('treats custodial / unknown / empty providers as not external', () => {
    expect(isExternalProvider('turnkey')).toBe(false)
    expect(isExternalProvider('local')).toBe(false)
    expect(isExternalProvider(null)).toBe(false)
    expect(isExternalProvider(undefined)).toBe(false)
    expect(isExternalProvider('')).toBe(false)
  })

  it('keeps EXTERNAL_PROVIDERS in sync with the tag union', () => {
    expect([...EXTERNAL_PROVIDERS].sort()).toEqual(['external', 'ledger'])
  })
})

describe('ledgerConnectKitWallet (RainbowKit wallet metadata)', () => {
  it('exposes Ledger branding without invoking Connect Kit', () => {
    const wallet = ledgerConnectKitWallet({ projectId: 'test-project' })
    expect(wallet.id).toBe('ledger-connect-kit')
    expect(wallet.name).toBe('Ledger')
    expect(typeof wallet.createConnector).toBe('function')
  })
})
