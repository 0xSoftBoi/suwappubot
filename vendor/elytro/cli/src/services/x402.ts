import { isAddress } from 'viem';
import type { Address, Hex } from 'viem';
import type { AccountService } from './account';
import type { KeyringService } from './keyring';
import type { SDKService } from './sdk';
import { encodeTransfer } from '../utils/erc20';
import { hashTransferAuthorizationTypedData, randomAuthorizationNonce } from '../utils/eip3009';
import {
  X402_HEADERS,
  X402_VERSION,
  EXACT_ASSET_TRANSFER_METHODS,
  EXACT_SCHEME,
  normalizeNetworkIdentifier,
  parseCaip2Network,
  toCaip2,
} from '../constants/x402';
import type {
  PaymentRequired,
  PaymentRequirements,
  PaymentPayload,
  ERC7710Payload,
  SettlementResponse,
} from '../types/x402';
import type { DelegationInfo, AccountInfo } from '../types';
import type { DelegationService } from './delegation';
import { getDomainSeparator, getEncoded1271MessageHash, getEncodedSHA } from './securityHook';

export interface HttpRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  account?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface HttpRequestResult {
  type: 'plain' | 'preview' | 'paid' | 'payment_failed';
  initial: {
    status: number;
    body: string;
  };
  final?: {
    status: number;
    body: string;
  };
  payment?: {
    requirement: PaymentRequirements;
    resource: PaymentRequired['resource'];
    method: string;
    delegationId?: string;
    settlement?: SettlementResponse | null;
    authorization?: {
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
    failureReason?: string;
  };
}

export class X402Service {
  private account: AccountService;
  private keyring: KeyringService;
  private sdk: SDKService;
  private delegation: DelegationService;

  constructor(deps: {
    account: AccountService;
    keyring: KeyringService;
    sdk: SDKService;
    delegation: DelegationService;
  }) {
    this.account = deps.account;
    this.keyring = deps.keyring;
    this.sdk = deps.sdk;
    this.delegation = deps.delegation;
  }

