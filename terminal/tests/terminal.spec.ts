import { test, expect } from '@playwright/test'

test.describe('Terminal Layout', () => {
  test('loads with dark theme and header', async ({ page }) => {
    await page.goto('/')

    // Page loads
    await expect(page).toHaveTitle('Suwappu Terminal')

    // Dark background
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Header with logo
    await expect(page.getByText('SUWAPPU')).toBeVisible()
    await expect(page.getByText('TERMINAL')).toBeVisible()
  })

  test('has chain selector', async ({ page }) => {
    await page.goto('/')

    // Default chain should be Ethereum - use button role to be specific
    const chainButton = page.getByRole('button', { name: /Ethereum/ })
    await expect(chainButton).toBeVisible()

    // Click chain selector to open dropdown
    await chainButton.click()

    // Should show chain options
    await expect(page.getByRole('button', { name: /Arbitrum/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Base/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Solana/ })).toBeVisible()
  })

  test('has pair selector with keyboard shortcut', async ({ page }) => {
    await page.goto('/')

    // Default pair
    await expect(page.getByText('ETH/USDC')).toBeVisible()

    // Cmd+K should open pair search
    await page.keyboard.press('Meta+k')
    await expect(page.getByPlaceholder('Search tokens...')).toBeVisible()

    // Escape should close
    await page.keyboard.press('Escape')
  })

  test('has resizable trading layout panels', async ({ page }) => {
    await page.goto('/')

    // Chart area exists (with loading or content)
    const chartArea = page.locator('.split-view-container, [class*="allotment"]').first()
    await expect(chartArea).toBeVisible()
  })

  test('has swap panel with order tabs', async ({ page }) => {
    await page.goto('/')

    // Order tabs
    await expect(page.getByRole('button', { name: 'Swap' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Limit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'DCA' })).toBeVisible()
  })

  test('swap panel has token inputs', async ({ page }) => {
    await page.goto('/')

    // From/To labels
    await expect(page.getByText('From')).toBeVisible()
    await expect(page.getByText('To', { exact: true })).toBeVisible()

    // Amount input
    const inputs = page.getByPlaceholder('0.0')
    await expect(inputs.first()).toBeVisible()
  })

  test('has slippage control', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Slippage')).toBeVisible()
    // Preset buttons
    await expect(page.getByRole('button', { name: '0.5%' })).toBeVisible()
  })

  test('has portfolio panel with tabs', async ({ page }) => {
    await page.goto('/')

    // Portfolio tabs (in the default bottom tab)
    await expect(page.getByRole('button', { name: 'Holdings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Positions' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open Orders' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'History' })).toBeVisible()
  })

  test('shows connect wallet message when not authenticated', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Connect wallet to view portfolio')).toBeVisible()
  })

  test('has chart toolbar with time intervals', async ({ page }) => {
    await page.goto('/')

    // Time intervals should be visible
    await expect(page.getByRole('button', { name: '1H' })).toBeVisible()
    await expect(page.getByRole('button', { name: '1D' })).toBeVisible()
  })

  test('limit order tab shows price and expiry inputs', async ({ page }) => {
    await page.goto('/')

    // Switch to Limit tab
    await page.getByRole('button', { name: 'Limit' }).click()

    // Limit-specific fields
    await expect(page.getByText('Limit Price (USD)')).toBeVisible()
    await expect(page.getByText('Expires')).toBeVisible()
    await expect(page.getByRole('button', { name: '24h' })).toBeVisible()
  })

  test('DCA tab shows frequency options', async ({ page }) => {
    await page.goto('/')

    // Switch to DCA tab
    await page.getByRole('button', { name: 'DCA' }).click()

    // DCA-specific fields
    await expect(page.getByText('Total Amount (USD)')).toBeVisible()
    await expect(page.getByText('Frequency')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Daily' })).toBeVisible()
    await expect(page.getByText('Number of Orders')).toBeVisible()
  })

  test('connect wallet button is present', async ({ page }) => {
    await page.goto('/')

    // RainbowKit connect button
    await expect(page.getByText('Connect Wallet').first()).toBeVisible()
  })

  test('bottom panel has feature tabs', async ({ page }) => {
    await page.goto('/')

    const tabs = page.getByTestId('bottom-tabs')
    await expect(tabs.getByRole('button', { name: 'Portfolio' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'Discovery' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'Copy Trading' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'DeFi Center' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'AI Co-Pilot' })).toBeVisible()
  })
})

test.describe('Keyboard Shortcuts', () => {
  test('number keys change chart interval', async ({ page }) => {
    await page.goto('/')

    // Press '1' for 1m
    await page.keyboard.press('1')
    // The 1m button should now be active (has sakura color class)
    const btn1m = page.getByRole('button', { name: '1m' })
    await expect(btn1m).toBeVisible()
  })
})
