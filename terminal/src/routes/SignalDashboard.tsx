import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_SIGNAL_API_URL || 'https://signal-lab-dev.up.railway.app'

type Overview = {
  total_transactions?: number; tx_5m?: number; wallets_1h?: number; mints_1h?: number;
  last_ingest?: string; raw_bytes?: number; rows_1h?: number; errors_1h?: number;
}
type Token = {
  mint: string; score: number; label: string; tx_5m: number; tx_30m: number;
  buyers_5m: number; sellers_5m: number; repeat_buyers_5m: number; last_seen?: string;
  components: Record<string,{points:number;max:number;why:string}>; warning: string
}
type Wallet = { wallet:string; mints_24h:number; transactions_24h:number; receive_events:number; send_events:number; label:string; plain_english:string; last_seen?:string }
type Activity = { signature:string; source_program:string; slot:number; fee_payer:string; success:boolean; fee_lamports:number; compute_units:number; instruction_count:number; token_delta_count:number; ingested_at:string; what_it_means:string }
type Evidence = { signature:string; ingested_at:string; fee_payer:string; owner:string; delta:string; decimals:number; direction:string }

type Tab = 'overview'|'tokens'|'wallets'|'activity'|'methodology'

const short = (s?: string) => !s ? '—' : s.length > 15 ? `${s.slice(0,7)}…${s.slice(-5)}` : s
const ago = (s?: string) => {
  if (!s) return '—'; const d = Math.max(0, Date.now()-new Date(s).getTime());
  if (d < 60_000) return `${Math.floor(d/1000)}s ago`; if (d < 3_600_000) return `${Math.floor(d/60_000)}m ago`; return `${Math.floor(d/3_600_000)}h ago`
}
const n = (v?: number) => new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:1}).format(Number(v||0))

