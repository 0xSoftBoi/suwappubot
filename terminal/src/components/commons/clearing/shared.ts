import { useState } from 'react'
import toast from 'react-hot-toast'
import { useConfig } from 'wagmi'
import { signTypedData } from 'wagmi/actions'
import { createPublicClient, http, type Abi, type Address, type Hex } from 'viem'
import {
  ClearingAction,
  LineStatusV2,
  buildIntent,
  clearingHouseAbi,
  clearingHouseDeployments,
  intentTypedData,
} from '@suwappu/primitives-client'
import { COMMONS, COMMONS_CHAIN } from '../contracts'
import { useCommonsTx } from '../useCommonsTx'

/** Commons v2 · CommonsClearingHouse shared constants, types and helpers. */

export const DEPLOYMENT = clearingHouseDeployments[COMMONS_CHAIN.id]
export const CH = DEPLOYMENT.address
/** Unit of account surfaced in the UI (test mUSD, 18 dp). */
export const TOKEN = COMMONS.reserveAsset
export const CHA = clearingHouseAbi as unknown as Abi
export const ch = { address: CH, abi: clearingHouseAbi, chainId: COMMONS_CHAIN.id } as const

export const STATUS_LABEL: Record<number, string> = {
  [LineStatusV2.None]: 'No line',
  [LineStatusV2.Proposed]: 'Proposed',
  [LineStatusV2.Active]: 'Active',
  [LineStatusV2.Closed]: 'Closed',
  [LineStatusV2.Defaulted]: 'Defaulted',
}

export function statusTone(s?: number) {
  return s === LineStatusV2.Active ? 'up' : s === LineStatusV2.Defaulted ? 'down' : s === LineStatusV2.Proposed ? 'warm' : 'neutral'
}

export type LineV2 = {
  limitLo: bigint
  limitHi: bigint
  balance: bigint
  feeRate: bigint
  grace: bigint
  lastAccrual: bigint
  demandTs: bigint
  demandBy: Address
  status: number
  flags: number
  nonce: number
  proposer: Address
  termsHash: Hex
}

/**
 * Log queries go to publicnode: sepolia.base.org caps eth_getLogs at a 200-block
 * range (measured), which can't cover the contract's history. publicnode serves
 * wide ranges with CORS; we still scan in windows so history keeps fitting.
 * Production belongs behind an indexer.
 */
export const logsClient = createPublicClient({
  chain: COMMONS_CHAIN,
  transport: http('https://base-sepolia-rpc.publicnode.com'),
})
const LOG_WINDOW = 45_000n

export type RawLog = {
  address: Address
  topics: [Hex, ...Hex[]]
  data: Hex
  blockNumber: Hex
  transactionHash: Hex
  logIndex: Hex
}

/** Raw logs for this contract, windowed from the deploy block. `topics` as in eth_getLogs. */
export async function getLogsWindowed(topics?: (Hex | Hex[] | null)[]): Promise<RawLog[]> {
  const head = await logsClient.getBlockNumber()
  const logs: RawLog[] = []
  for (let from = DEPLOYMENT.block; from <= head; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n > head ? head : from + LOG_WINDOW - 1n
    const res = (await logsClient.request({
      method: 'eth_getLogs',
      params: [{ address: CH, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics } as never],
    })) as RawLog[]
    logs.push(...res)
  }
  return logs
}

export type SignedIntent = { label: string; decoded: [string, string][]; json: string }

/** Send as a tx, or (relay mode) sign the equivalent EIP-712 intent and surface it. */
export function useAct(relay: boolean, onSigned: (s: SignedIntent) => void) {
  const { run, busy, address } = useCommonsTx()
  const config = useConfig()
  const act = async (
    label: string,
    action: ClearingAction,
    values: readonly unknown[],
    decoded: [string, string][],
    steps: Parameters<typeof run>[1],
  ): Promise<boolean> => {
    if (!relay) return run(label, steps)
    if (!address) {
      toast.error('Connect a wallet first')
      return false
    }
    try {
      const it = buildIntent(address, action, values)
      const signature = await signTypedData(config, intentTypedData(it, COMMONS_CHAIN.id, CH) as never)
      const json = JSON.stringify(
        { chainId: COMMONS_CHAIN.id, clearingHouse: CH, intent: it, signature },
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      )
      onSigned({ label, decoded, json })
      toast.success(`${label}: intent signed — hand it to any relayer`)
      return true
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      return false
    }
  }
  return { act, run, busy, address }
}
export type Act = ReturnType<typeof useAct>['act']
export type Run = ReturnType<typeof useCommonsTx>['run']

export function useRelayState() {
  const [signed, setSigned] = useState<SignedIntent | null>(null)
  return { signed, setSigned }
}

export const SECONDS_PER_YEAR = 31_536_000

/** Per-second WAD fee → APR fraction (0.05 = 5%). */
export function aprOf(feeRate: bigint): number {
  return (Number(feeRate) / 1e18) * SECONDS_PER_YEAR
}
