import { describe, expect, test } from 'bun:test'
import { metamaskDappUrl, phantomBrowseUrl } from './walletLinks'

describe('mobile wallet links', () => {
  test('builds Phantom universal links without losing the target URL', () => {
    const target = 'https://terminal.suwappu.bot/trade?pair=SOL%2FUSDC'
    expect(phantomBrowseUrl(target, 'https://terminal.suwappu.bot')).toBe(
      `https://phantom.app/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent('https://terminal.suwappu.bot')}`,
    )
  })

  test('uses MetaMask dapp links with the target scheme stripped', () => {
    expect(metamaskDappUrl('https://terminal.suwappu.bot/trade?pair=ETH')).toBe(
      'https://link.metamask.io/dapp/terminal.suwappu.bot/trade?pair=ETH',
    )
  })
})
