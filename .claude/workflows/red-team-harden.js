export const meta = {
  name: 'red-team-harden',
  description: 'Adversarial red-team of suwappubot, verify findings, auto-apply fixes on a branch',
  phases: [
    { title: 'Recon',    detail: 'map attack surface per subsystem' },
    { title: 'Attack',   detail: 'one attacker per threat dimension' },
    { title: 'Verify',   detail: 'adversarial skeptics per finding' },
    { title: 'Complete', detail: 'completeness critic + gap finders' },
    { title: 'Harden',   detail: 'apply fixes, one agent per file' },
    { title: 'Validate', detail: 'run tests + write hardening report' },
  ],
}

const SUBSYSTEMS = [
  { key: 'custody',   focus: 'bot/services/wallet.py, hot_wallet.py, kms_client.py, turnkey_client.py, paymaster.py, config/settings.py — key material, encryption, secrets' },
  { key: 'authz',     focus: 'bot/handlers/admin*.py, custodial.py, settings.py; api/routes/oauth.py, webapp.py, mobile.py; api-ts route auth, webhook secret' },
  { key: 'financial', focus: 'bot/services/swap_engine.py, router.py, orders.py, fee_service.py, pnl.py, copy_service.py, sniping/*' },
  { key: 'agent',     focus: 'api-ts/src/routes/agent.ts, mcp.ts, a2a.ts, publicSwap.ts; LangChain tool surface — prompt injection, tool authz' },
  { key: 'data',      focus: 'database/db.py, bot/models/* — SQL injection, input validation, parsing of addresses/amounts' },
  { key: 'external',  focus: 'bot/services/rpc_manager.py, alchemy_client.py, bridge APIs, polymarket_api.py, hyperliquid_client.py — SSRF, oracle/response trust' },
  { key: 'edge',      focus: 'CORS, JWT, x402_service.py, oauth_service.py, rate limiting, public endpoints, dependency manifests' },
]

const MAP_SCHEMA = { type:'object', required:['subsystem','entryPoints','trustBoundaries','sinks','untrustedInputs'], properties:{
  subsystem:{type:'string'}, entryPoints:{type:'array',items:{type:'string'}},
  trustBoundaries:{type:'array',items:{type:'string'}}, sinks:{type:'array',items:{type:'string'}},
  untrustedInputs:{type:'array',items:{type:'string'}}, notes:{type:'string'} } }

const FINDINGS_SCHEMA = { type:'object', required:['findings'], properties:{ findings:{ type:'array', items:{
  type:'object', required:['title','dimension','file','severity','exploit','confidence','fix','secretExposure'], properties:{
    title:{type:'string'}, dimension:{type:'string'}, file:{type:'string'}, line:{type:'string'},
    severity:{type:'string',enum:['critical','high','medium','low']},
    exploit:{type:'string'}, confidence:{type:'number'}, fix:{type:'string'},
    secretExposure:{type:'boolean'} } } } } }

const VERDICT_SCHEMA = { type:'object', required:['isReal','reachable','reasoning'], properties:{
  isReal:{type:'boolean'}, reachable:{type:'boolean'},
  severityAdjusted:{type:'string',enum:['critical','high','medium','low','none']}, reasoning:{type:'string'} } }

const FIX_SCHEMA = { type:'object', required:['file','applied','summary'], properties:{
  file:{type:'string'}, applied:{type:'boolean'}, summary:{type:'string'},
  testAdded:{type:'boolean'}, residualRisk:{type:'string'} } }

// 1. RECON — barrier: every attacker needs the full map
phase('Recon')
const maps = (await parallel(SUBSYSTEMS.map(s => () =>
  agent(`You are mapping the attack surface of the suwappubot subsystem "${s.key}". Focus: ${s.focus}. `
      + `Read the relevant files in the local checkout. Return entry points, trust boundaries, sinks that touch keys/funds/auth, and where untrusted input enters. Do NOT fix anything.`,
    { label:`recon:${s.key}`, phase:'Recon', schema:MAP_SCHEMA, agentType:'Explore' })
))).filter(Boolean)
const mapBrief = maps.map(m => `## ${m.subsystem}\nentry: ${(m.entryPoints||[]).join('; ')}\nboundaries: ${(m.trustBoundaries||[]).join('; ')}\nsinks: ${(m.sinks||[]).join('; ')}\nuntrusted: ${(m.untrustedInputs||[]).join('; ')}`).join('\n\n')

