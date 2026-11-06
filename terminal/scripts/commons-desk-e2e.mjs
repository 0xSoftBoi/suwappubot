// Live UI verification for the Commons v2 Clearing House desk: drives REAL writes
// through the browser UI against Base Sepolia and checks chain state after each
// step (Inbox → clearing batch → settle demand → counter-propose → relay intent).
//
// TESTNET ONLY, LOCAL KEYS ONLY — never point this at the production Turnkey org.
//   1. Seed fixtures (operator = A):
//        E2E_SEED_DESK=1 CLEARING_HOUSE=0x489b93a02a5ad429b444c0e5370f6d39089677dd \
//        bun --env-file=~/.config/suwappu/commons-testnet.env --env-file=~/.config/suwappu/commons-operator.env \
//          run contracts/deploy/turnkey/e2e.ts
//   2. bun x vite --port 5395   (in terminal/)
//   3. SEED_B=0x… SEED_C=0x… SEED_D=0x… node --env-file=… --env-file=… scripts/commons-desk-e2e.mjs http://localhost:5395 /tmp
// The browser's injected wallet forwards eth_sendTransaction / eth_signTypedData_v4
// to a Node-side signer holding OPERATOR_PRIVATE_KEY; the relayer (RELAYER_PRIVATE_KEY)
// submits the UI-signed intent via execute().
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const [, , base, out] = process.argv
const RPC = 'https://sepolia.base.org'
const CH = '0x489b93a02a5ad429b444c0e5370f6d39089677dd'
const MUSD = '0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8'
const op = privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY)
const relayer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY)
const B = process.env.SEED_B
const C = process.env.SEED_C
const D = process.env.SEED_D
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const opWallet = createWalletClient({ account: op, chain: baseSepolia, transport: http(RPC) })
const relWallet = createWalletClient({ account: relayer, chain: baseSepolia, transport: http(RPC) })
const abi = parseAbi([
  'struct Intent { address signer; uint8 action; bytes params; uint256 nonce; uint256 deadline; }',
  'function owedBy(address,address,address) view returns (uint256)',
  'function claimable(address,address) view returns (uint256)',
  'function getLine(address,address,address) view returns ((uint128,uint128,int256,uint64,uint64,uint64,uint64,address,uint8,uint8,uint32,address,bytes32))',
  'function execute(Intent it, bytes signature) returns (bytes)',
])
const e18 = 10n ** 18n
const owed = (d, c) => pub.readContract({ address: CH, abi, functionName: 'owedBy', args: [d, c, MUSD] })
const line = (x, y) => pub.readContract({ address: CH, abi, functionName: 'getLine', args: [x, y, MUSD] })
const results = []
const check = (label, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  console.log(results.at(-1))
}

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' })
const p = await b.newPage({ viewport: { width: 1440, height: 1300 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.exposeFunction('__nodeSign', async (method, params) => {
  if (method === 'eth_sendTransaction') {
    const t = params[0]
    const hash = await opWallet.sendTransaction({
      to: t.to,
      data: t.data,
      value: t.value ? BigInt(t.value) : undefined,
      gas: t.gas ? BigInt(t.gas) : undefined,
    })
    return hash
  }
  if (method === 'eth_signTypedData_v4') {
    const td = JSON.parse(params[1])
    const { EIP712Domain, ...types } = td.types
    return op.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
  }
  throw new Error(`unsupported ${method}`)
})
await p.addInitScript(
  ({ acct, labels }) => {
    const rpc = async (method, params) => {
      const r = await fetch('https://sepolia.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) })
      const j = await r.json()
      if (j.error) throw j.error
      return j.result
    }
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct]
        if (method === 'eth_chainId') return '0x14a34'
        if (method === 'net_version') return '84532'
        if (method.startsWith('wallet_')) return null
        if (method === 'eth_sendTransaction' || method === 'eth_signTypedData_v4') return window.__nodeSign(method, params)
        return rpc(method, params)
      },
      on: () => {},
      removeListener: () => {},
    }
    localStorage.setItem('suwappu:commons:tab', JSON.stringify('clearing'))
    localStorage.setItem('suwappu:commons:v2:desk', JSON.stringify('inbox'))
    localStorage.setItem('suwappu:commons:v2:relay', JSON.stringify(false))
    localStorage.setItem('suwappu:commons:v2:book', JSON.stringify(labels))
  },
  {
    acct: op.address,
    labels: {
      [B.toLowerCase()]: { label: 'Acme Supplies' },
      [C.toLowerCase()]: { label: 'Borealis Logistics' },
      [D.toLowerCase()]: { label: 'Cobalt Foods' },
    },
  },
)

const waitConfirmed = async (label) => {
  await p.getByText(/confirmed/).first().waitFor({ timeout: 120_000 }).catch(() => errs.push(`no confirmation toast: ${label}`))
  await p.waitForTimeout(9000) // let wagmi refetch
}
const tab = async (re) => {
  await p.getByRole('button', { name: re }).first().click()
  await p.waitForTimeout(5000)
}

await p.goto(`${base}/commons`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2000)
await p.getByRole('button', { name: 'Clearing House v2', exact: true }).first().click()
await p.waitForTimeout(10000)

// 1. Inbox
const inbox = await p.locator('main').innerText()
check('Inbox shows Acme demand with countdown', /Acme Supplies demanded 30/.test(inbox) && /avoid default/.test(inbox))
check('Inbox shows Cobalt proposal', /Cobalt Foods offers 50/.test(inbox))
await p.screenshot({ path: `${out}/ui-1-inbox.png` })

// 2. Clearing desk batch
await tab(/^Clearing desk/)
await p.getByRole('button', { name: /Submit clearing batch/ }).click()
await waitConfirmed('clear')
check('clear(): you owe Acme 10', (await owed(op.address, B)) === 10n * e18)
check('clear(): Borealis owes you 0', (await owed(C, op.address)) === 0n)

// 3. Settle from Inbox
await tab(/^Inbox/)
await p.screenshot({ path: `${out}/ui-2-inbox-after-clear.png` })
await p.getByRole('button', { name: /^Settle 10/ }).first().click()
await waitConfirmed('settle')
const lb = await line(op.address, B)
check('settle: you owe Acme 0', (await owed(op.address, B)) === 0n)
check('settle: Acme escrow credited', (await pub.readContract({ address: CH, abi, functionName: 'claimable', args: [B, MUSD] })) >= 10n * e18)
check('settle: demand cleared', lb[6] === 0n)

// 4. Counter-propose to Cobalt
await tab(/^Positions/)
await p.getByRole('cell', { name: 'Cobalt Foods' }).first().click()
await p.waitForTimeout(3000)
await p.getByRole('button', { name: 'Counter-propose' }).click()
await p.waitForTimeout(500)
const counterBox = p.locator('div.border-terminal-accent\\/40')
await counterBox.getByLabel('Credit you extend').fill('25').catch(() => errs.push('no limit field'))
await counterBox.getByLabel('Fee APR').fill('3').catch(() => errs.push('no apr field'))
await counterBox.getByLabel('Grace').fill('7').catch(() => errs.push('no grace field'))
await p.getByRole('button', { name: 'Send counter-proposal' }).click()
await waitConfirmed('counter')
const ld = await line(op.address, D)
check('counter: line re-proposed by you', ld[8] === 1 && ld[11].toLowerCase() === op.address.toLowerCase(), `status=${ld[8]} proposer=${ld[11].slice(0, 8)} v${ld[10]}`)
check('counter: grace 7d', ld[4] === 604800n)
await p.screenshot({ path: `${out}/ui-3-counter.png`, fullPage: true })

// 5. Relay mode: sign a pay intent in the UI, relay it from Node
await p.getByRole('cell', { name: 'Acme Supplies' }).first().click()
await p.waitForTimeout(3000)
await p.getByText('Relay mode', { exact: true }).click()
await p.waitForTimeout(500)
await p.getByLabel('Amount').first().fill('1')
await p.getByLabel(/Reference/).first().fill('INV-RELAY-1')
await p.getByRole('button', { name: 'Pay on credit' }).click()
await p.getByText('Copy for relayer').waitFor({ timeout: 30_000 }).catch(() => errs.push('no signed intent card'))
const json = await p.locator('pre').first().innerText()
const payload = JSON.parse(json)
const it = payload.intent
const hash = await relWallet.writeContract({
  address: CH,
  abi,
  functionName: 'execute',
  args: [{ signer: it.signer, action: Number(it.action), params: it.params, nonce: BigInt(it.nonce), deadline: BigInt(it.deadline) }, payload.signature],
  gas: 400_000n,
})
const r = await pub.waitForTransactionReceipt({ hash })
check('relay: UI-signed intent executed by relayer', r.status === 'success', hash)
check('relay: you owe Acme 1', (await owed(op.address, B)) === 1n * e18)
await p.screenshot({ path: `${out}/ui-4-relay.png` })

await b.close()
console.log('\n' + results.join('\n'))
console.log(errs.length ? `ERRORS:\n${[...new Set(errs)].join('\n')}` : 'no page errors')