function GoogleMark(){return <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-black text-[#4285f4]">G</span>}

export function SignalDashboard() {
  const auth = useAuth()
  const [tab,setTab] = useState<Tab>('overview')
  const [overview,setOverview] = useState<Overview>({})
  const [tokens,setTokens] = useState<Token[]>([])
  const [wallets,setWallets] = useState<Wallet[]>([])
  const [activity,setActivity] = useState<Activity[]>([])
  const [selected,setSelected] = useState<Token|null>(null)
  const [evidence,setEvidence] = useState<Evidence[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState<string|null>(null)
  const [query,setQuery] = useState('')

  useEffect(()=>{
    if (!auth.isAuthenticated) return
    let live = true
    const load = async()=>{
      try {
        const [o,t,w,a] = await Promise.all([
          fetch(`${API}/api/overview`).then(r=>r.json()),
          fetch(`${API}/api/tokens?limit=50`).then(r=>r.json()),
          fetch(`${API}/api/wallets?limit=50`).then(r=>r.json()),
          fetch(`${API}/api/activity?limit=50`).then(r=>r.json()),
        ])
        if (!live) return
        setOverview(o); setTokens(t); setWallets(w); setActivity(a); setError(null)
      } catch { if (live) setError('Signal data is temporarily unavailable.') }
      finally { if (live) setLoading(false) }
    }
    void load(); const id = window.setInterval(load,20_000)
    return()=>{live=false;window.clearInterval(id)}
  },[auth.isAuthenticated])

  useEffect(()=>{
    if(!selected) return
    fetch(`${API}/api/evidence/${selected.mint}`).then(r=>r.json()).then(setEvidence).catch(()=>setEvidence([]))
  },[selected])

  const filteredTokens = useMemo(()=>tokens.filter(t=>t.mint.toLowerCase().includes(query.toLowerCase())),[tokens,query])
  const filteredWallets = useMemo(()=>wallets.filter(w=>w.wallet.toLowerCase().includes(query.toLowerCase())),[wallets,query])

  if (auth.isLoading) return <div className="min-h-screen bg-[#f7f8fa]" />
  if (!auth.isAuthenticated) return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"><a href="/" className="text-lg font-semibold tracking-tight">Suwappu</a><a href="/" className="text-sm text-slate-500 hover:text-slate-900">Back to suwappu.bot</a></div></header>
      <main className="mx-auto grid min-h-[78vh] max-w-7xl place-items-center px-6 py-16">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-7"><div className="mb-3 inline-flex rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">Suwappu Research</div><h1 className="text-3xl font-semibold tracking-tight">Signal Intelligence</h1><p className="mt-2 text-sm leading-6 text-slate-500">Understand what is happening on-chain, which wallets and tokens matter, and exactly why Suwappu derives each signal.</p></div>
          <button onClick={auth.signInWithGoogle} className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium shadow-sm hover:bg-slate-50"><GoogleMark/>Continue with Google</button>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>or<span className="h-px flex-1 bg-slate-200"/></div>
          <button onClick={()=>void auth.signIn()} className="h-11 w-full rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">Use Suwappu passkey</button>
          <p className="mt-5 text-center text-xs leading-5 text-slate-400">Read-only research workspace. Signing in does not grant trading permissions.</p>
        </section>
      </main>
    </div>
  )

  const nav: {id:Tab;label:string;desc:string}[] = [
    {id:'overview',label:'Overview',desc:'What matters now'}, {id:'tokens',label:'Tokens',desc:'Where activity clusters'},
    {id:'wallets',label:'Wallets',desc:'Who keeps appearing'}, {id:'activity',label:'Evidence',desc:'Raw chain events'},
    {id:'methodology',label:'Methodology',desc:'How signals are made'},
  ]

  return <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="flex h-16 items-center gap-4 px-4 lg:px-6"><a href="/" className="text-lg font-semibold tracking-tight">Suwappu</a><span className="text-slate-300">/</span><span className="text-sm font-medium">Signal Intelligence</span><div className="mx-auto hidden w-full max-w-xl md:block"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search mint or wallet address" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-slate-400 focus:bg-white"/></div><div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:inline">Read-only</span><button onClick={auth.signOut} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50">Sign out</button></div></div></header>
    <div className="mx-auto flex max-w-[1600px]">
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block"><div className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Research workspace</div>{nav.map(x=><button key={x.id} onClick={()=>setTab(x.id)} className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left ${tab===x.id?'bg-slate-100 text-slate-900':'text-slate-600 hover:bg-slate-50'}`}><div className="text-sm font-medium">{x.label}</div><div className="mt-0.5 text-xs text-slate-400">{x.desc}</div></button>)}<div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-medium"><span className={`h-2 w-2 rounded-full ${error?'bg-amber-500':'bg-emerald-500'}`}/>{error?'Data delayed':'On-chain collector live'}</div><div className="mt-1 text-[11px] text-slate-500">Last event {ago(overview.last_ingest)}</div></div></aside>
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <div className="mb-5 flex gap-2 overflow-x-auto lg:hidden">{nav.map(x=><button key={x.id} onClick={()=>setTab(x.id)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${tab===x.id?'border-slate-900 bg-slate-900 text-white':'border-slate-200 bg-white'}`}>{x.label}</button>)}</div>
        {error && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>}
        {tab==='overview' && <OverviewView overview={overview} tokens={tokens.slice(0,6)} wallets={wallets.slice(0,6)} onToken={setSelected} loading={loading}/>} 
        {tab==='tokens' && <TokensView tokens={filteredTokens} onToken={setSelected}/>} 
        {tab==='wallets' && <WalletsView wallets={filteredWallets}/>} 
        {tab==='activity' && <ActivityView activity={activity}/>} 
        {tab==='methodology' && <MethodologyView/>}
      </main>
    </div>
    {selected && <EvidenceDrawer token={selected} evidence={evidence} onClose={()=>setSelected(null)}/>} 
  </div>
}

function Title({eyebrow,title,sub}:{eyebrow:string;title:string;sub:string}){return <div className="mb-6"><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{eyebrow}</div><h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{sub}</p></div>}
function Card({children,className=''}:{children:React.ReactNode;className?:string}){return <div className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,.02)] ${className}`}>{children}</div>}
function Kpi({label,value,note}:{label:string;value:string;note:string}){return <Card className="p-5"><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div><div className="mt-1 text-xs text-slate-400">{note}</div></Card>}

function OverviewView({overview,tokens,wallets,onToken,loading}:{overview:Overview;tokens:Token[];wallets:Wallet[];onToken:(t:Token)=>void;loading:boolean}){
 return <><Title eyebrow="Live intelligence" title="What is happening on-chain?" sub="A plain-English summary of the Pump/PumpSwap activity Suwappu is observing. Click any token to see the exact evidence behind its score."/><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Transactions observed" value={loading?'—':n(overview.total_transactions)} note="Canonical on-chain events stored"/><Kpi label="Activity, last 5 min" value={loading?'—':n(overview.tx_5m)} note="Useful for spotting acceleration"/><Kpi label="Active wallets, 1 hour" value={loading?'—':n(overview.wallets_1h)} note="Unique fee-paying wallets"/><Kpi label="Token mints, 1 hour" value={loading?'—':n(overview.mints_1h)} note="Distinct tokens with balance changes"/></div><div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_.8fr]"><Card><div className="border-b border-slate-100 p-5"><div className="font-semibold">Tokens attracting attention</div><div className="mt-1 text-xs text-slate-500">Ranked only by observable flow—not predicted return.</div></div><div>{tokens.length?tokens.map(t=><button key={t.mint} onClick={()=>onToken(t)} className="flex w-full items-center gap-4 border-b border-slate-100 px-5 py-4 text-left last:border-0 hover:bg-slate-50"><div className="min-w-0 flex-1"><div className="font-mono text-xs font-medium">{short(t.mint)}</div><div className="mt-1 text-xs text-slate-500">{t.buyers_5m} receiving wallets · {t.tx_5m} tx / 5m</div></div><div className="text-right"><div className="text-lg font-semibold">{t.score.toFixed(0)}</div><div className="text-[11px] text-slate-400">{t.label}</div></div></button>):<div className="p-8 text-center text-sm text-slate-400">Waiting for token activity.</div>}</div></Card><Card><div className="border-b border-slate-100 p-5"><div className="font-semibold">Repeat participants</div><div className="mt-1 text-xs text-slate-500">Wallets appearing across multiple mints.</div></div>{wallets.map(w=><div key={w.wallet} className="border-b border-slate-100 px-5 py-4 last:border-0"><div className="font-mono text-xs font-medium">{short(w.wallet)}</div><div className="mt-1 text-xs text-slate-500">{w.mints_24h} mints · {w.transactions_24h} observed tx</div><div className="mt-1 text-[11px] font-medium text-slate-700">{w.label}</div></div>)}</Card></div></>
}
function TokensView({tokens,onToken}:{tokens:Token[];onToken:(t:Token)=>void}){return <><Title eyebrow="Token research" title="Where is activity clustering?" sub="Each score is decomposed into visible components. Click a row to inspect the transactions and wallets that produced it."/><Card><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Token</th><th>Signal</th><th>5m tx</th><th>Buyers</th><th>Sellers</th><th className="px-5 text-right">Score</th></tr></thead><tbody>{tokens.map(t=><tr key={t.mint} onClick={()=>onToken(t)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"><td className="px-5 py-4 font-mono text-xs">{short(t.mint)}</td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{t.label}</span></td><td>{t.tx_5m}</td><td>{t.buyers_5m}</td><td>{t.sellers_5m}</td><td className="px-5 text-right font-semibold">{t.score.toFixed(0)}/100</td></tr>)}</tbody></table></div></Card></>}
function WalletsView({wallets}:{wallets:Wallet[]}){return <><Title eyebrow="Participant research" title="Which wallets keep showing up?" sub="These labels describe observed behavior only. They do not claim a wallet is profitable, informed, or connected to a person."/><div className="grid gap-3 lg:grid-cols-2">{wallets.map(w=><Card key={w.wallet} className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="font-mono text-xs font-medium">{short(w.wallet)}</div><div className="mt-2 text-sm font-semibold">{w.label}</div></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{w.mints_24h} mints</span></div><p className="mt-3 text-sm leading-6 text-slate-500">{w.plain_english}</p><div className="mt-4 flex gap-5 border-t border-slate-100 pt-3 text-xs text-slate-500"><span><b className="text-slate-900">{w.receive_events}</b> receive events</span><span><b className="text-slate-900">{w.send_events}</b> send events</span><span>seen {ago(w.last_seen)}</span></div></Card>)}</div></>}
function ActivityView({activity}:{activity:Activity[]}){return <><Title eyebrow="Evidence" title="What actually happened on-chain?" sub="This is the audit trail beneath the dashboard. Every higher-level observation can be traced back to these transactions."/><Card><div className="divide-y divide-slate-100">{activity.map(a=><div key={a.signature} className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="font-mono text-xs font-medium">{short(a.signature)}</div><div className="text-xs text-slate-400">{ago(a.ingested_at)} · slot {a.slot}</div></div><div className="mt-2 text-sm text-slate-600">{a.what_it_means}</div><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500"><span className="rounded bg-slate-100 px-2 py-1">{a.source_program}</span><span className="rounded bg-slate-100 px-2 py-1">{a.instruction_count} instructions</span><span className="rounded bg-slate-100 px-2 py-1">{a.token_delta_count} token changes</span><span className="rounded bg-slate-100 px-2 py-1">{a.success?'confirmed':'failed'}</span></div></div>)}</div></Card></>}
function MethodologyView(){const items=[['Flow acceleration','40 points','Is activity arriving faster than the recent baseline?'],['Buyer breadth','30 points','How many distinct wallets are receiving the token?'],['Buy/sell balance','20 points','Is observed receiving breadth stronger than sending breadth?'],['Repeat participants','10 points','Are wallets that touch multiple mints participating?']];return <><Title eyebrow="Explainability" title="How Suwappu turns chain data into a signal" sub="No black box. The current research score is a transparent attention score built only from observed ledger behavior."/><Card className="p-6"><div className="grid gap-4 md:grid-cols-2">{items.map(([name,points,why])=><div key={name} className="rounded-xl border border-slate-200 p-5"><div className="flex items-center justify-between"><div className="font-semibold">{name}</div><span className="text-xs font-medium text-slate-500">{points}</span></div><p className="mt-2 text-sm leading-6 text-slate-500">{why}</p></div>)}</div><div className="mt-6 rounded-xl bg-slate-900 p-5 text-white"><div className="text-sm font-semibold">What this score does not mean</div><p className="mt-2 text-sm leading-6 text-slate-300">It is not a prediction of price, a recommendation to trade, or proof that a wallet is profitable. It is a structured summary of observable on-chain attention that becomes one input to later research models.</p></div></Card></>}
function EvidenceDrawer({token,evidence,onClose}:{token:Token;evidence:Evidence[];onClose:()=>void}){return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/25" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"><div className="sticky top-0 border-b border-slate-200 bg-white px-6 py-5"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Signal explanation</div><div className="mt-1 font-mono text-sm font-semibold">{short(token.mint)}</div></div><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">Close</button></div></div><div className="p-6"><div className="flex items-end justify-between"><div><div className="text-4xl font-semibold tracking-tight">{token.score.toFixed(0)}</div><div className="mt-1 text-sm text-slate-500">{token.label}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">0–100 attention score</span></div><div className="mt-6 space-y-3">{Object.entries(token.components).map(([name,c])=><div key={name} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between text-sm"><b>{name}</b><span>{c.points}/{c.max}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900" style={{width:`${Math.min(100,c.points/c.max*100)}%`}}/></div><p className="mt-2 text-xs leading-5 text-slate-500">{c.why}</p></div>)}</div><div className="mt-7"><div className="font-semibold">On-chain evidence</div><div className="mt-1 text-xs text-slate-500">Recent balance changes for this mint. These are the events behind the aggregate score.</div><div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">{evidence.slice(0,20).map((e,i)=><div key={`${e.signature}-${i}`} className="p-4"><div className="flex justify-between gap-3"><span className="font-mono text-[11px]">{short(e.signature)}</span><span className="text-[11px] text-slate-400">{ago(e.ingested_at)}</span></div><div className="mt-1 text-xs text-slate-500">Wallet {short(e.owner)} {e.direction} token balance.</div></div>)}</div></div><p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{token.warning}</p></div></aside></div>}
