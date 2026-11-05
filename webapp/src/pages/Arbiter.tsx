import { useState, useMemo } from 'react'
import { AppLayout, AppHeader } from '../components/layout'
import { ARBITER_FIXTURES, type ArbiterFixtureOutput } from '../data/arbiterFixtures'

type ScenarioKey = 'pass' | 'fail-author' | 'fail-unmerged'

const SCENARIOS: { key: ScenarioKey; title: string; blurb: string; tone: string }[] = [
  { key: 'pass', title: 'Merged PR (pass)', blurb: 'octocat merges PR #7 into arbiter-demo/shop; rubric satisfied; escrow pays the worker.', tone: 'pass' },
  { key: 'fail-author', title: 'Wrong author (fail)', blurb: 'PR is merged, but by mallory, not octocat. Rubric fails; funds stay refundable.', tone: 'fail' },
  { key: 'fail-unmerged', title: 'Unmerged PR (fail)', blurb: 'Pull request sits open. Merge never happens; rubric fails; funds stay refundable.', tone: 'fail' },
]

const LIVE_TXS = [
  { label: 'pass · create escrow (0.1 NEAR)', hash: 'G4m5Y2oVAZgzqxm829QgfydcWtPwXq2SkyWbSGQZhQT3' },
  { label: 'pass · resolve → worker paid + attestation log', hash: 'oEgUKBZhM8YuzUZDVzWaTTwhqetYmELguSKwskkVdSE' },
  { label: 'fail · create escrow (0.05 NEAR)', hash: 'DcuTtNNjYT5ejQBxhApMoZzdLKnscMXLBMtszccgAq3' },
  { label: 'fail · resolve → no transfer + attestation log', hash: 'DbVioHm1Khqeev9ACaaCq2E146kebTW5fycKvQTiRNJo' },
  { label: 'fail · buyer refund', hash: 'CiKQwXex9q3xNTveHiu5XT2rEtFkvJUWT4BJQuQft6ok' },
]

const mono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }

function useSteps(scenario: ArbiterFixtureOutput | null) {
  const [step, setStep] = useState<number>(-1)
  const done = scenario !== null && step >= 4

  const run = () => {
    setStep(0)
    const seq = [0, 1, 2, 3, 4]
    let i = 0
    const tick = () => {
      i += 1
      if (i < seq.length) {
        setStep(seq[i])
        setTimeout(tick, i === 2 ? 900 : 550)
      }
    }
    setTimeout(tick, 500)
  }

  return { step, done, run }
}