  async performRequest(options: HttpRequestOptions): Promise<HttpRequestResult> {
    const init = this.buildRequestInit(options);
    this.logVerbose(options.verbose ?? false, 'Request', {
      url: options.url,
      method: init.method,
      headers:
        init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers,
    });
    const initialResponse = await fetch(options.url, init);
    const initialBody = await initialResponse.text();

    const paymentHeader = initialResponse.headers.get(X402_HEADERS.PAYMENT_REQUIRED);
    const is402 = initialResponse.status === 402;

    // Not a payment response: no 402 status AND no PAYMENT-REQUIRED header.
    if (!is402 && !paymentHeader) {
      this.logVerbose(options.verbose ?? false, 'Response', {
        status: initialResponse.status,
        headers: Object.fromEntries(initialResponse.headers.entries()),
        body: initialBody,
      });
      return {
        type: 'plain',
        initial: {
          status: initialResponse.status,
          body: initialBody,
        },
        final: {
          status: initialResponse.status,
          body: initialBody,
        },
      };
    }

    // Payment required: decode from header (preferred), then body fallback.
    // The header takes precedence because body-based encoding is a legacy v1
    // pattern and some servers return non-JSON bodies alongside the header.
    const paymentRequired = paymentHeader
      ? this.decodePaymentRequired(paymentHeader)
      : is402
        ? this.parsePaymentRequiredFromBody(initialBody)
        : (() => {
            throw new Error(
              `Server returned ${initialResponse.status} with a PAYMENT-REQUIRED header ` +
                'but not a 402 status code. This is ambiguous — refusing to auto-pay.',
            );
          })();

    this.logVerbose(options.verbose ?? false, 'PaymentRequired', {
      source: paymentHeader ? 'header' : 'body',
      payload: paymentRequired,
    });

    const account = this.accountResolve(options.account);
    const requirement = this.selectRequirement(paymentRequired, account.chainId);
    this.ensureRequirementAmount(requirement);
    const transferMethod = this.detectTransferMethod(requirement, account.chainId);

    if (options.dryRun) {
      return {
        type: 'preview',
        initial: {
          status: initialResponse.status,
          body: initialBody,
        },
        payment: {
          requirement,
          resource: paymentRequired.resource,
          method: transferMethod,
        },
      };
    }

    if (transferMethod === EXACT_ASSET_TRANSFER_METHODS.ERC7710) {
      this.ensureOwnerAlignment(account);
      const managerAddress = this.extractDelegationManager(requirement);
      const amountStr = this.ensureRequirementAmount(requirement);
      const delegation = await this.delegation.findForPayment(options.account, {
        manager: managerAddress,
        token: requirement.asset as Address,
        payee: requirement.payTo as Address,
        amount: amountStr,
      });
      const payload = this.buildErc7710PaymentPayload(
        paymentRequired,
        requirement,
        account.address,
        managerAddress,
        delegation,
      );
      const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
      this.logVerbose(
        options.verbose ?? false,
        'PAYMENT-SIGNATURE (erc7710)',
        JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf-8')),
      );
      const finalResponse = await this.sendWithPayment(options, encodedPayload);
      const finalBody = await finalResponse.text();
      const settlementHeader = finalResponse.headers.get(X402_HEADERS.PAYMENT_RESPONSE);
      const settlement = settlementHeader ? this.decodeSettlement(settlementHeader) : null;
      this.logVerbose(options.verbose ?? false, 'Settlement', {
        header: settlementHeader,
        settlement,
      });

      const paid = this.isPaymentSuccessful(finalResponse.status, settlement);

      return {
        type: paid ? 'paid' : 'payment_failed',
        initial: {
          status: initialResponse.status,
          body: initialBody,
        },
        final: {
          status: finalResponse.status,
          body: finalBody,
        },
        payment: {
          requirement,
          resource: paymentRequired.resource,
          method: transferMethod,
          delegationId: delegation.id,
          settlement,
          ...(!paid ? { failureReason: this.extractFailureReason(finalBody) } : {}),
        },
      };
    }

    if (transferMethod === EXACT_ASSET_TRANSFER_METHODS.EIP3009) {
      const isIdempotentRequest = ['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase());
      const maxRetries = isIdempotentRequest ? 9 : 3;
      const retryBaseDelayMs = 500;
      const maxRetryDelayMs = 10_000;

      let lastFailure:
        | {
            status: number;
            body: string;
            settlement: SettlementResponse | null;
            authorization: { validAfter: string; validBefore: string; nonce: Hex };
          }
        | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const { payload, authorization } = await this.buildEip3009PaymentPayload(
          paymentRequired,
          requirement,
          account,
          options.verbose ?? false,
        );
        const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
        this.logVerbose(
          options.verbose ?? false,
          'PAYMENT-SIGNATURE (eip3009)',
          JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf-8')),
        );
        const finalResponse = await this.sendWithPayment(options, encodedPayload);
        const finalBody = await finalResponse.text();
        const settlementHeader = finalResponse.headers.get(X402_HEADERS.PAYMENT_RESPONSE);
        const settlement = settlementHeader ? this.decodeSettlement(settlementHeader) : null;

        const paid = this.isPaymentSuccessful(finalResponse.status, settlement);
        if (paid) {
          return {
            type: 'paid',
            initial: {
              status: initialResponse.status,
              body: initialBody,
            },
            final: {
              status: finalResponse.status,
              body: finalBody,
            },
            payment: {
              requirement,
              resource: paymentRequired.resource,
              method: transferMethod,
              settlement,
              authorization,
            },
          };
        }

        lastFailure = {
          status: finalResponse.status,
          body: finalBody,
          settlement,
          authorization,
        };

        const canRetry =
          attempt < maxRetries &&
          this.isTransientFacilitatorFailure(finalResponse.status, finalBody);
        if (!canRetry) break;

        const delayMs = Math.min(retryBaseDelayMs * 2 ** attempt, maxRetryDelayMs);
        this.logVerbose(options.verbose ?? false, 'Retry', {
          reason: 'Transient facilitator rejection',
          attempt: attempt + 1,
          maxRetries,
          delayMs,
        });
        await this.sleep(delayMs);
      }

      return {
        type: 'payment_failed',
        initial: {
          status: initialResponse.status,
          body: initialBody,
        },
        final: lastFailure
          ? {
              status: lastFailure.status,
              body: lastFailure.body,
            }
          : undefined,
        payment: {
          requirement,
          resource: paymentRequired.resource,
          method: transferMethod,
          settlement: lastFailure?.settlement ?? null,
          authorization: lastFailure?.authorization,
          failureReason: this.extractFailureReason(lastFailure?.body ?? ''),
        },
      };
    }

    throw new Error(`Unsupported transfer method: ${transferMethod}`);
  }

