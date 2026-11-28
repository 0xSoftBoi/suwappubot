import { useQuery, type QueryKey, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import { hasBankCredential } from '../../lib/bankAuth'

/**
 * `useQuery` for bank data: stays idle until a bank credential exists (Telegram initData, or local dev),
 * so signed-out visits do not fire doomed 401s before BankShell shows "Open in Telegram".
 */
export function useBankQuery<TQueryFnData = unknown, TError = Error, TData = TQueryFnData, TKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TKey>,
): UseQueryResult<TData, TError> {
  const cred = hasBankCredential()
  const e = options.enabled
  const enabled = typeof e === 'function' ? ((q: never) => cred && (e as (q: never) => boolean)(q)) : cred && (e ?? true)
  return useQuery<TQueryFnData, TError, TData, TKey>({ ...options, enabled } as UseQueryOptions<TQueryFnData, TError, TData, TKey>)
}
