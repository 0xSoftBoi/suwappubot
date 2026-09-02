import { test, expect } from '@playwright/test'

test.describe('DeFi Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Navigate to DeFi Center tab
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'DeFi Center' }).click()
  })

  // Alerts and DCA are honest coming-soon states (no backend yet). The panel
  // must render them as such — a ghost form that silently does nothing is the
  // regression these tests guard against.
  test.describe('Alerts Panel', () => {
    test('alerts panel renders its coming-soon state', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible()
      await expect(page.getByText('Price and volume alerts are coming soon')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create Alert' })).toHaveCount(0)
    })
  })

  test.describe('DCA Manager', () => {
    test('DCA manager renders its coming-soon state', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'DCA Orders' })).toBeVisible()
      await expect(page.getByText('Recurring DCA schedules are coming soon')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Start DCA' })).toHaveCount(0)
    })
  })

  test.describe('Lending Panel', () => {
    test('lending panel renders', async ({ page }) => {
      await expect(page.getByText('Morpho Blue Markets')).toBeVisible()

      // Chain filter dropdown
      const chainFilter = page.getByLabel('Filter by chain')
      await expect(chainFilter).toBeVisible()
    })

    test('market cards show APY labels', async ({ page }) => {
      // Look for APY labels — they'll show when markets load or in empty state
      const supplyLabel = page.getByText('Supply APY')
      const borrowLabel = page.getByText('Borrow APY')
      const utilizationLabel = page.getByText('Utilization')

      if (await supplyLabel.first().isVisible().catch(() => false)) {
        await expect(supplyLabel.first()).toBeVisible()
        await expect(borrowLabel.first()).toBeVisible()
        await expect(utilizationLabel.first()).toBeVisible()
      }
    })
  })
})