  private buildRequestInit(options: HttpRequestOptions): RequestInit {
    const headers = new Headers();
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }

    const init: RequestInit = {
      method: options.method.toUpperCase(),
      headers,
    };
    if (options.body !== undefined) {
      init.body = options.body;
    }
    return init;
  }

  private async sendWithPayment(
    options: HttpRequestOptions,
    encodedPayload: string,
  ): Promise<Response> {
    const finalHeaders = { ...options.headers, [X402_HEADERS.PAYMENT_SIGNATURE]: encodedPayload };
    return fetch(options.url, {
      method: options.method,
      headers: finalHeaders,
      body: options.body,
    });
  }

  private decodePaymentRequired(header: string): PaymentRequired {
    try {
      return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as PaymentRequired;
    } catch (err) {
      throw new Error(`Failed to decode PAYMENT-REQUIRED header: ${(err as Error).message}`);
    }
  }

  private parsePaymentRequiredFromBody(body: string): PaymentRequired {
    try {
      const parsed = JSON.parse(body) as Partial<PaymentRequired>;
      if (!parsed || !Array.isArray(parsed.accepts)) {
        throw new Error('Body does not contain an accepts array.');
      }
      return parsed as PaymentRequired;
    } catch (err) {
      throw new Error(
        'PAYMENT-REQUIRED header missing and body could not be parsed as PaymentRequired.',
      );
    }
  }

  private decodeSettlement(header: string): SettlementResponse {
    try {
      return JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as SettlementResponse;
    } catch (err) {
      throw new Error(`Failed to decode PAYMENT-RESPONSE header: ${(err as Error).message}`);
    }
  }

  private accountResolve(aliasOrAddress?: string) {
    if (aliasOrAddress) {
      const resolved = this.account.resolveAccount(aliasOrAddress);
      if (!resolved) {
        throw new Error(`Account "${aliasOrAddress}" not found.`);
      }
      return resolved;
    }
    const current = this.account.currentAccount;
    if (!current) {
      throw new Error('No active account. Use `elytro account switch` or pass --account.');
    }
    return current;
  }

  private selectRequirement(
    paymentRequired: PaymentRequired,
    chainId: number,
  ): PaymentRequirements {
    const network = toCaip2(chainId).toLowerCase();
    const matches = paymentRequired.accepts.filter((req) => {
      const normalized = this.safeNormalizeNetwork(req.network);
      return req.scheme === EXACT_SCHEME && normalized === network;
    });

    if (matches.length === 0) {
      throw new Error(
        `No payment option offered for network ${network}. Supported networks: ${paymentRequired.accepts
          .map((req) => req.network)
          .join(', ')}`,
      );
    }

    const preferred = matches.find((req) => this.isErc7710(req)) ?? matches[0];

    if (!isAddress(preferred.asset)) {
      throw new Error(`Payment requirement asset is not a valid address: ${preferred.asset}`);
    }

    if (!isAddress(preferred.payTo.toString())) {
      throw new Error(`Payment requirement payTo is not a valid address: ${preferred.payTo}`);
    }

    return preferred;
  }

  private extractDelegationManager(requirement: PaymentRequirements): Address {
    const extra = requirement.extra ?? {};
    const manager = (extra as Record<string, unknown>).delegationManager;
    if (!manager || typeof manager !== 'string' || !isAddress(manager)) {
      throw new Error('Payment requirement missing valid delegationManager in extra.');
    }
    return manager as Address;
  }