// 2+3. ATTACK -> VERIFY — pipeline: verify each dimension's findings as soon as it finishes.
// Attack + verify are READ-ONLY (Explore) so the ONLY writes happen in the harden-by-file phase.
const verified = await pipeline(SUBSYSTEMS,
  s => agent(`You are a red-team attacker targeting suwappubot's "${s.key}" surface (${s.focus}). `
        + `This bot custodies real funds. Think like an adversary: how do you steal funds, drain wallets, escalate to admin, bypass auth/limits, leak keys, or hijack the AI agent? `
        + `Also check git history for committed secrets/keys (set secretExposure=true on any such finding). `
        + `Use this surface map for context:\n${mapBrief}\n\n`
        + `Report only CONCRETE, exploitable findings with file, line, a precise exploit scenario, severity, and a minimal fix. No theoretical hand-waving. Do NOT edit any files.`,
      { label:`attack:${s.key}`, phase:'Attack', schema:FINDINGS_SCHEMA, agentType:'Explore' }),
  (res, s) => parallel((res?.findings || []).flatMap(f =>
    ['reachability','code-truth'].map(lens => () =>
      agent(`Adversarially verify this suwappubot finding via the ${lens} lens. Default to false if uncertain. Do NOT edit any files. `
          + `Read the actual code at ${f.file}:${f.line||''}. Finding: "${f.title}". Exploit claim: ${f.exploit}. `
          + `${lens==='reachability' ? 'Can an unprivileged attacker actually reach this path? Is there a mitigating control elsewhere? Set reachable accordingly.' : 'Does the code literally do what the finding claims? Quote the lines. Set isReal accordingly.'}`,
        { label:`verify:${s.key}`, phase:'Verify', schema:VERDICT_SCHEMA, agentType:'Explore' })
        .then(v => ({ finding:f, lens, verdict:v })))))
    .then(votes => {
      const byFinding = new Map()
      for (const x of votes.filter(Boolean)) {
        const k = x.finding.title
        if (!byFinding.has(k)) byFinding.set(k, { finding:x.finding, lenses:{} })
        byFinding.get(k).lenses[x.lens] = x.verdict
      }
      // AND of two NECESSARY conditions: code must actually do it (code-truth.isReal)
      // AND an attacker must be able to reach it (reachability.reachable). Both required.
      return [...byFinding.values()].filter(e => {
        const ct = e.lenses['code-truth'], rc = e.lenses['reachability']
        return ct && rc && ct.isReal && rc.reachable
      }).map(e => {
        const adj = e.lenses['reachability'].severityAdjusted
        return { ...e.finding, severity: (adj && adj!=='none') ? adj : e.finding.severity }
      })
    })
)
let confirmed = verified.flat().filter(Boolean)

// 4. COMPLETENESS CRITIC — barrier
phase('Complete')
const gaps = await agent(`Review this confirmed-vulnerability set against the surface maps for suwappubot. `
    + `What high-risk areas were NOT covered (a fund-flow, an auth path, a key sink, an agent tool)? `
    + `Maps:\n${mapBrief}\n\nConfirmed so far: ${confirmed.map(f=>f.title).join('; ')||'(none)'}\n`
    + `List up to 5 specific uncovered targets to attack.`,
  { label:'critic', phase:'Complete', schema:{ type:'object', required:['gaps'], properties:{ gaps:{type:'array',items:{type:'string'}} } } })
if (gaps?.gaps?.length) {
  const extra = await pipeline(gaps.gaps,
    g => agent(`Red-team this specific uncovered suwappubot target: "${g}". Report concrete exploitable findings only. Do NOT edit any files. Set secretExposure=true for any committed-secret finding.`,
      { label:'attack:gap', phase:'Attack', schema:FINDINGS_SCHEMA, agentType:'Explore' }),
    (res) => parallel((res?.findings||[]).map(f => () =>
      agent(`Adversarially verify (default false if unsure; do NOT edit files): "${f.title}" at ${f.file}. Exploit: ${f.exploit}. Read the code; set isReal and reachable.`,
        { label:'verify:gap', phase:'Verify', schema:VERDICT_SCHEMA, agentType:'Explore' }).then(v => ({f,v}))))
      .then(vs => vs.filter(Boolean).filter(x=>x.v.isReal&&x.v.reachable).map(x=>x.f)))
  confirmed.push(...extra.flat().filter(Boolean))
}
log(`Confirmed findings: ${confirmed.length}`)

// PARTITION: committed/leaked secrets cannot be fixed by a code edit (need rotation + history
// purge, which no agent does). Route them to the report as REQUIRES ROTATION — never to a harden agent.
const requiresRotation = confirmed.filter(f => f.secretExposure)
const autoFixable      = confirmed.filter(f => !f.secretExposure)
log(`Auto-fixable: ${autoFixable.length}; requires rotation (not auto-fixed): ${requiresRotation.length}`)

// 5. HARDEN — one agent per file (no two agents touch the same file)
phase('Harden')
const byFile = new Map()
for (const f of autoFixable) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f) }
const fixes = await parallel([...byFile.entries()].map(([file, fs]) => () =>
  agent(`Harden the file ${file} in the suwappubot checkout. Apply MINIMAL, behavior-preserving fixes for these confirmed vulnerabilities:\n`
      + fs.map((f,i)=>`${i+1}. [${f.severity}] ${f.title} — ${f.exploit}\n   suggested: ${f.fix}`).join('\n')
      + `\nThis code moves real funds — do not break existing behavior. Add a regression test if a test file for this module exists. Edit the file directly. Return what you changed and any residual risk.`,
    { label:`harden:${file}`, phase:'Harden', schema:FIX_SCHEMA })))

// 6. VALIDATE + REPORT — barrier
phase('Validate')
const validation = await agent(`Auto-detect and run the suwappubot test suite for the modules that were just changed `
    + `(${[...byFile.keys()].join(', ')}). pytest for Python (bot/, api/, packages/), npm test/vitest for api-ts/. `
    + `Report which suites ran, pass/fail counts, and any failures introduced by the hardening edits.`,
  { label:'validate', phase:'Validate' })
const report = await agent(`Write SECURITY_HARDENING.md at the repo root for suwappubot. Severity-ranked. For each confirmed finding: `
    + `title, file:line, dimension, exploit scenario, the fix applied, residual risk. Then a summary table and a "test results" section. `
    + `Add a prominent "REQUIRES MANUAL ROTATION — NOT auto-fixed" section for the secret-exposure findings: these need credential rotation + git-history purge (e.g. git filter-repo / BFG), which code edits cannot resolve.\n\n`
    + `Auto-fixed findings:\n${JSON.stringify(autoFixable)}\n\nRotation-required (NOT fixed):\n${JSON.stringify(requiresRotation)}\n\nFixes applied:\n${JSON.stringify(fixes.filter(Boolean))}\n\nTest run:\n${validation}`,
  { label:'report', phase:'Validate' })
return { confirmed: confirmed.length, autoFixed: fixes.filter(Boolean).length, requiresRotation: requiresRotation.length, report }
