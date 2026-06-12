import type { Address } from 'viem';

/**
 * SwapService — LiFi quote proxy via the Elytro backend.
 *
 * Calls the server-side LiFi v1/quote endpoint which returns:
 * - Route details (tool, estimated output, fees, execution time)
 * - A transactionRequest that can be packed into a UserOp
 *
 * The service is stateless and does NOT handle UserOp building or sending —
 * that responsibility stays with the command layer (via the tx pipeline).
 */

// ─── API Base ────────────────────────────────────────────────────────

const SWAP_API_BASES: Record<string, string> = {
  development: 'https://api-dev.soulwallet.io',
  production: 'https://api.soulwallet.io',
};

function getSwapApiBase(): string {
  const env = process.env.ELYTRO_ENV ?? 'production';
  return SWAP_API_BASES[env] ?? SWAP_API_BASES['development'];
}

// ─── Types ───────────────────────────────────────────────────────────

/** Parameters for requesting a swap quote. */
export interface SwapQuoteParams {
  fromChain: number;
  toChain: number;
  fromToken: Address;
  toToken: Address;
  /** Amount in the source token's smallest unit (wei / atomic). */
  fromAmount: string;
  /** Smart account address that holds the source token. */
  fromAddress: Address;
  /** Destination address for the output token (defaults to fromAddress). */
  toAddress?: Address;
  /** Optional slippage as a decimal string, e.g. "0.005" for 0.5%. */
  slippage?: string;
}

/** Token info embedded in the LiFi quote response. */
export interface LiFiTokenInfo {
  address: string;
  chainId: number;
  symbol: string;
  decimals: number;
  name: string;
  priceUSD?: string;
}

/** The transaction request returned by LiFi — what needs to go on-chain. */
export interface LiFiTransactionRequest {
  /** Target contract address (router / bridge). */
  to: string;
  /** Calldata for the swap. */
  data: string;
  /** Native token value to send (hex string). */
  value: string;
  /** Suggested gas limit from LiFi (informational). */
  gasLimit?: string;
  /** Suggested gas price from LiFi (informational; we use our own). */
  gasPrice?: string;
  /** Chain ID the tx should execute on. */
  chainId?: number;
}

/** Parsed quote result returned by getQuote(). */
export interface SwapQuote {
  /** LiFi quote ID for tracing. */
  id: string;
  /** Type of route: "swap", "bridge", or "cross". */
  type: string;
  /** The aggregator/DEX tool used (e.g. "uniswap", "1inch"). */
  tool: string;
  /** Display name of the tool. */
  toolDetails: { key: string; name: string; logoURI?: string };

  // ─── Amounts ─────────────────────────────────────────
  fromToken: LiFiTokenInfo;
  toToken: LiFiTokenInfo;
  /** Source amount in atomic units. */
  fromAmount: string;
  /** Estimated destination amount in atomic units. */
  toAmount: string;
  /** Minimum destination amount accounting for slippage. */
  toAmountMin: string;

  // ─── Costs ───────────────────────────────────────────
  /** Estimated gas cost in USD. */
  gasCostUSD?: string;
  /** Fee costs from the response. */
  feeCosts?: Array<{
    name: string;
    amount: string;
    amountUSD?: string;
    token: LiFiTokenInfo;
  }>;

  // ─── Execution ───────────────────────────────────────
  /** Estimated execution time in seconds. */
  estimatedExecutionSeconds?: number;

  // ─── Transaction ─────────────────────────────────────
  /** The on-chain transaction to execute this swap. */
  transactionRequest: LiFiTransactionRequest;

  /** Raw response preserved for debugging. */
  _raw: Record<string, unknown>;
}

// ─── Service ─────────────────────────────────────────────────────────

export class SwapService {
  /**
   * Fetch a swap/bridge quote from the Elytro LiFi proxy.
   *
   * Throws on HTTP errors or if the response is missing required fields.
   */
  async getQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    const base = getSwapApiBase();
    const url = new URL('/swap/li-fi/v1/quote', base);

    url.searchParams.set('fromChain', String(params.fromChain));
    url.searchParams.set('toChain', String(params.toChain));
    url.searchParams.set('fromToken', params.fromToken);
    url.searchParams.set('toToken', params.toToken);
    url.searchParams.set('fromAmount', params.fromAmount);
    url.searchParams.set('fromAddress', params.fromAddress);
    url.searchParams.set('toAddress', params.toAddress ?? params.fromAddress);

    if (params.slippage) {
      url.searchParams.set('slippage', params.slippage);
    }

    const res = await fetch(url.toString());

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = ((body as Record<string, unknown>).message as string) ?? JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(`Quote request failed (HTTP ${res.status}): ${detail || res.statusText}`);
    }

    const raw = (await res.json()) as Record<string, unknown>;

    // Validate required fields
    if (!raw.transactionRequest) {
      throw new Error('Quote response missing transactionRequest. The route may be unavailable.');
    }

    const txReq = raw.transactionRequest as Record<string, unknown>;
    if (!txReq.to || !txReq.data) {
      throw new Error('Quote transactionRequest is incomplete (missing to or data).');
    }

    const action = (raw.action as Record<string, unknown>) ?? {};
    const estimate = (raw.estimate as Record<string, unknown>) ?? {};
    const toolDetails = (raw.toolDetails as Record<string, unknown>) ?? {
      key: raw.tool ?? 'unknown',
      name: raw.tool ?? 'unknown',
    };

    return {
      id: (raw.id as string) ?? '',
      type: (raw.type as string) ?? 'swap',
      tool: (raw.tool as string) ?? 'unknown',
      toolDetails: {
        key: (toolDetails.key as string) ?? 'unknown',
        name: (toolDetails.name as string) ?? 'unknown',
        logoURI: toolDetails.logoURI as string | undefined,
      },

      fromToken: (action.fromToken as LiFiTokenInfo) ?? parseTokenFallback(raw, 'from'),
      toToken: (action.toToken as LiFiTokenInfo) ?? parseTokenFallback(raw, 'to'),
      fromAmount: String((action.fromAmount as string) ?? params.fromAmount),
      toAmount: String((estimate.toAmount as string) ?? '0'),
      toAmountMin: String((estimate.toAmountMin as string) ?? '0'),

      gasCostUSD: (estimate.gasCosts as Array<Record<string, unknown>>)?.[0]?.amountUSD as
        | string
        | undefined,
      feeCosts: (estimate.feeCosts as SwapQuote['feeCosts']) ?? [],
      estimatedExecutionSeconds: (estimate.executionDuration as number) ?? undefined,

      transactionRequest: {
        to: txReq.to as string,
        data: txReq.data as string,
        value: String(txReq.value ?? '0x0'),
        gasLimit: txReq.gasLimit ? String(txReq.gasLimit) : undefined,
        gasPrice: txReq.gasPrice ? String(txReq.gasPrice) : undefined,
        chainId: txReq.chainId as number | undefined,
      },

      _raw: raw,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseTokenFallback(raw: Record<string, unknown>, direction: 'from' | 'to'): LiFiTokenInfo {
  return {
    address: '',
    chainId: 0,
    symbol: direction === 'from' ? 'SRC' : 'DST',
    decimals: 18,
    name: 'Unknown',
  };
}
