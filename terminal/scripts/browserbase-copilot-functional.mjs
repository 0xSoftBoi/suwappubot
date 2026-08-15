import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const apiKey = process.env.BROWSERBASE_API_KEY
const projectId = process.env.BROWSERBASE_PROJECT_ID
const terminalUrl = process.env.QA_TERMINAL_URL || 'https://terminal.suwappu.bot'
const apiUrl = process.env.QA_API_URL || 'https://api.suwappu.bot'
const outDir = path.resolve(
  process.env.QA_OUTPUT_DIR || 'qa-screenshots/browserbase-copilot-prod',
)

if (!apiKey) throw new Error('BROWSERBASE_API_KEY is required')
if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID is required')

mkdirSync(outDir, { recursive: true })

async function createBrowserbaseSession() {
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': apiKey,
    },
    body: JSON.stringify({
      projectId,
      browserSettings: {
        viewport: { width: 1440, height: 900 },
      },
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Browserbase session create failed: ${response.status} ${JSON.stringify(body)}`)
  }

  const connectUrl = body.connectUrl || body.connect_url
  if (!connectUrl) {
    throw new Error(`Browserbase response did not include connectUrl: ${JSON.stringify(body)}`)
  }
  return { ...body, connectUrl }
}

async function sendCopilot(page, text, expected) {
  await page.getByTestId('copilot-input').fill(text)
  await page.getByTestId('copilot-send').click()
  await page.getByText(expected, { exact: false }).waitFor({ timeout: 45000 })
  return page.evaluate(() => document.body.innerText)
}

const session = await createBrowserbaseSession()
const browser = await chromium.connectOverCDP(session.connectUrl)
const context = browser.contexts()[0] || await browser.newContext()
const page = context.pages()[0] || await context.newPage()
const failures = []
const responses = []

page.on('response', (response) => {
  const url = response.url()
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    failures.push(`local request leaked: ${url}`)
  }
  if (url.startsWith(apiUrl)) {
    responses.push({ url, status: response.status() })
  }
})

try {
  await page.goto(terminalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.getByText('AI Co-Pilot', { exact: true }).click({ timeout: 30000 }).catch(() => {})
  await page.getByTestId('copilot-panel').waitFor({ timeout: 30000 })

  const initialPage = await page.evaluate(() => ({
    title: document.title,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    bodyText: document.body.innerText,
  }))

  if (initialPage.scrollWidth > initialPage.innerWidth) {
    failures.push('terminal has horizontal overflow')
  }

  await sendCopilot(page, 'Price of SOL', 'SOL is $')
  const afterPrice = await page.evaluate(() => document.body.innerText)
  if (/Solana \(SOL\) on ethereum/i.test(afterPrice)) {
    failures.push('price response used old token metadata copy')
  }
  if (/Something went wrong/i.test(afterPrice)) {
    failures.push('price response showed generic failure')
  }
  if (!/DexScreener|orca|raydium|meteora/i.test(afterPrice)) {
    failures.push('price response did not show a live market source')
  }

  await sendCopilot(page, 'Show my portfolio', 'Connect Turnkey first')
  const afterPortfolio = await page.evaluate(() => document.body.innerText)

  await sendCopilot(page, 'Swap ETH to USDC', 'Live quote:')
  const afterSwap = await page.evaluate(() => document.body.innerText)

  await page.screenshot({
    path: path.join(outDir, 'copilot-after-price-portfolio-swap.png'),
    fullPage: false,
  })

  if (!/Connect Turnkey first to load your real portfolio/i.test(afterPortfolio)) {
    failures.push('portfolio response did not require Turnkey auth clearly')
  }
  if (!/Live quote: .*ETH.*USDC/i.test(afterSwap)) {
    failures.push('swap response did not render a live ETH to USDC quote')
  }

  const report = {
    terminalUrl,
    apiUrl,
    outDir,
    browserbase: {
      sessionId: session.id,
      dashboardUrl: `https://www.browserbase.com/sessions/${session.id}`,
    },
    initialPage: {
      title: initialPage.title,
      scrollWidth: initialPage.scrollWidth,
      innerWidth: initialPage.innerWidth,
    },
    checks: {
      priceRendered: /SOL is \$/i.test(afterPrice),
      portfolioTurnkeyMessage: /Connect Turnkey first to load your real portfolio/i.test(afterPortfolio),
      swapQuoteRendered: /Live quote: .*ETH.*USDC/i.test(afterSwap),
    },
    responses,
    failures,
  }

  await writeFile(
    path.join(outDir, 'copilot-functional-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

if (failures.length > 0) {
  process.exit(1)
}
