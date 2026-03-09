import { test, expect } from '@playwright/test'

test.describe('Copy Trading Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to Copy Trading tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Copy Trading' }).click()
  })

  test('dashboard renders tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Top Traders' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy Feed' })).toBeVisible()
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

  test('following tab renders', async ({ page }) => {
    await page.getByRole('button', { name: 'Following' }).click()

    // Should show either the following list or the empty state
    const content = page.locator('text=Not following anyone yet').or(page.locator('text=Loading followed traders'))
    await expect(content.first()).toBeVisible()
  })

  test('copy feed renders', async ({ page }) => {
    await page.getByRole('button', { name: 'Copy Feed' }).click()

    // Should show feed items (mock data) or empty state
    const feedContent = page.locator('text=ETH/USDC').or(page.locator('text=No copy trades yet'))
    await expect(feedContent.first()).toBeVisible()
  })

  test('tab switching works', async ({ page }) => {
    // Start on Top Traders
    await page.getByRole('button', { name: 'Top Traders' }).click()

    // Switch to Following
    await page.getByRole('button', { name: 'Following' }).click()
    const followingContent = page.locator('text=Not following anyone yet').or(page.locator('text=Loading followed traders'))
    await expect(followingContent.first()).toBeVisible()

    // Switch to Copy Feed
    await page.getByRole('button', { name: 'Copy Feed' }).click()
    const feedContent = page.locator('text=ETH/USDC').or(page.locator('text=No copy trades yet'))
    await expect(feedContent.first()).toBeVisible()

    // Switch back to Top Traders
    await page.getByRole('button', { name: 'Top Traders' }).click()
    const tradersContent = page.locator('text=Rank').or(page.locator('text=Loading top traders'))
    await expect(tradersContent.first()).toBeVisible()
  })
})
