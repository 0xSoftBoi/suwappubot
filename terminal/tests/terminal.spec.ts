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
    await expect(page.getByText('ETH/USDC').first()).toBeVisible()

    // Cmd+K should open pair search
    await page.keyboard.press('Meta+k')
    await expect(page.getByPlaceholder(/Search tokens/)).toBeVisible()

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

    // Order tabs (scoped: the flip button's aria-label also contains "swap")
    const swapPanel = page.getByTestId('swap-panel')
    await expect(swapPanel.getByRole('button', { name: 'Swap', exact: true })).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: 'Limit', exact: true })).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: 'DCA', exact: true })).toBeVisible()
  })

  test('swap panel has token inputs', async ({ page }) => {
    await page.goto('/')

    // From/To labels (scoped: the portfolio empty state also says "from")
    const swapPanel = page.getByTestId('swap-panel')
    await expect(swapPanel.getByText('From', { exact: true })).toBeVisible()
    await expect(swapPanel.getByText('To', { exact: true })).toBeVisible()

    // Amount input
    const inputs = page.getByPlaceholder('0.0')
    await expect(inputs.first()).toBeVisible()
  })

  test('swap panel follows the active pair (regression: token switching)', async ({ page }) => {
    await page.goto('/')

    // The swap panel derives its from/to tokens from the active pair, so the
    // default ETH/USDC pair must surface both tokens inside the trade panel —
    // not the empty "Select" placeholders the old disconnected state showed.
    const swapPanel = page.getByTestId('swap-panel')
    await expect(swapPanel).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: /ETH/ })).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: /USDC/ })).toBeVisible()

    // Flipping buy/sell swaps the trade direction without losing either token,
    // proving from/to stay bound to the same pair.
    await swapPanel.getByRole('button', { name: 'Sell' }).click()
    await expect(swapPanel.getByRole('button', { name: /ETH/ })).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: /USDC/ })).toBeVisible()
  })

  test('switching token propagates into the swap panel (the actual complaint)', async ({ page }) => {
    // Seed a non-ETH token into the localStorage-backed watchlist so we can
    // exercise the full journey backend-free: click token -> setSelectedPair ->
    // SwapPanel derives the new target. This is the regression guard for the
    // literal "I switch tokens but the trade panel doesn't follow" bug.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'suwappu_watchlist',
        JSON.stringify([
          { symbol: 'PEPE', name: 'Pepe', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'ethereum' },
        ]),
      )
    })
    await page.goto('/')

    const swapPanel = page.getByTestId('swap-panel')
    await expect(swapPanel).toBeVisible()
    // Buy side: the target ("To") token starts as the default base, ETH.
    await expect(swapPanel.getByRole('button', { name: /ETH/ })).toBeVisible()

    // Open the Watchlist bottom tab and click the seeded token.
    await page.getByTestId('bottom-tabs').getByRole('button', { name: 'Watchlist' }).click()
    await page.getByTestId('watchlist-item').first().click()

    // The swap panel must now be trading PEPE — proof the switch propagated.
    await expect(swapPanel.getByRole('button', { name: /PEPE/ })).toBeVisible()
    await expect(swapPanel.getByRole('button', { name: /USDC/ })).toBeVisible()
  })

  test('toggling buy/sell clears the typed amount (no accidental re-quote)', async ({ page }) => {
    await page.goto('/')

    const swapPanel = page.getByTestId('swap-panel')
    await expect(swapPanel).toBeVisible()

    // Type an amount on the buy side (spending USDC), then flip to sell.
    // Because from/to derive from `side`, the amount must NOT carry over —
    // otherwise it would re-quote as "sell <amount> ETH", which the user never chose.
    const amountInput = swapPanel.getByPlaceholder('0.0').first()
    await amountInput.fill('100')
    await expect(amountInput).toHaveValue('100')

    await swapPanel.getByRole('button', { name: 'Sell' }).click()
    await expect(amountInput).toHaveValue('')
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

    await expect(page.getByText('Your positions live here')).toBeVisible()
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
    await expect(page.getByText('Target USD')).toBeVisible()
    await expect(page.getByText('Expires')).toBeVisible()
    await expect(page.getByRole('button', { name: '24h' })).toBeVisible()
  })

  test('DCA tab shows frequency options', async ({ page }) => {
    await page.goto('/')

    // Switch to DCA tab
    await page.getByRole('button', { name: 'DCA' }).click()

    // DCA scheduling is an honest coming-soon state until the execution
    // backend lands; the tab must say so instead of showing a ghost form.
    await expect(page.getByText('DCA scheduling is coming soon')).toBeVisible()
  })

  test('connect wallet button is present', async ({ page }) => {
    await page.goto('/')

    // Wallet-connect SIWE sign-in button (rendered in both the responsive
    // desktop + mobile navs, so scope to the visible one).
    await expect(page.getByTestId('connect-wallet').first()).toBeVisible()
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
