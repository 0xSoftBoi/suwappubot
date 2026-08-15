import { test, expect } from '@playwright/test'

test.describe('Discovery Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to Discovery tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Discovery' }).click()
  })

  test('panel renders with tabs', async ({ page }) => {
    // Discovery panel should be visible
    const panel = page.getByTestId('discovery-panel')
    await expect(panel).toBeVisible()

    // Should have Pulse, New Pairs and Trending tabs
    await expect(panel.getByRole('button', { name: 'Pulse' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'New Pairs' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Trending' })).toBeVisible()
  })

  test('pulse tab is the default and shows sub-tabs', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    // Pulse tab should be active by default
    const pulseTab = page.getByTestId('pulse-tab')
    await expect(pulseTab).toBeVisible()

    // Should have sub-tabs: New Creations, Final Stretch, Migrated
    await expect(page.getByTestId('pulse-subtab-new')).toBeVisible()
    await expect(page.getByTestId('pulse-subtab-final_stretch')).toBeVisible()
    await expect(page.getByTestId('pulse-subtab-migrated')).toBeVisible()
  })

  test('pulse tab has filter controls', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    // Pulse filters should be visible
    const filters = page.getByTestId('pulse-filters')
    await expect(filters).toBeVisible()
  })

  test('pulse tab shows token rows with insider metrics', async ({ page }) => {
    // Wait for mock data to populate
    await page.waitForTimeout(1000)

    // Should have token rows
    const rows = page.getByTestId('pulse-token-row')
    await expect(rows.first()).toBeVisible()

    // Should have insider metrics
    const metrics = page.getByTestId('insider-metrics')
    await expect(metrics.first()).toBeVisible()
  })

  test('pulse sub-tab switching works', async ({ page }) => {
    const finalStretchTab = page.getByTestId('pulse-subtab-final_stretch')
    await finalStretchTab.click()
    await page.waitForTimeout(500)

    // Should still see rows
    const rows = page.getByTestId('pulse-token-row')
    await expect(rows.first()).toBeVisible()

    const migratedTab = page.getByTestId('pulse-subtab-migrated')
    await migratedTab.click()
    await page.waitForTimeout(500)

    await expect(rows.first()).toBeVisible()
  })

  test('new pairs tab has table headers', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    // Click New Pairs tab to activate it (Pulse is the default now)
    await panel.getByRole('button', { name: 'New Pairs' }).click()

    // Wait for loading to finish or table to appear
    await page.waitForTimeout(1000)

    // Check for table headers (always visible regardless of data)
    const headers = ['Age', 'Token', 'Price', 'Liquidity', 'Volume', 'Change', 'Security']
    for (const header of headers) {
      await expect(panel.getByText(header, { exact: true }).first()).toBeVisible()
    }
  })

  test('trending tab has headers', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    // Click Trending tab
    await panel.getByRole('button', { name: 'Trending' }).click()

    // Wait for loading to finish
    await page.waitForTimeout(1000)

    // Check for trending table headers
    const headers = ['Token', 'Price', '24h Change', 'Volume', 'Liquidity', 'Market Cap', 'Security']
    for (const header of headers) {
      await expect(panel.getByText(header, { exact: true }).first()).toBeVisible()
    }
  })

  test('tab switching works', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    const pulseTab = panel.getByRole('button', { name: 'Pulse' })
    const newPairsTab = panel.getByRole('button', { name: 'New Pairs' })
    const trendingTab = panel.getByRole('button', { name: 'Trending' })

    await expect(pulseTab).toBeVisible()
    await expect(newPairsTab).toBeVisible()
    await expect(trendingTab).toBeVisible()

    // Switch to New Pairs
    await newPairsTab.click()
    await page.waitForTimeout(500)

    // Switch to Trending
    await trendingTab.click()
    await page.waitForTimeout(500)

    // Switch back to Pulse
    await pulseTab.click()
    await page.waitForTimeout(500)

    // All tabs should still be visible
    await expect(pulseTab).toBeVisible()
    await expect(newPairsTab).toBeVisible()
    await expect(trendingTab).toBeVisible()
  })

  test('has chain selector dropdown when on New Pairs', async ({ page }) => {
    const panel = page.getByTestId('discovery-panel')

    // Switch to New Pairs first (chain selector is hidden on Pulse)
    await panel.getByRole('button', { name: 'New Pairs' }).click()

    // Chain selector should be present
    const chainSelect = panel.locator('select')
    await expect(chainSelect).toBeVisible()

    // Should default to Ethereum
    await expect(chainSelect).toHaveValue('ethereum')
  })
})
