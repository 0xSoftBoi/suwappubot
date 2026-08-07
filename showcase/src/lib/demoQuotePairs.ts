export const DEMO_QUOTE_PAIRS = [
  {
    id: 'usdc-eth-base',
    labelKey: 'baseEth',
    from: 'USDC',
    to: 'ETH',
    chain: 'base',
    toChain: undefined,
    amount: '100',
  },
  {
    id: 'usdc-base-usdt-polygon',
    labelKey: 'basePolygon',
    from: 'USDC',
    to: 'USDT',
    chain: 'base',
    toChain: 'polygon',
    amount: '100',
  },
  {
    id: 'usdc-base-eth-arbitrum',
    labelKey: 'baseArbitrum',
    from: 'USDC',
    to: 'ETH',
    chain: 'base',
    toChain: 'arbitrum',
    amount: '100',
  },
] as const;

export type DemoQuotePairId = (typeof DEMO_QUOTE_PAIRS)[number]['id'];

export function getDemoQuotePair(id: string) {
  return DEMO_QUOTE_PAIRS.find((pair) => pair.id === id);
}
