export const X402_VERSION = 2;

export const X402_HEADERS = {
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
} as const;

export const EXACT_ASSET_TRANSFER_METHODS = {
  EIP3009: 'eip3009',
  PERMIT2: 'permit2',
  ERC7710: 'erc7710',
} as const;

export const EXACT_SCHEME = 'exact';

export function toCaip2(chainId: number): string {
  return `eip155:${chainId}`;
}

export function parseCaip2Network(network: string): { namespace: string; reference: string } {
  const normalized = normalizeNetworkIdentifier(network);
  const [namespace, reference] = normalized.split(':', 2);
  if (!namespace || !reference) {
    throw new Error(`Invalid CAIP-2 network identifier: ${network}`);
  }
  return { namespace, reference };
}

const NETWORK_ALIASES: Record<string, string> = {
  base: 'eip155:8453',
  'base-mainnet': 'eip155:8453',
  'base-goerli': 'eip155:84531',
  'base-sepolia': 'eip155:84532',
  polygon: 'eip155:137',
  'polygon-mainnet': 'eip155:137',
  matic: 'eip155:137',
};

export function normalizeNetworkIdentifier(network: string): string {
  const key = network.toLowerCase();
  if (NETWORK_ALIASES[key]) return NETWORK_ALIASES[key];
  if (!network.includes(':')) {
    throw new Error(`Unsupported network identifier "${network}". Expected CAIP-2 (e.g. eip155:8453).`);
  }
  return network;
}
