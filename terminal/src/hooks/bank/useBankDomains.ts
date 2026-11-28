import { useQuery } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'

const q = { retry: 1, staleTime: 15_000 } as const

// earn
export const useVaults = (asset: string | undefined, chain: string | undefined) =>
  useQuery({ queryKey: ['bank', 'vaults', asset, chain], queryFn: async () => (await bank.vaults({ asset: asset as string, chain: chain as string })).vaults, enabled: !!asset && !!chain, ...q })
export const useEarnPositions = () => useQuery({ queryKey: ['bank', 'positions'], queryFn: async () => (await bank.positions()).positions, ...q })
export const useEarnSettings = () => useQuery({ queryKey: ['bank', 'earn-settings'], queryFn: async () => (await bank.earnSettings()).settings, ...q })
export const useEarnHistory = () => useQuery({ queryKey: ['bank', 'earn-history'], queryFn: async () => (await bank.earnHistory({ limit: 20 })).operations, ...q })

// credit
export const useCreditMarkets = (chain: string, asset: string) =>
  useQuery({ queryKey: ['bank', 'credit-markets', chain, asset], queryFn: async () => (await bank.creditMarkets({ chain, asset })).markets, ...q })
export const useCreditLines = () => useQuery({ queryKey: ['bank', 'credit-lines'], queryFn: async () => (await bank.creditLines()).lines, refetchInterval: 30_000, ...q })
export const useCreditEvents = () => useQuery({ queryKey: ['bank', 'credit-events'], queryFn: async () => (await bank.creditEvents({ limit: 20 })).events, ...q })
export const useCreditScore = (asset: string, chain: string) =>
  useQuery({ queryKey: ['bank', 'credit-score', asset, chain], queryFn: async () => (await bank.creditScore({ asset, chain })).score, ...q })

// ramps
export const useRails = () => useQuery({ queryKey: ['bank', 'rails'], queryFn: async () => (await bank.rails()).rails, ...q })
export const useProviders = () => useQuery({ queryKey: ['bank', 'providers'], queryFn: async () => (await bank.providers()).providers, ...q })
export const useKyc = (provider: 'bridge' | 'due') => useQuery({ queryKey: ['bank', 'kyc', provider], queryFn: async () => (await bank.kycStatus(provider)).customer, ...q })
export const useExternalAccounts = () => useQuery({ queryKey: ['bank', 'external-accounts'], queryFn: async () => (await bank.externalAccounts()).externalAccounts, ...q })
export const useVirtualAccounts = () => useQuery({ queryKey: ['bank', 'virtual-accounts'], queryFn: async () => (await bank.virtualAccounts()).virtualAccounts, ...q })
export const useRampTransfers = () => useQuery({ queryKey: ['bank', 'ramp-transfers'], queryFn: async () => (await bank.rampTransfers(20)).transfers, ...q })

// remittance
export const useRemittances = () => useQuery({ queryKey: ['bank', 'remittances'], queryFn: async () => await bank.remittances(20), ...q })
export const useClaimPreview = (token: string | undefined) =>
  useQuery({ queryKey: ['bank', 'claim', token], queryFn: async () => (await bank.claimPreview(token as string)).claim, enabled: !!token, retry: 0 })
export const useRemittance = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['bank', 'remittance', id],
    queryFn: async () => (await bank.remittance(id as string)).remittance,
    enabled: !!id,
    refetchInterval: (s) => (['completed', 'failed', 'refunded', 'cancelled', 'expired', 'claimed'].includes(s.state.data?.status ?? '') ? false : 3000),
    retry: 2,
  })

// cards
export const useCards = () => useQuery({ queryKey: ['bank', 'cards'], queryFn: async () => (await bank.cards()).cards, ...q })
export const useCardDetail = (id: string | undefined) => useQuery({ queryKey: ['bank', 'card', id], queryFn: async () => await bank.card(id as string), enabled: !!id, ...q })
export const useCardAuths = (id: string | undefined) => useQuery({ queryKey: ['bank', 'card-auths', id], queryFn: async () => (await bank.cardAuthorizations(id as string)).authorizations, enabled: !!id, ...q })
export const useCardTxs = (id: string | undefined) => useQuery({ queryKey: ['bank', 'card-txs', id], queryFn: async () => (await bank.cardTransactions(id as string)).transactions, enabled: !!id, ...q })

// payments
export const useInvoices = (role: 'payer' | 'payee') => useQuery({ queryKey: ['bank', 'invoices', role], queryFn: async () => (await bank.invoices({ role })).invoices, ...q })
export const useEscrows = () => useQuery({ queryKey: ['bank', 'escrows'], queryFn: async () => (await bank.escrows()).escrows, ...q })
export const useEscrow = (id: string | undefined) => useQuery({ queryKey: ['bank', 'escrow', id], queryFn: () => bank.escrow(id as string), enabled: !!id, ...q })
export const useStreams = () => useQuery({ queryKey: ['bank', 'streams'], queryFn: async () => (await bank.streams()).streams, ...q })

// payroll
export const usePayees = () => useQuery({ queryKey: ['bank', 'payees'], queryFn: async () => (await bank.payees()).payees, ...q })
export const usePayrollRuns = () => useQuery({ queryKey: ['bank', 'payroll-runs'], queryFn: async () => (await bank.payrollRuns()).runs, ...q })
export const usePayrollRun = (id: string | undefined) => useQuery({ queryKey: ['bank', 'payroll-run', id], queryFn: () => bank.previewRun(id as string), enabled: !!id, refetchInterval: (s) => (['executing'].includes(String((s.state.data as { run?: { status?: string } } | undefined)?.run?.status)) ? 3000 : false), ...q })
export const usePayrollSchedules = () => useQuery({ queryKey: ['bank', 'payroll-schedules'], queryFn: async () => (await bank.schedules()).schedules, ...q })

// business
export const useOrgs = () => useQuery({ queryKey: ['bank', 'orgs'], queryFn: () => bank.orgs(), ...q })
export const useOrgData = <T,>(key: string, orgId: string | undefined, fn: (id: string) => Promise<T>) =>
  useQuery({ queryKey: ['bank', 'org', orgId, key], queryFn: () => fn(orgId as string), enabled: !!orgId, ...q })

// agents
export const useMandates = () => useQuery({ queryKey: ['bank', 'mandates'], queryFn: async () => (await bank.mandates()).mandates, ...q })
export const useMyResources = () => useQuery({ queryKey: ['bank', 'resources'], queryFn: async () => (await bank.resources()).resources, ...q })
export const useDirectory = () => useQuery({ queryKey: ['bank', 'directory'], queryFn: async () => (await bank.directory({ limit: 50 })).resources, ...q })

// segments
export const useSegments = () => useQuery({ queryKey: ['bank', 'segments'], queryFn: async () => (await bank.segments()).segments, staleTime: 10 * 60_000, retry: 1 })
export const useFeatures = (accountId: string | undefined) => useQuery({ queryKey: ['bank', 'features', accountId], queryFn: async () => (await bank.features(accountId as string)).effective, enabled: !!accountId, ...q })
