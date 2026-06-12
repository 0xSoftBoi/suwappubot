import type { Address } from 'viem';

export type PaymentScheme = 'exact';

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: PaymentExtensions;
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirements {
  scheme: PaymentScheme;
  network: string;
  amount?: string;
  /** For x402 v1 payloads that provided a maximum required amount */
  maxAmountRequired?: string;
  asset: string;
  payTo: Address | string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentExtensions {
  [key: string]: {
    info: Record<string, unknown>;
    schema: Record<string, unknown>;
  };
}

export interface PaymentPayload<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: TPayload;
  extensions?: PaymentExtensions;
}

export interface ERC7710Payload extends Record<string, unknown> {
  delegationManager: Address;
  permissionContext: string;
  delegator: Address;
  mode?: string;
  executionCallData?: string;
}

export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: Address | string;
  transaction: string;
  network: string;
  extensions?: PaymentExtensions;
}
