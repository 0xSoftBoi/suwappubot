# Bug Bounty Program - Relay

Source: https://docs.relay.link/security/bounties

On this page
How payouts are calculated
Severity
Likelihood
Base payout matrix
Modifiers
Worked examples
Flash loan reentrancy on withdrawal
Fee parameter drift
Permanent pool freeze via griefing
Edge cases
Discretionary bonuses
PoC requirements
Out of scope
Reward process and requirements
Reporting a vulnerability
Safety & Security
Bug Bounty Program
Copy page

How Relay classifies and rewards vulnerability reports.

Relay runs a bug bounty program to make responsible disclosure financially rational for security researchers. Rewards scale with how much damage a bug can cause and how feasible it is to exploit in practice. We run monitoring and circuit breakers across the stack, so the likelihood tiers and modifiers reflect real response capacity — not a hypothetical one.
This framework applies across Relay’s protocol and services.
​
How payouts are calculated
Every valid report goes through five steps:
Classify severity (S1–S4) — how bad is the damage if exploited?
Classify likelihood (L1–L3) — how feasible is exploitation in practice?
Read the base payout from the matrix.
Apply modifiers (×0.5 to ×1.5) from the fixed list.
Round to the nearest $500 (ties round up). Floor: $500. Cap: $100,000.
​
Severity
Severity captures what happens if the bug is exploited — damage magnitude and how fast it occurs.
Tier	Rule of thumb	Definition
S4 — Critical	Can drain everything immediately	Total fund theft or protocol insolvency with no time to react.
S3 — High	Large or fast theft, or permanent freeze	Large-scale fund theft or permanent freeze. Requires some setup, but fast once triggered.
S2 — Medium	Partial or slow damage	Bounded drain (capped percentage, not total) or slow drain with a response window. Temporary freeze.
S1 — Low	Annoying but not financially dangerous	Griefing, minor economic damage, DoS with no fund loss, or an admin-only bug with no external exploit path.
Four rules resolve the most common classification calls:
Theft outranks freeze. Stealing funds is more severe than locking them, even at a larger nominal amount.
Instant outranks slow. A slow drain gives us time to detect and pause; an instant drain does not.
If damage is capped, severity is based on the cap — not total TVL.
Admin-only bugs are S1. Functions behind onlyOwner or an equivalent role do not escalate above S1 regardless of the potential damage. They are only eligible for a bounty when there is an external path to reach the role (see below).
​
Likelihood
Likelihood captures how probable exploitation is in practice.
Tier	Rule of thumb	Criteria
L3 — High	Anyone can do it anytime	No prerequisites. Callable by any EOA with publicly available calldata.
L2 — Medium	Needs setup (flash loans, timing, conditions)	Requires specific conditions: flash loan infra, a particular chain state, MEV infrastructure, or another protocol being in a particular state.
L1 — Low	Needs a privileged role or rare situation	Requires privileged access (operator, solver, oracle), very specific market conditions, or a multi-step attack depending on several parties.
We reduce likelihood by one tier (floored at L1) when the exploit freezes rather than steals (unless the freeze is a step toward theft).
​
Base payout matrix
	L3 — High	L2 — Medium	L1 — Low
