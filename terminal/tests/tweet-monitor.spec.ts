import { test, expect } from '@playwright/test'

test.describe('Tweet Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to Tweets tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Tweets' }).click()
  })

  test('panel renders with header', async ({ page }) => {
    const panel = page.getByTestId('tweet-monitor-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Tweet Monitor')).toBeVisible()
  })

  test('tweet feed is visible', async ({ page }) => {
    const feed = page.getByTestId('tweet-feed')
    await expect(feed).toBeVisible()
  })

  test('can open add account modal', async ({ page }) => {
    await page.getByTestId('add-account-btn').click()
    const modal = page.getByTestId('add-account-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('account-input')).toBeVisible()
    await expect(page.getByText('Suggested accounts')).toBeVisible()
  })

  test('sentiment filter buttons work', async ({ page }) => {
    const filters = page.getByTestId('sentiment-filters')
    await expect(filters).toBeVisible()

    await expect(filters.getByTestId('filter-all')).toBeVisible()
    await expect(filters.getByTestId('filter-bullish')).toBeVisible()
    await expect(filters.getByTestId('filter-bearish')).toBeVisible()
    await expect(filters.getByTestId('filter-neutral')).toBeVisible()

    // Click bullish filter
    await filters.getByTestId('filter-bullish').click()
    // Verify it gets the active style (sakura color)
    await expect(filters.getByTestId('filter-bullish')).toHaveClass(/sakura/)
  })

  test('can add account and see tweets', async ({ page }) => {
    // Open modal and add an account
    await page.getByTestId('add-account-btn').click()
    const input = page.getByTestId('account-input')
    await input.fill('@TestTrader')
    await page.getByTestId('add-account-modal').getByRole('button', { name: 'Add' }).click()

    // Account should appear in tracked list
    await expect(page.getByTestId('tracked-account')).toBeVisible()

    // Close modal
    await page.keyboard.press('Escape')

    // Wait for tweets to appear (mock generates initial batch)
    await expect(page.getByTestId('tweet-card').first()).toBeVisible({ timeout: 5000 })
  })

  test('token mentions are visible in tweets', async ({ page }) => {
    // Add account to trigger tweet generation
    await page.getByTestId('add-account-btn').click()
    await page.getByTestId('account-input').fill('@CryptoKaleo')
    await page.getByTestId('add-account-modal').getByRole('button', { name: 'Add' }).click()
    await page.keyboard.press('Escape')

    // Wait for tweets, then check for token mentions
    await expect(page.getByTestId('tweet-card').first()).toBeVisible({ timeout: 5000 })
    // Token mentions render as buttons with $ prefix
    const mentions = page.locator('[data-testid^="token-mention-"]')
    await expect(mentions.first()).toBeVisible({ timeout: 5000 })
  })

  test('suggested accounts can be added from modal', async ({ page }) => {
    await page.getByTestId('add-account-btn').click()
    const suggested = page.getByTestId('suggested-account').first()
    await expect(suggested).toBeVisible()
    await suggested.click()
    // Should now appear in tracked accounts
    await expect(page.getByTestId('tracked-account')).toBeVisible()
  })
})
