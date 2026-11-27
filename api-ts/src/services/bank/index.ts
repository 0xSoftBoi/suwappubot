/**
 * Bank service registry. A new module adds ONE import + ONE line in BankLayer.
 */
import { Layer } from 'effect'
import { BankFxServiceLive } from './BankFxService'
import { BankLedgerServiceLive } from './BankLedgerService'
import { BankTransferServiceLive } from './BankTransferService'

export const BankLayer = Layer.mergeAll(
	BankLedgerServiceLive,
	BankTransferServiceLive,
	BankFxServiceLive,
	// <module services register here, one line each>
)

export * from './assets'
export { BankError, bankErr, type BankErrorCode } from './errors'
export { type BankOwner, bankDb, newId } from './db'
export { BankLedgerService } from './BankLedgerService'
export { BankTransferService, type BankDeps } from './BankTransferService'
export { BankFxService } from './BankFxService'
