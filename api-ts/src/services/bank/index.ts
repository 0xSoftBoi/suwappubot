/**
 * Bank service registry. A new module adds ONE import + ONE line in BankLayer.
 */
import { Layer } from 'effect'
import { BankPrivacyServiceLive } from './BankPrivacyService'
import { BankPaymentsChainServiceLive } from './BankPaymentsChainService'
import { BankPaymentNetworkServiceLive } from './BankPaymentNetworkService'
import { BankStablecoinServiceLive } from './BankStablecoinService'
import { BankPartnerServiceLive } from './BankPartnerService'
import { BankAgentPayServiceLive } from './BankAgentPayService'
import { BankCardServiceLive } from './BankCardService'
import { BankFxServiceLive } from './BankFxService'
import { BankRampServiceLive } from './BankRampService'
import { BankRemittanceServiceLive } from './BankRemittanceService'
import { BankEarnServiceLive } from './BankEarnService'
import { BankCreditServiceLive } from './BankCreditService'
import { BankOrgServiceLive } from './BankOrgService'
import { BankApprovalServiceLive } from './BankApprovalService'
import { BankTreasuryServiceLive } from './BankTreasuryService'
import { BankBooksServiceLive } from './BankBooksService'
import { BankPayablesServiceLive } from './BankPayablesService'
import { BankLedgerServiceLive } from './BankLedgerService'
import { BankTransferServiceLive } from './BankTransferService'

export const BankLayer = Layer.mergeAll(
	BankLedgerServiceLive,
	BankTransferServiceLive,
	BankFxServiceLive,
	BankRampServiceLive,
	BankRemittanceServiceLive,
	BankCardServiceLive,
	BankEarnServiceLive,
	BankCreditServiceLive,
	BankOrgServiceLive,
	BankApprovalServiceLive,
	BankTreasuryServiceLive,
	BankBooksServiceLive,
	BankPayablesServiceLive,
	BankAgentPayServiceLive,
	BankPartnerServiceLive,
	BankStablecoinServiceLive,
	BankPaymentNetworkServiceLive,
	BankPaymentsChainServiceLive,
	BankPrivacyServiceLive,
	// <module services register here, one line each>
)

export * from './assets'
export { BankError, bankErr, type BankErrorCode } from './errors'
export { type BankOwner, bankDb, newId } from './db'
export { BankLedgerService } from './BankLedgerService'
export { BankTransferService, type BankDeps } from './BankTransferService'
export { BankFxService } from './BankFxService'