export function Arbiter() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('pass')
  const fixture = ARBITER_FIXTURES[scenarioKey]
  const [verdict, setVerdict] = useState<ArbiterFixtureOutput | null>(null)
  const { step, done, run } = useSteps(verdict)

  const steps = useMemo(
    () => [
      { label: 'Escrow funded', detail: 'Buyer locks NEAR against terms { context, repo, pr#, author, deadline } — rubric hash anchored at creation.' },
      { label: 'Worker delivers', detail: 'PR merges. GitHub fires an HMAC-signed pull_request webhook (raw payload captured).' },
      { label: 'TEE verifies', detail: 'arbiter-wasm.wasm (sha256-pinned) runs inside OutLayer Intel TDX: HMAC verify → parse → rubric. Zero network I/O. No private key in the enclave.' },
      { label: 'Settlement', detail: verdict?.verdict === 'pass' ? 'Contract callback: verdict=pass → pay worker + anchor attestation (tx log event).' : 'Contract callback: verdict=fail → no transfer; buyer recovers funds.' },
    ],
    [verdict],
  )

  const attempt = () => {
    setVerdict(null)
    setTimeout(() => {
      setVerdict(fixture.output)
      run()
    }, 60)
  }

  const reset = () => {
    setVerdict(null)
  }

  const tone = verdict?.verdict === 'pass'

  return (
    <AppLayout header={<AppHeader title="Suwappu Arbiter" />}>
      <main className="px-4 py-4 max-w-5xl mx-auto w-full pb-24">
        {/* Hero */}
        <section className="rounded-suwappu-xl bg-gradient-to-br from-suwappu-purple-deep via-suwappu-purple to-suwappu-sakura p-5 text-white shadow-suwappu-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] bg-white/15 rounded-full px-2 py-0.5 font-semibold">Proof of Done</span>
            <span className="text-[10px] uppercase tracking-[0.2em] bg-black/20 rounded-full px-2 py-0.5">NEAR · OutLayer TDX</span>
          </div>
          <h2 className="font-heading font-bold text-xl leading-tight">Escrowed milestones.<br />Hardware-verified delivery.</h2>
          <p className="text-sm text-white/85 mt-1.5 max-w-md">
            Buyers lock funds against a machine-checkable rubric. An arbiter WASM in an Intel TDX enclave verifies the evidence. Pass pays; fail refunds. Nobody — not us, not the worker, not the buyer — can argue with the verdict.
          </p>
          <p className="text-[11px] text-white/60 mt-2">The picker replays recorded arbiter-wasm outputs (no funds). The same WASM has also run live on NEAR testnet via <code className="text-white/80">outlayer.testnet</code> — see the evidence below.</p>
        </section>

        {/* Scenario picker */}
        <section className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-suwappu-text-secondary font-semibold mb-2">Pick a scenario</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => { setScenarioKey(s.key); reset() }}
                className={`text-left rounded-suwappu-lg border p-3 transition-all ${scenarioKey === s.key ? 'border-suwappu-purple bg-white shadow-suwappu-1 ring-2 ring-suwappu-purple/30' : 'border-suwappu-sakura-mid/30 bg-white/60'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${s.tone === 'pass' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <p className="font-heading font-semibold text-[13px] text-suwappu-text">{s.title}</p>
                </div>
                <p className="text-[11px] text-suwappu-text-secondary mt-1 leading-snug">{s.blurb}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Terms panel */}
        <section className="mt-3 rounded-suwappu-lg bg-suwappu-bg border border-suwappu-sakura-mid/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-suwappu-text-secondary font-semibold">Escrow terms (immutable at creation)</p>
            <span className="text-[10px] text-suwappu-text-secondary">rubric: github_pr · v1</span>
          </div>
          <div className="mt-1.5 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-1.5" style={mono}>
            <div><span className="text-suwappu-text-secondary block">repo</span>arbiter-demo/shop</div>
            <div><span className="text-suwappu-text-secondary block">pr_number</span>#7</div>
            <div><span className="text-suwappu-text-secondary block">author</span>octocat</div>
            <div><span className="text-suwappu-text-secondary block">deadline_unix</span>{fixture.input.deadline_unix}</div>
          </div>
        </section>

        {/* Run controls */}
        <section className="mt-3 flex items-center gap-2">
          {!verdict ? (
            <button onClick={attempt} className="flex-1 rounded-suwappu-lg bg-suwappu-purple-deep text-white font-heading font-semibold text-sm py-3 active:scale-[0.98] transition-transform">
              Run arbitration
            </button>
          ) : (
            <button onClick={reset} className="flex-1 rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/40 text-suwappu-text font-heading font-semibold text-sm py-3">
              Reset
            </button>
          )}
          <a href="https://docs.near.org" target="_blank" rel="noreferrer" className="rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/40 px-4 py-3 text-[12px] font-semibold text-suwappu-purple-deep">NEAR docs</a>
        </section>

        {/* Pipeline timeline */}
        <section className="mt-4">
          <ol className="space-y-2">
            {steps.map((s, i) => {
              const state = step < 0 ? 'idle' : i < step || (done && i === 3) ? 'done' : i === step ? 'active' : 'idle'
              return (
                <li key={s.label} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                    state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-suwappu-purple text-white animate-pulse' : 'bg-suwappu-sakura-mid/30 text-suwappu-text-secondary'
                  }`}>
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <div className="flex-1 rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/20 px-3 py-2">
                    <p className="text-[12px] font-heading font-semibold text-suwappu-text">{s.label}</p>
                    <p className="text-[11px] text-suwappu-text-secondary leading-snug mt-0.5">{s.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        {/* Verdict + attestation */}
        {done && verdict && (
          <section className="mt-4">
            <div className={`rounded-suwappu-lg p-4 border ${tone ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
              <div className="flex items-center justify-between">
                <p className="font-heading font-bold text-lg">{tone ? 'PASS — worker paid' : 'FAIL — no transfer'}</p>
                <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${tone ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>{verdict.reason}</span>
              </div>
              <div className="mt-2 rounded-md bg-black/85 text-emerald-300 p-3 text-[11px] leading-relaxed overflow-x-auto" style={mono}>
                {'{'}
                {'\n'}  "verdict": "{verdict.verdict}",
                {'\n'}  "reason": "{verdict.reason}",
                {'\n'}  "evidence_hash": "{verdict.evidence_hash}",
                {'\n'}  "arbiter_code": "sha256-pinned arbiter-wasm.wasm",
                {'\n'}  "executor": "OutLayer (outlayer.testnet)"
                {'\n'}{'}'}
              </div>
              <p className="text-[11px] text-suwappu-text-secondary mt-2">
                The contract only moves funds after the enclave returns this exact JSON from OutLayer via a cross-contract callback. Verdict, evidence hash and worker are logged on-chain in the settlement tx — that's the attestation.
              </p>
            </div>
          </section>
        )}

        {/* Live testnet evidence */}
        <section className="mt-4 rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-suwappu-text-secondary font-semibold">Live on NEAR testnet — real OutLayer executions</p>
          <p className="text-[11px] text-suwappu-text-secondary mt-1">Contract <code>suwappu-arbiter.testnet</code>. Testnet funds only (0.1 / 0.05 NEAR).</p>
          <ul className="mt-2 text-[11px] space-y-1" style={mono}>
            {LIVE_TXS.map((t) => (
              <li key={t.hash} className="flex items-center justify-between gap-2">
                <span className="text-suwappu-text">{t.label}</span>
                <a className="text-suwappu-purple-deep underline truncate" href={`https://testnet.nearblocks.io/txns/${t.hash}`} target="_blank" rel="noreferrer">{t.hash.slice(0, 10)}…</a>
              </li>
            ))}
          </ul>
        </section>

        {/* Verify yourself */}
        <section className="mt-4 rounded-suwappu-lg bg-white border border-suwappu-sakura-mid/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-suwappu-text-secondary font-semibold">Verify it yourself (no trust in Suwappu required)</p>
          <ol className="mt-2 text-[11px] space-y-1.5 text-suwappu-text-secondary" style={mono}>
            <li>1. <span className="text-suwappu-purple-deep">sha256sum</span> arbiter_wasm.wasm <span className="text-suwappu-text-secondary"># compare against escrow.arbiter_wasm_hash</span></li>
            <li>2. <span className="text-suwappu-purple-deep">near view</span> suwappu-arbiter.testnet get_escrow '{'{'}"id":0{'}'}' <span className="text-suwappu-text-secondary"># terms, worker, amount, status</span></li>
            <li>3. <span className="text-suwappu-purple-deep">near tx</span> oEgUKBZhM8YuzUZDVzWaTTwhqetYmELguSKwskkVdSE --networkId testnet <span className="text-suwappu-text-secondary"># logs arbiter_attestation line</span></li>
          </ol>
          <p className="text-[10px] text-suwappu-text-secondary mt-2">Attestation schema: <code>docs/arbiter-attestation-v1.md</code> · Roadmap (Suwappu Arbiter product line): <code>ARBITER.md</code></p>
        </section>
      </main>
    </AppLayout>
  )
}