  private detectTransferMethod(requirement: PaymentRequirements, chainId: number): string {
    const extra = (requirement.extra ?? {}) as Record<string, unknown>;
    this.ensureRequirementAmount(requirement);
    const method =
      typeof extra.assetTransferMethod === 'string' ? extra.assetTransferMethod : undefined;
    if (method === EXACT_ASSET_TRANSFER_METHODS.ERC7710) return method;
    if (method === EXACT_ASSET_TRANSFER_METHODS.EIP3009) return method;

    if (!method) {
      const { namespace } = parseCaip2Network(requirement.network);
      if (namespace === 'eip155') {
        return EXACT_ASSET_TRANSFER_METHODS.EIP3009;
      }
    }

    throw new Error(`Unsupported asset transfer method for network ${requirement.network}.`);
  }

  private isErc7710(requirement: PaymentRequirements): boolean {
    const extra = requirement.extra ?? {};
    return (
      (extra as Record<string, unknown>).assetTransferMethod ===
      EXACT_ASSET_TRANSFER_METHODS.ERC7710
    );
  }

  private buildErc7710PaymentPayload(
    paymentRequired: PaymentRequired,
    requirement: PaymentRequirements,
    delegator: Address,
    delegationManager: Address,
    delegation: DelegationInfo,
  ): PaymentPayload<ERC7710Payload> {
    const amountStr = this.ensureRequirementAmount(requirement);
    const amount = BigInt(amountStr);

    const payload: PaymentPayload<ERC7710Payload> = {
      x402Version: X402_VERSION,
      resource: paymentRequired.resource,
      accepted: requirement,
      payload: {
        delegationManager,
        permissionContext: delegation.permissionContext,
        delegator,
        executionCallData: encodeTransfer(requirement.payTo as Address, amount),
      },
    };

    if (paymentRequired.extensions) {
      payload.extensions = paymentRequired.extensions;
    }

    return payload;
  }

  /**
   * Verify that the keyring's active owner matches the account that will be signed for.
   * Catches context synchronization bugs before they produce silent invalid signatures.
   */
  private ensureOwnerAlignment(account: AccountInfo): void {
    const currentOwner = this.keyring.currentOwner;
    if (!currentOwner || currentOwner.toLowerCase() !== account.owner.toLowerCase()) {
      throw new Error(
        `Signing context mismatch: keyring owner is ${currentOwner?.substring(0, 6)}, ` +
          `but account ${account.alias ?? account.address} requires owner ${account.owner.substring(0, 6)}. ` +
          `Context was not synchronized before signing.`,
      );
    }
  }

  private async buildEip3009PaymentPayload(
    paymentRequired: PaymentRequired,
    requirement: PaymentRequirements,
    account: AccountInfo,
    verbose: boolean,
  ): Promise<{
    payload: PaymentPayload<{ signature: Hex; authorization: Record<string, string> }>;
    authorization: { validAfter: string; validBefore: string; nonce: Hex };
  }> {
    this.ensureOwnerAlignment(account);

    const normalizedNetwork = this.safeNormalizeNetwork(requirement.network);
    const { namespace, reference } = parseCaip2Network(normalizedNetwork);
    if (namespace !== 'eip155') {
      throw new Error(`EIP-3009 only supports eip155 networks. Got ${requirement.network}`);
    }

    const chainId = Number(reference);
    const extra = (requirement.extra ?? {}) as Record<string, unknown>;
    const domainName = typeof extra.name === 'string' ? extra.name : undefined;
    const domainVersion = typeof extra.version === 'string' ? extra.version : undefined;
    if (!domainName || !domainVersion) {
      throw new Error(
        'Payment requirement missing EIP-712 domain name/version in extra. ' +
          'The server must supply extra.name and extra.version (e.g. "USD Coin" / "2" for USDC).',
      );
    }
    const domain = {
      name: domainName,
      version: domainVersion,
      chainId,
      verifyingContract: requirement.asset as Address,
    };

    const now = Math.floor(Date.now() / 1000);
    const validAfter = '0'; // now.toString()
    const window = requirement.maxTimeoutSeconds ?? 300;
    const validBefore = (now + window).toString();
    const nonce = randomAuthorizationNonce();
    const amountStr = this.ensureRequirementAmount(requirement);

    const message = {
      from: account.address,
      to: requirement.payTo as Address,
      value: BigInt(amountStr),
      validAfter,
      validBefore,
      nonce,
    };

    const hash = hashTransferAuthorizationTypedData(domain, message);
    this.logVerbose(verbose, 'EIP3009 hash', {
      hash,
      walletAddress: account.address,
      domain,
      message,
    });
    const signature = await this.signTypedDataHash(hash, account.address, chainId, verbose);

    const authorization = {
      from: account.address,
      to: requirement.payTo.toString(),
      value: amountStr,
      validAfter,
      validBefore,
      nonce,
    };

    const payload: PaymentPayload<{ signature: Hex; authorization: Record<string, string> }> = {
      x402Version: X402_VERSION,
      resource: paymentRequired.resource,
      accepted: requirement,
      payload: {
        signature,
        authorization,
      },
    };

    if (paymentRequired.extensions) {
      payload.extensions = paymentRequired.extensions;
    }

    return { payload, authorization: { validAfter, validBefore, nonce } };
  }

