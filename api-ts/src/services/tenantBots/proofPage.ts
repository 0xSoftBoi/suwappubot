/**
 * The proof page, as a page.
 *
 * `/v1/bots/proof/:handle` returned JSON, and I had been describing it as
 * "everyone gets their own assistancefund.top". That was wrong in a way worth
 * naming: assistancefund.top is a *page a holder can look at*. The audience for
 * this surface is someone in a Telegram group who does not trust the team and
 * taps a link on their phone — not a developer with `jq`. A wall of braces
 * proves nothing to them, which means the feature was not doing its job.
 *
 * Constraints that shaped it:
 *
 * - **No JavaScript, no external assets.** It renders inside Telegram's in-app
 *   browser on a bad connection. Everything is inline and the page is complete
 *   on first byte.
 * - **Caveats above the numbers.** The whole argument of this surface is that
 *   stating what it does not prove is what makes the rest believable. Putting
 *   them in a footer would invert that.
 * - **Every claim links to a block explorer.** A number a reader cannot check
 *   is our word for it, and our word is explicitly not the point.
 *
 * ## Escaping
 *
 * This is the first HTML surface in api-ts, and it renders strings a tenant
 * controls — bot name, branding mark, funding note, refusal reasons — on a
 * PUBLIC page that holders visit. That is a stored-XSS surface aimed at exactly
 * the people the page exists to protect. Everything interpolated goes through
 * `esc()`, and the tests assert that rather than trusting it.
 */

/** HTML-escape. Applied to every interpolated value without exception —
 *  including ones that "cannot" contain markup, because that assumption is how
 *  escaping bugs are born. */