S4 — Critical	$100,000	$50,000	$20,000
S3 — High	$30,000	$15,000	$7,500
S2 — Medium	$10,000	$5,000	$2,000
S1 — Low	$2,000	$1,000	$500
The floor of $500 applies only when a report demonstrates an external exploit path — an attacker without a privileged role can reach the bug.
A report is not eligible for a bounty when:
The only exploit path requires a privileged role (owner, operator, solver, oracle).
The reporter does not demonstrate that an unprivileged party can reach that role or induce the privileged party to act.
The bug would not fire under normal operation.
These are real bugs and we still want them reported — they just do not qualify as vulnerabilities under this framework. Strong write-ups in this category are candidates for a discretionary bonus.
​
Modifiers
After landing on a base payout, apply modifiers multiplicatively. Modifiers are drawn from the fixed list below.
Quick checklist:
×1.5 — permanently unrecoverable damage
×1.25 — hard to fix / hard to detect
×0.75 — expensive to exploit, or pausable with active monitoring
×0.5 — damage capped to a sub-pool
Full trigger definitions:
Modifier	Trigger	Factor
Permanently unrecoverable	Damage cannot be reversed after exploit — freeze with no pause or upgrade, or theft with funds laundered/bridged before response is possible	×1.5
High remediation cost	Fix requires a full contract redeploy across multiple chains	×1.25
Silent / undetectable	No onchain event emitted, no alert surface, could run unnoticed for days	×1.25
High attacker cost	Exploit requires significant capital at risk or fees that materially reduce net gain	×0.75
Pausable + monitored	Contract can be paused. Active monitoring with sub-5-minute response is in place and would meaningfully reduce loss against this specific exploit	×0.75
Bounded damage pool	Damage capped to a sub-pool, not full TVL (e.g. fee buffer only)	×0.5
The permanently unrecoverable modifier (×1.5) applies when damage from an exploit cannot be reversed once it happens. This is different from how quickly the damage occurs (which is captured by severity tiers). This modifier is used if the funds or system state cannot be restored after the exploit, such as when funds are stolen and removed before any response is possible (e.g., laundered or bridged out), or when a freeze is permanent with no way to pause or upgrade the contract.
Modifiers stack. The final amount is floored at $500, capped at $100,000, and rounded to the nearest $500.
Worked example. S3/L2 base = $15,000. Pausable (×0.75) and bounded to the fee buffer (×0.5) → $15,000 × 0.75 × 0.5 = $5,625 → $5,500.
​
Worked examples
​
Flash loan reentrancy on withdrawal
An attacker uses a flash loan to reenter the withdrawal function and drain depository contract funds in a single transaction. No special permissions required.
Severity: S4 — instant, total fund theft.
Likelihood: L2 — requires flash loan infrastructure and a specific reentrancy window.
Base: $50,000. Permanently unrecoverable (×1.5) — funds laundered in the same tx before any response is possible. Final: $75,000.
​
Fee parameter drift
A rounding error lets any filler extract ~2 bps above their entitled fee per fill. Callable by any EOA, damage accumulates slowly, bounded to the fee buffer.
Severity: S2 — slow drain, bounded to the fee pool.
Likelihood: L3 — any EOA, any time.
Base: $10,000. Bounded damage pool (×0.5) and pausable + monitored (×0.75) → $3,750 → $4,000.
​
Permanent pool freeze via griefing
A crafted cross-chain message bricks a specific pool’s accounting, locking all funds in it. The attacker has no way to extract — it is a pure grief and costs gas.
Severity: S3 — permanent freeze of a pool.
Likelihood: L2 — downgraded one tier from L3 because the exploit freezes rather than steals.
Base: $15,000. Permanently unrecoverable (×1.5) → $22,500.
​
Edge cases
“The fix is already deployed.” Payouts are assessed as of report submission, not review. A valid report does not lose value because we moved fast.
“The bug only exists under specific token configurations.” If the configuration is live in production, the report is treated as real. If only theoretical, likelihood drops to L1.
“The reporter also proposed the fix.” Does not change the tier, but is strong grounds for a discretionary bonus.
Duplicate reports. The first submission gets the full payout. A duplicate submitted within 7 days receives 10% of the first report’s payout as a courtesy payment. Duplicates submitted after 7 days are not eligible for payment.
Previously known issues. We treat a finding as already known only when, before your submission, the same root cause was recorded in a dated internal record showing we were already tracking it for remediation, such as an internal ticket or a triaged finding. Raw automated scanner output or an untriaged internal note does not count. When a qualifying record predates your report, the duplicate schedule above applies (10% within 7 days of that record, not eligible after). We will not reduce a payout based on internal discovery we cannot date to before your submission, and, as above, a report never loses value because we detected, triaged, or fixed the issue after you submitted it.
​
Discretionary bonuses
Separate from the matrix, we may award bonuses for:
Exceptional write-ups with clear root cause and a suggested fix.
Novel attack vectors that reveal a systemic pattern.
Proactive disclosure during an active incident.
Bonuses are recognition, not entitlement, and are not pre-committed.
​
PoC requirements
Severity	Requirement
S4, S3	Runnable PoC required. Explanations without code are not accepted.
S2	PoC strongly preferred. A detailed technical explanation is accepted when a PoC is not feasible.
S1	Description sufficient with clear reproduction steps.
​
Out of scope
The following are not eligible for a reward:
Attacks the reporter has already exploited.
Issues requiring phishing, social engineering, or a compromised private key.
Findings in third-party protocols we compose with, unless the root cause is in Relay’s code.
DoS with no fund loss and no path to fund loss.
Theoretical issues with no viable PoC against in-scope assets.
​
Reward process and requirements
KYC and background check. Required before any reward can be issued.
Payment. Rewards are paid in cryptocurrency.
Tax documentation. W-8BEN, W-9, or the equivalent for your jurisdiction is handled as part of KYC.
​
Reporting a vulnerability
Email support@relay.link with a description, reproduction steps, and a runnable PoC where applicable. Most responses are provided within 24 hours, and we will get back to you with next steps within 1 to 4 business days.

Was this page helpful?

Yes
No
Unsupported Exchanges
MEV protection
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform