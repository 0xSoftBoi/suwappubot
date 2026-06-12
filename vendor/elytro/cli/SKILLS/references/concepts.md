# Elytro concepts: spending limit and social recovery

Background reading for the agent. Read this when the user asks what these features mean, or when you are about to touch a command that interacts with them (`security spending-limit`, any write tx, `recovery *`). Understanding the intent behind these features will keep you from making the wrong decision at a branch point.

---

## Spending limit

### What it actually is

`spending_limit` is a **step up verification threshold**, not a hard cap on transaction size. It defines the daily USD value above which the account requires a second factor (email OTP) to authorize a write. Below the threshold, writes go through with just the primary signer. Above the threshold, the same write still goes through, but the backend pauses it and asks for an OTP code first.

This is the same pattern as "you can tap your card for small purchases, but large purchases need a PIN". The card is not blocked. You are not asked to raise your tap limit. You just enter the PIN and continue.

### What the agent should do when a tx exceeds the limit

Submit the transaction normally with `tx send`. If the backend decides the amount is over the threshold, the response will contain an `otpPending` object with an id. This is the expected, designed path, not a failure. Route it through the normal OTP flow: tell the user an email code was sent, wait for them to give you the 6 digit code, then run `otp submit <id> <code>`. The original transaction completes from there. No policy changes are required, and you should not propose any.

### What the agent must not do

Do not build a local preflight check that compares the tx amount against the current `spending_limit` and bails out before calling `tx send`. The backend is the authority on whether step up is required, not the agent. Guessing wrong locally causes two bad outcomes: blocking legitimate transactions that would have gone through with OTP, and skipping step up on transactions that should have had it because your local copy of the policy was stale.

Do not suggest the user run `security spending-limit <higher value>` as a way to get around an OTP prompt. The OTP prompt is the feature. Raising the limit to dodge it defeats the whole point of the second factor and leaves the account weaker afterwards. The only time you should touch `security spending-limit` is when the user explicitly says they want to change their ongoing daily policy, for example "I am doing a lot of small trades today, please raise my daily limit to 500 USD for now".

### Worked example

User says: "send 2 USDC to 0xabc..."
Current `spending_limit`: 1 USD.

Correct sequence:

1. `tx simulate agent-primary --tx "to:0xabc,value:0,data:0x..."` (or the appropriate token transfer spec), show the preview, ask the user to confirm.
2. User confirms.
3. `tx send agent-primary --tx "..."`. Response: `otpPending { id: "otp_123", maskedEmail: "j***@example.com" }`.
4. Tell the user: `Action needed: email verification is required to continue. Code sent to: j***@example.com. Please send me the 6 digit code and I will complete it for you.`
5. User replies with the code.
6. `otp submit otp_123 <code>`. The original transfer finalizes.
7. Report result with the standard `Done:` template, including tx hash.

Wrong sequence (do not do this):

1. See that 2 USD > 1 USD limit.
2. Tell the user "this transaction exceeds your spending limit. You need to raise the limit first. Should I run `security spending-limit 5`?"

The second sequence skips the second factor entirely and forces an unnecessary policy write. It is always wrong unless the user themselves asked to change the policy.

---

## Social recovery

### What it actually is

Social recovery lets the account owner nominate a set of **guardians**, each identified by an address, and a **threshold** number of guardians whose signatures are required to restore access to a wallet if the owner loses their primary signer. It is an alternative to seed phrases: instead of one secret that must never be lost, you distribute trust across people or devices you know.

A typical setup is three guardians with threshold 2. Any two of the three can collectively approve a recovery. No single guardian can act alone, and losing one guardian is survivable.

### The lifecycle

Setup (done by the account owner, on the healthy account):

1. `recovery contacts set 0xAlice,0xBob,0xCarol --threshold 2`. This is an on chain write and needs user approval, like any write.
2. Optionally `recovery backup export --output guardians.json` so the owner has an offline copy of who the guardians are. The backup file is metadata only, it does not contain private keys.

Recovery (done when the owner has lost access and wants to restore):

1. `recovery initiate 0xWalletToRecover --chain <id>`. This returns a `recoveryUrl`.
2. The owner sends the `recoveryUrl` to their guardians out of band (Signal, email, in person).
3. Each guardian opens the URL in the Recovery App at https://recovery.elytro.com/ and signs. The CLI does not handle guardian signing. This is deliberate: guardians should not be required to install a CLI.
4. Once the threshold number of signatures is collected, the recovery enters a **countdown** phase. During the countdown the original owner (if they are actually still in control) can cancel the recovery. This is an anti hijack window. If nobody cancels, the recovery becomes executable and access is restored.
5. `recovery status` at any point shows which phase the recovery is in, how many signatures are collected, and how much countdown remains.

### Phases to know

- `not_initiated`: no active recovery.
- `collecting_signatures`: `initiate` has been called, guardians are signing. Shows signature count over threshold.
- `countdown`: threshold reached, anti hijack delay running.
- `executable`: countdown elapsed, recovery can be finalized.
- `executed`: recovery finalized, new signer is active.
- `cancelled`: the original owner cancelled during countdown.

### What the agent should do

For setup, treat `recovery contacts set` and `recovery contacts clear` as normal write operations that require explicit user approval. Confirm the guardian addresses back to the user before running, because a typo here is almost impossible to fix after the fact.

For initiation, after `recovery initiate` succeeds, the single most important thing is to present the `recoveryUrl` prominently and tell the user to distribute it to their guardians. Do not bury it in a JSON dump. Do not shorten or paraphrase the URL.

For status checks, use `recovery status` and translate the phase into plain language. If the recovery is in `countdown`, tell the user how much time remains and mention that the original owner can still cancel during this window.

### What the agent must not do

Do not try to collect guardian signatures through the CLI. There is no command for this and there is not supposed to be one. Guardian signing lives in the Recovery App.

Do not tell the user that recovery is instant. The countdown phase exists on purpose and its duration is a property of the account, not something the agent can skip.

Do not suggest `recovery contacts clear` as a troubleshooting step. Clearing guardians leaves the account with no recovery path until new guardians are set, which is a serious downgrade in security posture.
