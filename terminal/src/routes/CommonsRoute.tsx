import { useAccount, useReadContract } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { Abi } from 'viem'
import { parseUnits } from 'viem'
import {
  TerminalButton,
  TerminalEyebrow,
  TerminalPanel,
  TerminalSegmentedTabs,
  TerminalStatusPill,
} from '../components/foundation'
import { usePersistentState } from '../lib/persist'
import { addressUrl, COMMONS, COMMONS_CHAIN, erc20Abi, fmt, short } from '../components/commons/contracts'
import { call, useCommonsTx } from '../components/commons/useCommonsTx'
import { TimeCurvePanel } from '../components/commons/TimeCurvePanel'
import { AmortizingVaultPanel } from '../components/commons/AmortizingVaultPanel'
import { MutualCreditPanel } from '../components/commons/MutualCreditPanel'

/**
 * The Commons: Suwappu's public-good primitives. Immutable, ownerless,
 * dependency-free contracts — no admin key, no upgrade, no fee switch. We
 * deployed them; we can't change, pause, or tax them. This page is one
 * front end among any number anyone can build.
 */

type Tab = 'overview' | 'curve' | 'vault' | 'credit'

const PRIMITIVES: { id: Tab; name: string; address: string; line: string; body: string }[] = [
  {
    id: 'curve',
    name: 'TimeCurve',
    address: COMMONS.timeCurve,
    line: 'Fair launch without a launchpad.',
    body: 'Price is a pure function of supply and time, set at deploy. No team allocation to dump, no LP to pull — the reserve is provably enough to buy back every token.',
  },
  {
    id: 'vault',
    name: 'AmortizingVault',
    address: COMMONS.amortizingVault,
    line: 'Loans that repay themselves.',
    body: 'Borrow against yield-bearing collateral; the yield pays the debt down. Anyone can trigger repayment. No oracle to manipulate.',
  },
  {
    id: 'credit',
    name: 'MutualCredit',
    address: COMMONS.mutualCredit,
    line: 'Credit without a bank.',
    body: 'Bilateral IOU lines between people who trust each other, with permissionless netting of debt cycles. Only the residue ever needs real money.',
  },
]

export function CommonsRoute() {
  const [tab, setTab] = usePersistentState<Tab>('commons:tab', 'overview')
  const { wrongChain } = useCommonsTx()

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto pb-4 md:gap-2 [&>*]:shrink-0">
      <TerminalPanel elevated className="flex flex-col gap-3 p-[var(--terminal-space-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid max-w-3xl gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <TerminalEyebrow tone="accent">Suwappu Commons</TerminalEyebrow>
              <TerminalStatusPill tone="warm">Base Sepolia · testnet · unaudited</TerminalStatusPill>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-terminal-text md:text-2xl">
              Financial primitives nobody owns.
            </h1>
            <p className="text-sm text-terminal-text-secondary">
              Three immutable contracts with no owner, no upgrade path, no governance and no fees to us. Once deployed they are
              infrastructure — like a road, anyone can use them and nobody can close them. This page is just one door in.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <WalletButton />
            <Faucet />
          </div>
        </div>
        {wrongChain && (
          <p className="text-xs text-terminal-warn">
            Your wallet is on another network. Actions will ask to switch to {COMMONS_CHAIN.name}.
          </p>
        )}
        {/* One row, horizontally scrollable on phones — wrapping collided with the header. */}
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="w-max">
        <TerminalSegmentedTabs
          activeId={tab}
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'curve', label: 'TimeCurve' },
            { id: 'vault', label: 'AmortizingVault' },
            { id: 'credit', label: 'MutualCredit' },
          ]}
          onChange={(id) => setTab(id as Tab)}
        />
          </div>
        </div>
      </TerminalPanel>

      {tab === 'overview' && <Overview onOpen={setTab} />}
      {tab === 'curve' && <TimeCurvePanel />}
      {tab === 'vault' && <AmortizingVaultPanel />}
      {tab === 'credit' && <MutualCreditPanel />}
    </div>
  )
}

function Overview({ onOpen }: { onOpen: (t: Tab) => void }) {
  return (
    <div className="grid gap-1.5 md:gap-2">
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3 md:gap-2">
        {PRIMITIVES.map((p, i) => (
          <TerminalPanel key={p.id} className="flex flex-col gap-2 p-[var(--terminal-space-card)]">
            <span className="font-mono text-[11px] text-terminal-text-muted">0{i + 1}</span>
            <h2 className="text-lg font-semibold text-terminal-text">{p.name}</h2>
            <p className="text-sm font-medium text-terminal-accent">{p.line}</p>
            <p className="flex-1 text-sm text-terminal-text-secondary">{p.body}</p>
            <div className="flex items-center justify-between gap-2 pt-1">
              <a href={addressUrl(p.address)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-terminal-text-muted hover:text-terminal-accent">
                {short(p.address)} ↗
              </a>
              <TerminalButton size="sm" variant="secondary" onClick={() => onOpen(p.id)}>
                Open
              </TerminalButton>
            </div>
          </TerminalPanel>
        ))}
      </div>
      <TerminalPanel className="grid gap-3 p-[var(--terminal-space-card)] md:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <div>
            <TerminalEyebrow>What “public good” means here</TerminalEyebrow>
          </div>
          <ul className="grid gap-1.5 text-sm text-terminal-text-secondary">
            <li><span className="text-terminal-text">No owner.</span> No admin role, no pause, no upgrade proxy. Verify: there is no function that only we can call.</li>
            <li><span className="text-terminal-text">No dependencies.</span> Zero imports, no oracles. Nothing upstream can break or capture them.</li>
            <li><span className="text-terminal-text">No rent.</span> No protocol fee flows to Suwappu. Value stays with the people using them.</li>
            <li><span className="text-terminal-text">Permissionless upkeep.</span> Amortization, liquidation and debt netting can be triggered by anyone.</li>
          </ul>
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <div>
            <TerminalEyebrow>Contracts · {COMMONS_CHAIN.name}</TerminalEyebrow>
          </div>
          {Object.entries(COMMONS).map(([name, addr]) => (
            <a
              key={name}
              href={addressUrl(addr)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded px-1 font-mono text-xs text-terminal-text-secondary hover:text-terminal-accent"
            >
              <span>{name}</span>
              <span className="hidden lg:inline">{addr} ↗</span>
              <span className="lg:hidden">{short(addr)} ↗</span>
            </a>
          ))}
          <p className="text-[11px] text-terminal-text-muted">
            Source: contracts/primitives · TypeScript client: @suwappu/primitives-client. Testnet deployment with mock tokens —
            unaudited, do not point real funds at it.
          </p>
        </div>
      </TerminalPanel>
    </div>
  )
}

/** Terminal-styled wallet control (RainbowKit's default button clashes with the theme). */
function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openChainModal, openAccountModal }) => {
        if (!mounted) return null
        if (!account) {
          return (
            <TerminalButton variant="primary" size="sm" onClick={openConnectModal}>
              Connect wallet
            </TerminalButton>
          )
        }
        if (chain?.id !== COMMONS_CHAIN.id) {
          return (
            <TerminalButton variant="secondary" size="sm" onClick={openChainModal}>
              Switch to {COMMONS_CHAIN.name}
            </TerminalButton>
          )
        }
        return (
          <TerminalButton variant="ghost" size="sm" onClick={openAccountModal}>
            <span className="font-mono">{account.displayName}</span>
          </TerminalButton>
        )
      }}
    </ConnectButton.Custom>
  )
}

/** Test mUSD has a public mint, so the faucet is just a mint() to yourself. */
function Faucet() {
  const { address } = useAccount()
  const { run, busy } = useCommonsTx()
  const { data: bal } = useReadContract({
    address: COMMONS.reserveAsset,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address!],
    chainId: COMMONS_CHAIN.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  if (!address) return null
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <a
        href="https://docs.base.org/base-chain/tools/network-faucets"
        target="_blank"
        rel="noreferrer"
        className="text-terminal-text-muted hover:text-terminal-accent"
        title="Transactions need Base Sepolia ETH for gas"
      >
        need gas? ↗
      </a>
      <span className="font-mono text-terminal-text-secondary">{fmt(bal, 2)} mUSD</span>
      <TerminalButton
        size="sm"
        variant="ghost"
        disabled={!!busy}
        onClick={() => run('Mint 1,000 test mUSD', [call('Mint', COMMONS.reserveAsset, erc20Abi as Abi, 'mint', [address, parseUnits('1000', 18)])])}
      >
        Get 1,000 test mUSD
      </TerminalButton>
    </div>
  )
}
