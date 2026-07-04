// SuwappuRewardsDistributor — audited external contract (USDC Merkle distributor
// on Base, Uniswap MerkleDistributor claim convention + per-epoch roots).
//
// Leaf:   keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))
// Verify: OpenZeppelin MerkleProof.verify (sorted-pair hashing)
// Claims revert after the epoch's claimDeadline — that deadline is what makes the
// custodial fallback in Python safe from double-pays.
//
// The bot side (Python) publishes roots and reconciles claims; this API only ever
// READS the contract (isClaimed / token), so no signer is configured here.

export const REWARDS_DISTRIBUTOR_ABI = [
	{
		name: 'setEpoch',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'epochId', type: 'uint256' },
			{ name: 'merkleRoot', type: 'bytes32' },
			{ name: 'totalAmount', type: 'uint256' },
			{ name: 'claimDeadline', type: 'uint64' },
		],
		outputs: [],
	},
	{
		name: 'claim',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'epochId', type: 'uint256' },
			{ name: 'index', type: 'uint256' },
			{ name: 'account', type: 'address' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'merkleProof', type: 'bytes32[]' },
		],
		outputs: [],
	},
	{
		name: 'isClaimed',
		type: 'function',
		stateMutability: 'view',
		inputs: [
			{ name: 'epochId', type: 'uint256' },
			{ name: 'index', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		name: 'token',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'address' }],
	},
	{
		name: 'EpochSet',
		type: 'event',
		inputs: [
			{ name: 'epochId', type: 'uint256', indexed: true },
			{ name: 'merkleRoot', type: 'bytes32', indexed: false },
			{ name: 'totalAmount', type: 'uint256', indexed: false },
			{ name: 'claimDeadline', type: 'uint64', indexed: false },
		],
	},
	{
		name: 'Claimed',
		type: 'event',
		inputs: [
			{ name: 'epochId', type: 'uint256', indexed: true },
			{ name: 'index', type: 'uint256', indexed: false },
			{ name: 'account', type: 'address', indexed: true },
			{ name: 'amount', type: 'uint256', indexed: false },
		],
	},
] as const

// Must mirror bot/services/onchain_rewards_service.py exactly.
export const EPOCH_ANCHOR_MS = Date.UTC(2026, 0, 5) // Monday 2026-01-05 00:00 UTC
export const EPOCH_LENGTH_MS = 7 * 24 * 60 * 60 * 1000
export const CASHBACK_RATE = 0.1
export const PAYOUT_TOKEN = 'USDC'
export const PAYOUT_CHAIN = 'base'
export const PAYOUT_CHAIN_ID = 8453

export const currentEpochIndex = (nowMs: number): number =>
	Math.max(0, Math.floor((nowMs - EPOCH_ANCHOR_MS) / EPOCH_LENGTH_MS))

export const epochWindow = (index: number): { startsAt: Date; endsAt: Date } => ({
	startsAt: new Date(EPOCH_ANCHOR_MS + index * EPOCH_LENGTH_MS),
	endsAt: new Date(EPOCH_ANCHOR_MS + (index + 1) * EPOCH_LENGTH_MS),
})
