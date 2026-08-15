import { test, expect } from '@playwright/test'

test.describe('Wallet Tracker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to Wallet Tracker tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Wallet Tracker' }).click()
  })

  test('add wallet form is visible', async ({ page }) => {
    await expect(page.getByTestId('add-wallet-form')).toBeVisible()
    await expect(page.getByTestId('wallet-address-input')).toBeVisible()
    await expect(page.getByTestId('wallet-label-input')).toBeVisible()
    await expect(page.getByTestId('add-wallet-btn')).toBeVisible()
  })

  test('can add a wallet address', async ({ page }) => {
    const testAddress = '0x1234567890abcdef1234567890abcdef12345678'
    const testLabel = 'Test Whale'

    await page.getByTestId('wallet-address-input').fill(testAddress)
    await page.getByTestId('wallet-label-input').fill(testLabel)
    await page.getByTestId('add-wallet-btn').click()

    // Wallet should appear in the tracked wallets list
    await expect(page.getByTestId('tracked-wallet-item')).toBeVisible()
    await expect(page.getByText(testLabel)).toBeVisible()
  })

  test('activity feed is visible', async ({ page }) => {
    // Add a wallet first to trigger activity generation
    const testAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    await page.getByTestId('wallet-address-input').fill(testAddress)
    await page.getByTestId('add-wallet-btn').click()

    // Activity feed should be visible (either with entries or the empty state)
    const feed = page.getByTestId('activity-feed').or(page.getByTestId('activity-feed-empty'))
    await expect(feed.first()).toBeVisible()
  })

  test('can click on a tracked wallet to see profile', async ({ page }) => {
    // Add a wallet
    const testAddress = '0x1111111111111111111111111111111111111111'
    const testLabel = 'Profile Test'

    await page.getByTestId('wallet-address-input').fill(testAddress)
    await page.getByTestId('wallet-label-input').fill(testLabel)
    await page.getByTestId('add-wallet-btn').click()

    // Click on the wallet
    await page.getByTestId('tracked-wallet-item').click()

    // Profile card should appear
    await expect(page.getByTestId('wallet-profile')).toBeVisible()
    await expect(page.getByText('Back to wallets')).toBeVisible()

    // Click back
    await page.getByText('Back to wallets').click()
    await expect(page.getByTestId('wallet-tracker')).toBeVisible()
  })

  test('validates invalid address format', async ({ page }) => {
    await page.getByTestId('wallet-address-input').fill('invalid-address')
    await page.getByTestId('add-wallet-btn').click()

    await expect(page.getByText('Invalid address format')).toBeVisible()
  })
})
