/**
 * HACKATHON (ETHGlobal Tokyo 2026) — on-chain evidence for the "Agent Swap
 * Passport" demo. Live Sepolia data (ENS resolution + tx receipts) behind a
 * suwappu.bot/passport UI. Never throws: RPC failure degrades to
 * status:"unknown" per receipt / resolvedAddress:null, not a 500.
 *
 * Cached for 60s in-process — this is read-mostly evidence for a demo page,
 * not a hot path, and Sepolia RPC calls are not free.
 */
import { createPublicClient, http, type PublicClient } from 'viem'
import { sepolia } from 'viem/chains'
import { hackathonEnv } from '../env'
import { resolveAddress } from './ensv2/resolver'
import { logger } from '../../lib/logger'

const ENS_PARENT = 'suwappu-agents.eth'
const ENS_SUBREGISTRY = '0xd617a7918b89c7bac8f85c53e327d034914bd062'
const ENS_SAMPLE_NAME = 'f4c68576.suwappu-agents.eth'
const ENS_SAMPLE_TX = '0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233'
const UNISWAP_HOOK = '0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080'
const UNISWAP_DEPLOY_TX = '0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89'
const UNISWAP_SWAP_TX = '0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32'

export interface EvidenceReceipt {
	status: 'success' | 'reverted' | 'unknown'
	blockNumber: number | null
}

export interface Evidence {
	chainId: 11155111
	ens: {
		parent: string
		subregistry: string
		sample: { name: string; txHash: string; resolvedAddress: string | null }
	}
	uniswap: { hook: string; deployTx: string; swapTx: string }
	receipts: Record<string, EvidenceReceipt>
}

let cached: { at: number; value: Evidence } | null = null
const TTL_MS = 60_000

function rpcClient(): PublicClient {
	const env = hackathonEnv()
	const rpcUrl = env.ENS_SEPOLIA_RPC_URL
	return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}

async function fetchReceipt(client: PublicClient, txHash: string): Promise<EvidenceReceipt> {
	try {
		const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
		return {
			status: receipt.status === 'success' ? 'success' : 'reverted',
			blockNumber: Number(receipt.blockNumber),
		}
	} catch (e) {
		logger.warn('[hackathon] evidence receipt fetch failed for %s: %s', txHash, String(e))
		return { status: 'unknown', blockNumber: null }
	}
}

const STATIC: Omit<Evidence, 'ens'> & { ens: Omit<Evidence['ens'], 'sample'> } = {
	chainId: 11155111,
	ens: { parent: ENS_PARENT, subregistry: ENS_SUBREGISTRY },
	uniswap: { hook: UNISWAP_HOOK, deployTx: UNISWAP_DEPLOY_TX, swapTx: UNISWAP_SWAP_TX },
	receipts: {},
}

export async function getEvidence(): Promise<Evidence> {
	if (cached && Date.now() - cached.at < TTL_MS) return cached.value

	const txHashes = [ENS_SAMPLE_TX, UNISWAP_DEPLOY_TX, UNISWAP_SWAP_TX]
	let resolvedAddress: string | null = null
	const receipts: Record<string, EvidenceReceipt> = {}
	for (const h of txHashes) receipts[h] = { status: 'unknown', blockNumber: null }

	try {
		const client = rpcClient()
		const [addr, receiptResults] = await Promise.all([
			resolveAddress(client, ENS_SAMPLE_NAME).catch(() => null),
			Promise.all(txHashes.map((h) => fetchReceipt(client, h))),
		])
		resolvedAddress = addr
		txHashes.forEach((h, i) => {
			receipts[h] = receiptResults[i] as EvidenceReceipt
		})
	} catch (e) {
		logger.warn('[hackathon] evidence fetch failed, returning unknowns: %s', String(e))
	}

	const value: Evidence = {
		...STATIC,
		ens: { ...STATIC.ens, sample: { name: ENS_SAMPLE_NAME, txHash: ENS_SAMPLE_TX, resolvedAddress } },
		receipts,
	}
	cached = { at: Date.now(), value }
	return value
}
