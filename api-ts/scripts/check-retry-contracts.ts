#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RETRY_CONTRACTS, retryContractSummary } from '../src/lib/retryContracts'

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Retry contract violation: ${message}`)
}

const repoRoot = resolve(process.cwd(), '..')
const allowedClasses = new Set([
	'natural-identity',
	'explicit-idempotency-key',
	'durable-operation-id',
	'unsafe-auto-retry',
])

for (const [id, contract] of Object.entries(RETRY_CONTRACTS.operations)) {
	invariant(contract.method.length > 0, `${id} missing method`)
	invariant(contract.path.startsWith('/'), `${id} path must be absolute`)
	invariant(contract.authority.length > 0, `${id} missing authority`)
	invariant(allowedClasses.has(contract.retryClass), `${id} has unknown retry class ${contract.retryClass}`)
	invariant(contract.identitySource.length > 0, `${id} missing identitySource`)
	invariant(contract.sameRequest.length > 0, `${id} missing sameRequest semantics`)
	invariant(contract.conflictingReuse.length > 0, `${id} missing conflictingReuse semantics`)
	invariant(contract.concurrent.length > 0, `${id} missing concurrent semantics`)
	invariant(contract.unknownOutcome.length > 0, `${id} missing unknownOutcome semantics`)
	invariant(contract.reconciliation.length > 0, `${id} missing reconciliation path/instruction`)
	invariant(typeof contract.blocker === 'boolean', `${id} missing blocker classification`)
	invariant(existsSync(resolve(repoRoot, contract.source)), `${id} points to missing source ${contract.source}`)

	if (contract.retryClass === 'unsafe-auto-retry') {
		invariant(contract.blocker, `${id} is unsafe-auto-retry but is not marked as a parity blocker`)
	}
}

// High-risk evidence assertions. These are intentionally narrow and source-based:
// if a critical implementation marker disappears, CI forces a human to re-audit
// the corresponding retry contract rather than leaving stale green metadata.
const agentSource = readFileSync(resolve(repoRoot, 'api-ts/src/routes/agent.ts'), 'utf8')
const predictSource = readFileSync(resolve(repoRoot, 'api-ts/src/routes/predict.ts'), 'utf8')
const publicSwapSource = readFileSync(resolve(repoRoot, 'api-ts/src/routes/publicSwap.ts'), 'utf8')
const paymentSchema = readFileSync(resolve(repoRoot, 'api-ts/src/db/schema/payments.ts'), 'utf8')
const paymentConsumptionSource = readFileSync(resolve(repoRoot, 'api-ts/src/lib/paymentConsumption.ts'), 'utf8')
const terminalSource = readFileSync(resolve(repoRoot, 'api/webapp.py'), 'utf8')

invariant(agentSource.includes("c.req.header('Idempotency-Key')"), 'agent managed swap lost client Idempotency-Key handling')
invariant(agentSource.includes('internalOutcomeUnknown = true'), 'agent managed swap lost explicit unknown-outcome handling')
invariant(paymentSchema.includes("unique('uq_consumed_payments_chain_tx')"), 'global payment replay unique constraint missing')
invariant(agentSource.includes('consumePayment(tx,'), 'agent payment paths no longer call the shared consumed-payments guard')
invariant(paymentConsumptionSource.includes('consumedPayments'), 'shared payment replay helper no longer writes the consumed-payments ledger')
invariant(
	paymentConsumptionSource.includes('.onConflictDoNothing({ target: [consumedPayments.chain, consumedPayments.txHash] })'),
	'shared payment replay helper lost the targeted atomic (chain, txHash) conflict guard',
)

const predictionContract = RETRY_CONTRACTS.operations['agent.prediction.place-order']
invariant(predictionContract?.blocker === true, 'prediction order must remain a blocker until durable operation identity is implemented')
invariant(predictSource.includes("randomBytes(8).toString('hex')"), 'prediction-order salt behavior changed; re-audit retry semantics')
invariant(predictSource.includes('timestamp: String(Date.now())'), 'prediction-order timestamp behavior changed; re-audit retry semantics')

const recurringContract = RETRY_CONTRACTS.operations['agent.billing.recurring']
invariant(recurringContract?.blocker === true, 'recurring registration must remain a blocker until durable uniqueness is implemented')
invariant(!paymentSchema.includes("unique('uq_recurring_subscriptions_permission')"), 'recurring permission uniqueness landed; update retry contract and add concurrency tests')

const publicSwapContract = RETRY_CONTRACTS.operations['public-swap.execute']
invariant(publicSwapContract?.blocker === true, 'public swap optional idempotency must remain a blocker until identity is required/derived')
invariant(publicSwapSource.includes('const { quoteId, idempotencyKey }'), 'public swap retry identity input changed; re-audit')
invariant(publicSwapSource.includes('idempotencyKey,'), 'public swap no longer persists supplied idempotency key')

invariant(terminalSource.includes('idempotency_key=body.quoteId'), 'Terminal managed swap lost quoteId execution identity')
invariant(terminalSource.includes('idempotency_key=f"ext:{tx_hash}"'), 'Terminal external record lost transaction-hash identity')
invariant(terminalSource.includes('jito_api.send_transaction(body.signedTransaction)'), 'Terminal Jito submission identity behavior changed; re-audit')

const summary = retryContractSummary()
invariant(summary.operation_count === Object.keys(RETRY_CONTRACTS.operations).length, 'retry summary operation count drift')
invariant(summary.blocker_count === summary.blockers.length, 'retry summary blocker count drift')

console.log(
	`✓ Retry contracts classified: ${summary.operation_count} operation(s), ${summary.blocker_count} parity blocker(s).`,
)
