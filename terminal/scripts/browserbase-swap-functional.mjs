import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const apiKey = process.env.BROWSERBASE_API_KEY
const projectId = process.env.BROWSERBASE_PROJECT_ID
const terminalUrl = process.env.QA_TERMINAL_URL || 'https://terminal.suwappu.bot'
const apiUrl = process.env.QA_API_URL || 'https://api.suwappu.bot'
const outDir = path.resolve(
  process.env.QA_OUTPUT_DIR || 'qa-screenshots/browserbase-functional-prod',
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

async function apiFetch(page, token, pathName, options = {}) {
  return page.evaluate(
    async ({ apiUrl, token, pathName, options }) => {
      const response = await fetch(`${apiUrl}${pathName}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      })
      const body = await response.json().catch(async () => ({ text: await response.text() }))
      return { status: response.status, ok: response.ok, body }
    },
    { apiUrl, token, pathName, options },
  )
}

function acceptableExecuteResult(result) {
  if (result.ok) return true
  if (![400, 402].includes(result.status)) return false
  const detail = String(result.body?.detail || result.body?.message || result.body?.text || '')
  if (/attributeerror|traceback|coroutine|internal server error/i.test(detail)) return false
  return /balance|fund|gas|insufficient|not enough|allowance|wallet/i.test(detail)
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
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  await page.goto(terminalUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

  const initialPage = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.innerText,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    hasWalletConnectText: /walletconnect|rainbowkit|connect wallet/i.test(document.body.innerText),
  }))

  if (initialPage.hasWalletConnectText) failures.push('WalletConnect/RainbowKit text is present')
  if (initialPage.scrollWidth > initialPage.innerWidth) failures.push('terminal has horizontal overflow')

  await page.locator('button[title="Create a Turnkey passkey wallet"]').click({ timeout: 30000 })
  const token = await page.waitForFunction(
    () => window.localStorage.getItem('suwappu_terminal_token'),
    null,
    { timeout: 60000 },
  ).then((handle) => handle.jsonValue())

  await page.screenshot({
    path: path.join(outDir, 'after-turnkey-auth.png'),
    fullPage: false,
  })

  const me = await apiFetch(page, token, '/auth/me')
  await page.locator('button[title="Sign out"]').click({ timeout: 30000 })
  await page.waitForFunction(
    () => !window.localStorage.getItem('suwappu_terminal_token'),
    null,
    { timeout: 30000 },
  )
  await page.locator('button[title="Create a Turnkey passkey wallet"]').click({ timeout: 30000 })
  const reconnectToken = await page.waitForFunction(
    () => window.localStorage.getItem('suwappu_terminal_token'),
    null,
    { timeout: 60000 },
  ).then((handle) => handle.jsonValue())
  const reconnectedMe = await apiFetch(page, reconnectToken, '/auth/me')

  const portfolio = await apiFetch(page, token, '/webapp/portfolio')
  const quote = await apiFetch(page, token, '/webapp/swap/quote', {
    method: 'POST',
    body: JSON.stringify({
      fromToken: 'ETH',
      toToken: 'USDC',
      fromChain: 'ethereum',
      toChain: 'ethereum',
      amount: '0.0001',
      fromDecimals: 18,
      slippage: 0.5,
    }),
  })
  const execute = quote.ok
    ? await apiFetch(page, token, '/webapp/swap/execute', {
      method: 'POST',
      body: JSON.stringify({ quoteId: quote.body.id }),
    })
    : null

  await page.screenshot({
    path: path.join(outDir, 'after-swap-functional.png'),
    fullPage: false,
  })

  if (!me.ok || !me.body?.authenticated) failures.push(`/auth/me failed: ${me.status}`)
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(me.body?.address || ''))) {
    failures.push('/auth/me did not return an EVM wallet address')
  }
  if (!reconnectedMe.ok || !reconnectedMe.body?.authenticated) {
    failures.push(`/auth/me after reconnect failed: ${reconnectedMe.status}`)
  }
  if (reconnectedMe.body?.address !== me.body?.address) {
    failures.push('passkey reconnect did not return the original Turnkey wallet address')
  }
  if (!portfolio.ok || !Array.isArray(portfolio.body?.tokens)) {
    failures.push(`/webapp/portfolio failed: ${portfolio.status}`)
  }
  if (!quote.ok || !quote.body?.id || Number(quote.body?.toAmount) <= 0) {
    failures.push(`/webapp/swap/quote failed: ${quote.status}`)
  }
  if (!execute || !acceptableExecuteResult(execute)) {
    failures.push(`/webapp/swap/execute failed: ${execute?.status || 'not attempted'}`)
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
      hasWalletConnectText: initialPage.hasWalletConnectText,
    },
    auth: {
      status: me.status,
      authenticated: me.body?.authenticated === true,
      userId: me.body?.userId,
      address: me.body?.address,
    },
    reconnect: {
      status: reconnectedMe.status,
      authenticated: reconnectedMe.body?.authenticated === true,
      userId: reconnectedMe.body?.userId,
      address: reconnectedMe.body?.address,
      sameAddress: reconnectedMe.body?.address === me.body?.address,
    },
    portfolio: {
      status: portfolio.status,
      totalUsdValue: portfolio.body?.totalUsdValue,
      tokenCount: Array.isArray(portfolio.body?.tokens) ? portfolio.body.tokens.length : null,
    },
    quote: {
      status: quote.status,
      id: quote.body?.id,
      route: quote.body?.route,
      fromAmount: quote.body?.fromAmount,
      toAmount: quote.body?.toAmount,
      gasUsd: quote.body?.gasUsd,
    },
    execute: execute && {
      status: execute.status,
      ok: execute.ok,
      body: execute.body,
    },
    responses,
    failures,
  }

  await writeFile(
    path.join(outDir, 'swap-functional-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}

if (failures.length > 0) {
  process.exit(1)
}
