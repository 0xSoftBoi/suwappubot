import { test, expect } from '@playwright/test'

test.describe('Order Book & Recent Trades', () => {
  test('order book panel is visible', async ({ page }) => {
    await page.goto('/')
    const orderBook = page.getByTestId('order-book')
    await expect(orderBook).toBeVisible()
  })

  test('has bid and ask sides', async ({ page }) => {
    await page.goto('/')
    const bids = page.getByTestId('bids-side')
    const asks = page.getByTestId('asks-side')
    await expect(bids).toBeVisible()
    await expect(asks).toBeVisible()
  })

  test('shows spread', async ({ page }) => {
    await page.goto('/')
    const spread = page.getByTestId('spread-display')
    await expect(spread).toBeVisible()
    await expect(spread).toContainText('Spread')
  })

  test('recent trades panel shows trades', async ({ page }) => {
    await page.goto('/')
    const tradesPanel = page.getByTestId('recent-trades')
    await expect(tradesPanel).toBeVisible()

    // Should have at least one trade row
    const rows = page.getByTestId('trade-row')
    await expect(rows.first()).toBeVisible()
  })

  test('view mode toggle works', async ({ page }) => {
    await page.goto('/')

    // Default: both sides visible
    await expect(page.getByTestId('bids-side')).toBeVisible()
    await expect(page.getByTestId('asks-side')).toBeVisible()

    // Switch to bids only
    await page.getByTestId('view-bids').click()
    await expect(page.getByTestId('bids-side')).toBeVisible()
    await expect(page.getByTestId('asks-side')).not.toBeVisible()

    // Switch to asks only
    await page.getByTestId('view-asks').click()
    await expect(page.getByTestId('asks-side')).toBeVisible()
    await expect(page.getByTestId('bids-side')).not.toBeVisible()

    // Switch back to both
    await page.getByTestId('view-both').click()
    await expect(page.getByTestId('bids-side')).toBeVisible()
    await expect(page.getByTestId('asks-side')).toBeVisible()
  })

  test('precision selector is present', async ({ page }) => {
    await page.goto('/')
    const select = page.getByTestId('precision-select')
    await expect(select).toBeVisible()
  })
})
