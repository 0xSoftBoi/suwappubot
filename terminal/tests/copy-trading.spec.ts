import { test, expect } from '@playwright/test'

test.describe('Copy Trading Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/webapp/copy-trading/top-traders**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '11',
            address: '0x1111111111111111111111111111111111111111',
            name: 'Real Trader',
            pnl7d: 742.5,
            pnl30d: -2810,
            winRate: 64.2,
            followers: 182,
            copiers: 43,
            totalTrades: 87,
            trackRecordDays: 143,
            jellyLinked: true,
            jellyUsername: 'realtrader',
            jellyWatchUrl: 'https://jellyjelly.com/watch/proof_123',
          },
        ]),
      }),
    )
    await page.route('**/webapp/copy-trading/feed**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '501',
            traderId: '11',
            traderName: 'Real Trader',
            traderAddress: '0x1111111111111111111111111111111111111111',
            winRate: 64.2,
            action: 'buy',
            token: 'SOL',
            tokenPair: 'USDC/SOL',
            chain: 'solana',
            amountUsd: 250,
            pnlUsd: 75,
            timestamp: new Date().toISOString(),
            jellyLinked: true,
            jellyUsername: 'realtrader',
            jellyWatchUrl: 'https://jellyjelly.com/watch/proof_123',
          },
        ]),
      }),
    )
    await page.route('**/webapp/tokens/search**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            symbol: 'SOL',
            name: 'Solana',
            address: 'So11111111111111111111111111111111111111112',
            chain: 'solana',
            decimals: 9,
          },
        ]),
      }),
    )
    await page.goto('/')
    // Navigate to Copy Trading tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Copy Trading' }).click()
  })

  test('dashboard renders tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Top Traders' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Live Feed' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'My Copies' })).toBeVisible()
  })

  test('leaderboard has table columns', async ({ page }) => {
    // Navigate to copy trading and ensure Top Traders tab is active
    await page.getByRole('button', { name: 'Top Traders' }).click()

    // Verify table column headers using columnheader role for precision
    await expect(page.getByRole('columnheader', { name: 'Rank' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Trader' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /7d PnL/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /30d PnL/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Win Rate/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Followers/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible()
  })

  test('signed-out users can discover Jelly-linked traders', async ({ page }) => {
    await expect(page.getByText('Real Trader')).toBeVisible()
    await expect(page.getByText('@realtrader')).toBeVisible()
    await expect(page.getByText('143d track record')).toBeVisible()
    await expect(page.getByRole('link', { name: /Jelly-linked/i })).toHaveAttribute(
      'href',
      'https://jellyjelly.com/watch/proof_123',
    )
    await expect(page.getByText('-$2,810.00')).toBeVisible()
  })

  test('follow intent asks a signed-out user to connect before copy settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Follow / Copy' }).click()
    await expect(page.getByText('Sign in to follow traders')).toBeVisible()
    await expect(page.getByText(/browse performance without an account/i)).toBeVisible()
  })

  test('following tab renders', async ({ page }) => {
    await page.getByRole('button', { name: 'Following' }).click()
    await expect(page.getByText('Sign in to see traders you follow')).toBeVisible()
  })

  test('live feed is public and turns trader activity into a trade intent', async ({ page }) => {
    await page.getByRole('button', { name: 'Live Feed' }).click()
    await expect(page.getByText('Live public trades')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Real Trader' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Jelly-linked @realtrader/i })).toBeVisible()
    await page.getByRole('button', { name: 'Trade SOL' }).click()
    await expect(page.getByText(/SOL loaded in the trade ticket/i)).toBeVisible()
  })

  test('trade intent fails closed when a symbol resolves to multiple tokens', async ({ page }) => {
    await page.route('**/webapp/tokens/search**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            symbol: 'SOL',
            name: 'Solana',
            address: 'So11111111111111111111111111111111111111112',
            chain: 'solana',
            decimals: 9,
          },
          {
            symbol: 'SOL',
            name: 'Different SOL token',
            address: 'Second1111111111111111111111111111111111111',
            chain: 'solana',
            decimals: 9,
          },
        ]),
      }),
    )
    await page.getByRole('button', { name: 'Live Feed' }).click()
    await page.getByRole('button', { name: 'Trade SOL' }).click()
    await expect(page.getByText(/token-address handoff is required/i)).toBeVisible()
    await expect(page.getByText(/SOL loaded in the trade ticket/i)).not.toBeVisible()
  })

  test('copy feed renders', async ({ page }) => {
    await page.getByRole('button', { name: 'My Copies' }).click()
    await expect(page.getByText('Sign in to see copy activity')).toBeVisible()
  })

  test('tab switching works', async ({ page }) => {
    // Start on Top Traders
    await page.getByRole('button', { name: 'Top Traders' }).click()

    // Switch to Following
    await page.getByRole('button', { name: 'Following' }).click()
    await expect(page.getByText('Sign in to see traders you follow')).toBeVisible()

    // Switch to My Copies
    await page.getByRole('button', { name: 'My Copies' }).click()
    await expect(page.getByText('Sign in to see copy activity')).toBeVisible()

    // Switch back to Top Traders
    await page.getByRole('button', { name: 'Top Traders' }).click()
    const tradersContent = page.locator('text=Rank').or(page.locator('text=Loading top traders'))
    await expect(tradersContent.first()).toBeVisible()
  })
})
