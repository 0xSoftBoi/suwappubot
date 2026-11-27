import type { Context } from 'hono'
import type { BankError } from '../../services/bank/errors'

/** Shared BankError -> HTTP mapping detail: retryable LOCK_BUSY carries Retry-After (retry with the SAME idempotency key). */
export const setRetryAfter = (c: Context, e: BankError): void => {
	if (e.code === 'LOCK_BUSY') c.header('Retry-After', '2')
}