export function esc(value: unknown): string {
	if (value === null || value === undefined) return ''
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/** Only allow links we constructed. A tenant-supplied string must never become
 *  an href — `javascript:` in a link on a page holders are told to trust would
 *  be the worst possible outcome here. */
export function safeUrl(url: unknown): string | null {
	if (typeof url !== 'string') return null
	const trimmed = url.trim()
	if (!/^https:\/\//i.test(trimmed)) return null
	return esc(trimmed)
}

export interface ProofPageRun {
	status: string
	reason: string | null
	spend_usd: number
	token_amount: string | null
	tx_hash: string | null
	explorer_url: string | null
	started_at: string
	verification: string
}

export interface ProofPageData {
	bot: {
		name: string
		handle: string | null
		token_symbol: string | null
		token_chain: string | null
		token_address: string | null
		treasury_address: string | null
		status: string
	}
	funding: { source: string; note: string | null }
	headline: string
	totals: {
		executed_runs: number
		executed_spend_usd: number
		simulated_runs: number
		skipped_runs: number
		failed_runs: number
		verifiable_runs: number
		confirmed_on_chain: number
		failed_verification: number
		first_run_at: string | null
		last_run_at: string | null
	}
	caveats: { code: string; text: string }[]
	schedule: {
		name: string
		kind: string
		cron: string | null
		mode: string
		armed: boolean
		max_usd_per_run: number
		max_usd_per_day: number
		burn_address: string | null
	}[]
	runs: ProofPageRun[]
	disclosure: string
}

const FUNDING_LABEL: Record<string, string> = {
	revenue: 'Recurring revenue or fees',
	treasury: 'Treasury reserves',
	undisclosed: 'Not stated by the team',
}

const VERIFICATION_LABEL: Record<string, string> = {
	verified: 'Confirmed on-chain',
	mismatch: 'NOT confirmed',
	pending: 'Awaiting confirmation',
	not_found: 'Not found on-chain',
	unavailable: 'Check unavailable',
	unsupported_chain: 'No explorer',
}

const STATUS_LABEL: Record<string, string> = {
	succeeded: 'Executed',
	simulated: 'Dry run',
	skipped: 'Refused',
	failed: 'Failed',
}

function fmtDate(iso: string | null): string {
	if (!iso) return '—'
	try {
		const d = new Date(iso)
		return `${d.toUTCString().slice(5, 22)} UTC`
	} catch {
		return '—'
	}
}

function shortHash(hash: string | null): string {
	if (!hash) return '—'
	return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash
}

/**
 * Deliberately monochrome plus two signal colours. This page is read by someone
 * deciding whether to believe a number; anything that looks like marketing
 * undermines it, so it is styled like a statement rather than a landing page.
 */
const STYLES = `
:root{color-scheme:light dark;--bg:#fbfbf9;--panel:#fff;--ink:#16202b;--muted:#5c7080;
--line:#e2e8ec;--good:#1f7a4d;--bad:#b23b3b;--warn:#8a5a12;--warnbg:#fdf6e7}
@media(prefers-color-scheme:dark){:root{--bg:#0e1319;--panel:#141b23;--ink:#e8eef5;
--muted:#93a4b5;--line:#232e3a;--good:#4cc38a;--bad:#f07070;--warn:#e0b155;--warnbg:#231c0e}}
*{box-sizing:border-box;min-width:0}
body{margin:0;padding:20px 16px 56px;background:var(--bg);color:var(--ink);
font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
/* min() rather than a bare max-width: on a 430px phone a bare max-width still
   lets a wide child (the run table) stretch the page, which pushed every
   right-hand value off-screen — the run counts rendered blank. */
.wrap{max-width:min(760px,100%);margin:0 auto}
h1{font-size:1.45rem;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:.9rem;margin-bottom:20px}
.headline{font-size:1.15rem;font-weight:700;margin:0 0 18px;line-height:1.4}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;
padding:16px;margin-bottom:16px}
h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
margin:0 0 10px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px}
.n{font-size:1.5rem;font-weight:700;line-height:1.1}
.nl{font-size:.75rem;color:var(--muted);margin-top:2px}
.good{color:var(--good)}.bad{color:var(--bad)}
.caveat{background:var(--warnbg);border:1px solid var(--warn);border-radius:10px;
padding:12px 14px;margin-bottom:10px;font-size:.9rem;line-height:1.5;color:var(--warn)}
.caveat.crit{border-color:var(--bad);color:var(--bad);background:transparent}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;
color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
a{color:inherit}
/* The table scrolls inside its own box instead of widening the document. */
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
.scroll table{min-width:520px}
th,td{white-space:nowrap}
td.wrapcell{white-space:normal;min-width:9rem}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}
.foot{color:var(--muted);font-size:.82rem;line-height:1.55;margin-top:22px}
/* Wraps rather than overflowing: a long treasury address must push the value
   onto its own line, never off the edge of the phone. */
.kv{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 12px;padding:7px 0;
border-bottom:1px solid var(--line);font-size:.88rem}
.kv:last-child{border-bottom:0}
.kv span:first-child{color:var(--muted)}
.kv span:last-child{text-align:right;margin-left:auto;overflow-wrap:anywhere}
.headline,.caveat,.foot{overflow-wrap:anywhere}
`

/** Caveats that describe money already gone get the louder treatment. */
const CRITICAL = new Set(['failed_verification', 'recently_failing'])

export function renderProofPage(d: ProofPageData): string {
	const t = d.totals
	const symbol = d.bot.token_symbol ?? 'the token'
	const title = `${d.bot.name} — treasury record`

	const caveats = d.caveats
		.map(
			(c) =>
				`<div class="caveat${CRITICAL.has(c.code) ? ' crit' : ''}">${esc(c.text)}</div>`,
		)
		.join('')

	const schedule = d.schedule.length
		? d.schedule
				.map(
					(s) => `<div class="kv"><span>${esc(s.name)}</span><span>${
						s.armed ? 'Live' : 'Not armed'
					} · up to $${esc(s.max_usd_per_run)}/run, $${esc(s.max_usd_per_day)}/day</span></div>`,
				)
				.join('')
		: '<div class="kv"><span>No spending automations configured</span><span></span></div>'

	const rows = d.runs
		.map((r) => {
			const link = safeUrl(r.explorer_url)
			const hash = link
				? `<a href="${link}" rel="nofollow noopener">${esc(shortHash(r.tx_hash))}</a>`
				: esc(shortHash(r.tx_hash))
			const vClass =
				r.verification === 'verified' ? 'good' : r.verification === 'mismatch' ? 'bad' : ''
			// A refused run shows its reason where the amount would be: the reason
			// is the informative part of a refusal, and blanking it would hide the
			// most useful rows on the page.
			const detail =
				r.status === 'succeeded' || r.status === 'simulated'
					? esc(r.token_amount ?? '—')
					: `<span class="mono">${esc(r.reason ?? '—')}</span>`
			return `<tr>
<td>${esc(fmtDate(r.started_at))}</td>
<td>${esc(STATUS_LABEL[r.status] ?? r.status)}</td>
<td>${r.spend_usd ? `$${esc(r.spend_usd)}` : '—'}</td>
<td class="wrapcell">${detail}</td>
<td class="${vClass}">${
				r.status === 'succeeded' ? esc(VERIFICATION_LABEL[r.verification] ?? r.verification) : '—'
			}</td>
<td class="mono">${hash}</td>
</tr>`
		})
		.join('')

	return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(d.headline)}">
<meta name="robots" content="noindex">
<style>${STYLES}</style>
</head><body><div class="wrap">

<h1>${esc(d.bot.name)}</h1>
<div class="sub">${d.bot.handle ? `@${esc(d.bot.handle)} · ` : ''}${esc(symbol)}${
		d.bot.token_chain ? ` on ${esc(d.bot.token_chain)}` : ''
	}</div>

<p class="headline">${esc(d.headline)}</p>

${caveats ? `<div>${caveats}</div>` : ''}

<div class="panel">
<h2>What the chain confirms</h2>
<div class="grid">
<div><div class="n good">${esc(t.confirmed_on_chain)}</div><div class="nl">confirmed on-chain</div></div>
<div><div class="n${t.failed_verification > 0 ? ' bad' : ''}">${esc(
		t.failed_verification,
	)}</div><div class="nl">not confirmed</div></div>
<div><div class="n">$${esc(t.executed_spend_usd.toLocaleString())}</div><div class="nl">spent, executed runs</div></div>
<div><div class="n">${esc(t.executed_runs)}</div><div class="nl">executed runs</div></div>
</div>
</div>

<div class="panel">
<h2>Everything else that happened</h2>
<div class="kv"><span>Dry runs (moved nothing)</span><span>${esc(t.simulated_runs)}</span></div>
<div class="kv"><span>Refused by a guard</span><span>${esc(t.skipped_runs)}</span></div>
<div class="kv"><span>Failed</span><span>${esc(t.failed_runs)}</span></div>
<div class="kv"><span>First run</span><span>${esc(fmtDate(t.first_run_at))}</span></div>
<div class="kv"><span>Most recent run</span><span>${esc(fmtDate(t.last_run_at))}</span></div>
</div>

<div class="panel">
<h2>Funding &amp; schedule</h2>
<div class="kv"><span>Where the money comes from</span><span>${esc(
		FUNDING_LABEL[d.funding.source] ?? d.funding.source,
	)}</span></div>
${d.funding.note ? `<div class="kv"><span>Detail</span><span>${esc(d.funding.note)}</span></div>` : ''}
${d.bot.treasury_address ? `<div class="kv"><span>Treasury</span><span class="mono">${esc(d.bot.treasury_address)}</span></div>` : ''}
${d.bot.token_address ? `<div class="kv"><span>Token</span><span class="mono">${esc(d.bot.token_address)}</span></div>` : ''}
${schedule}
</div>

<div class="panel">
<h2>Every run, including the ones that did not work</h2>
<div class="scroll"><table>
<thead><tr><th>When</th><th>Result</th><th>Spent</th><th>Amount / reason</th><th>On-chain</th><th>Tx</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">No runs yet.</td></tr>'}</tbody>
</table></div>
</div>

<p class="foot">${esc(d.disclosure)}</p>
<p class="foot">This record is generated from the bot's own execution log and checked
against a public block explorer. Published by the project; hosted by Suwappu.</p>

</div></body></html>`
}