  /**
   * ERC-1271 path aligned with Elytro `encodeRawHash` + contract tests: the digest passed to
   * `isValidSignature` is the EIP-3009 typed-data hash; the owner key signs
   * `packRawHash(keccak256(0x19||0x01||domain||hashStruct(ElytroMessage(inner))))`.
   */
  private async signTypedDataHash(
    transferTypedDataHash: Hex,
    walletAddress: Address,
    chainId: number,
    verbose: boolean,
  ): Promise<Hex> {
    const chainIdHex = `0x${chainId.toString(16)}` as Hex;
    const encoded1271Hash = getEncoded1271MessageHash(transferTypedDataHash);
    const domainSeparator = getDomainSeparator(chainIdHex, walletAddress.toLowerCase() as Hex);
    const elytro1271Digest = getEncodedSHA(domainSeparator, encoded1271Hash);

    const { packedHash, validationData } = await this.sdk.packRawHash(elytro1271Digest);
    const rawSignature = await this.keyring.signDigest(packedHash);
    const packed = await this.sdk.packUserOpSignature(rawSignature, validationData);
    this.logVerbose(verbose, 'EIP3009 signature components', {
      transferTypedDataHash,
      encoded1271Hash,
      domainSeparator,
      elytro1271Digest,
      packedHash,
      validationData,
      rawSignature,
      packed,
    });
    return packed;
  }

  /**
   * Determine whether the facilitator accepted the payment.
   *
   * A successful payment means the facilitator returned a non-402 status
   * (typically 200) AND provided a settlement response. If either condition
   * fails, the payment was rejected.
   */
  private isPaymentSuccessful(finalStatus: number, settlement: SettlementResponse | null): boolean {
    if (finalStatus === 402) return false;
    if (settlement && settlement.success === false) return false;
    return true;
  }

  /**
   * Extract a human-readable failure reason from the facilitator's error response.
   */
  private extractFailureReason(body: string): string {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // body is not JSON
    }
    return 'Payment rejected by facilitator';
  }

  private isTransientFacilitatorFailure(finalStatus: number, body: string): boolean {
    if (finalStatus !== 402) return false;
    const normalized = (body ?? '').trim().toLowerCase();
    if (!normalized || normalized === '{}') return true;
    return (
      normalized.includes('facilitator returned 400 bad request with no error') ||
      normalized.includes('facilitator validation failed') ||
      normalized.includes('invalid payment') ||
      normalized.includes('payment rejected by facilitator') ||
      normalized.includes('payment required') ||
      normalized.includes('bad request with no error') ||
      normalized.includes('transaction_simulation') ||
      normalized.includes('simulation_failed')
    );
  }

  private safeNormalizeNetwork(network: string): string {
    try {
      return normalizeNetworkIdentifier(network).toLowerCase();
    } catch {
      return network.toLowerCase();
    }
  }

  private ensureRequirementAmount(requirement: PaymentRequirements): string {
    const amount = requirement.amount ?? requirement.maxAmountRequired;
    if (!amount) {
      throw new Error('Payment requirement missing amount/maxAmountRequired.');
    }
    if (amount === '0') {
      throw new Error('Payment requirement has zero amount.');
    }
    return amount;
  }

  private logVerbose(verbose: boolean, label: string, data: Record<string, unknown>): void {
    if (!verbose) return;
    const safe = JSON.stringify(
      data,
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    console.error(`[x402] ${label}: ${safe}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
