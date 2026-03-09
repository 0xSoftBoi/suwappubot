import { test, expect } from '@playwright/test'

test.describe('Hotkeys System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the app to render
    await page.waitForSelector('[data-testid="bottom-tabs"]')
  })

  test('Press ? shows hotkeys overlay', async ({ page }) => {
    // Dispatch ? keydown directly (Shift+/ unreliable in headless Chromium)
    await page.keyboard.type('?')
    // Overlay should appear
    const overlay = page.locator('[data-testid="hotkeys-overlay"]')
    await expect(overlay).toBeVisible()
    // Should show "Keyboard Shortcuts" heading
    await expect(overlay.locator('text=Keyboard Shortcuts')).toBeVisible()
  })

  test('Press Escape closes hotkeys overlay', async ({ page }) => {
    // Open the overlay
    await page.keyboard.type('?')
    const overlay = page.locator('[data-testid="hotkeys-overlay"]')
    await expect(overlay).toBeVisible()

    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
  })

  test('Hotkeys help shows keyboard shortcuts grouped by category', async ({ page }) => {
    await page.keyboard.type('?')
    const overlay = page.locator('[data-testid="hotkeys-overlay"]')

    // Check category headings
    await expect(overlay.getByRole('heading', { name: 'Navigation' })).toBeVisible()
    await expect(overlay.getByRole('heading', { name: 'Trading' })).toBeVisible()
    await expect(overlay.getByRole('heading', { name: 'Chart' })).toBeVisible()

    // Check some specific shortcuts are listed
    await expect(overlay.locator('text=Portfolio Tab')).toBeVisible()
    await expect(overlay.locator('text=Discovery Tab')).toBeVisible()
    await expect(overlay.locator('text=Focus Buy / Swap Input')).toBeVisible()
  })

  test('Press P switches to Portfolio tab', async ({ page }) => {
    // Switch away first
    await page.keyboard.press('d')
    // Switch back to portfolio
    await page.keyboard.press('p')
    const tabs = page.locator('[data-testid="bottom-tabs"]')
    const portfolioTab = tabs.locator('button', { hasText: 'Portfolio' })
    await expect(portfolioTab).toHaveClass(/terminal-tab-active/)
  })

  test('Press D switches to Discovery tab', async ({ page }) => {
    await page.keyboard.press('d')
    const tabs = page.locator('[data-testid="bottom-tabs"]')
    const discoveryTab = tabs.locator('button', { hasText: 'Discovery' })
    await expect(discoveryTab).toHaveClass(/terminal-tab-active/)
  })
})

test.describe('Watchlist', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="bottom-tabs"]')
  })

  test('Watchlist tab is accessible in bottom tabs', async ({ page }) => {
    const tabs = page.locator('[data-testid="bottom-tabs"]')
    const watchlistTab = tabs.locator('button', { hasText: 'Watchlist' })
    await expect(watchlistTab).toBeVisible()
  })

  test('Can see watchlist panel when tab is clicked', async ({ page }) => {
    // Click the Watchlist tab
    const tabs = page.locator('[data-testid="bottom-tabs"]')
    await tabs.locator('button', { hasText: 'Watchlist' }).click()

    // Watchlist panel should be visible
    const panel = page.locator('[data-testid="watchlist-panel"]')
    await expect(panel).toBeVisible()

    // Should show empty state
    await expect(panel.locator('text=No tokens in watchlist')).toBeVisible()
  })

  test('Can add a token to watchlist', async ({ page }) => {
    // Navigate to watchlist
    const tabs = page.locator('[data-testid="bottom-tabs"]')
    await tabs.locator('button', { hasText: 'Watchlist' }).click()

    const panel = page.locator('[data-testid="watchlist-panel"]')

    // Click + button to show add form
    await panel.locator('button[title="Add token"]').click()

    // Type a token symbol
    const input = panel.locator('input[placeholder*="SYMBOL"]')
    await input.fill('ETH')
    await input.press('Enter')

    // Token should appear in list
    const item = panel.locator('[data-testid="watchlist-item"]')
    await expect(item).toBeVisible()
    await expect(item.locator('text=ETH').first()).toBeVisible()
  })
})
