/**
 * Suwappu Bank namespace — `client.bank.*`, mapped 1:1 to `/v1/agent/bank/*`
 * (api-ts/src/routes/bank/*.ts). Request bodies are camelCase exactly as the
 * API's zod schemas define them; money is minor-unit strings.
 *
 * Money-moving methods REQUIRE an `idempotencyKey` (8-128 chars of
 * `A-Za-z0-9_.:-`). It is sent as both the body field and the
 * `Idempotency-Key` header. Calls that carry a key (and all reads) are retried
 * on 429 and 503 `LOCK_BUSY`, always with the SAME key, honouring
 * `Retry-After` with bounded backoff (see `client.bank.retry`). Calls without
 * a key are never retried automatically. Failures throw `SuwappuBankError`.
 */
import { SuwappuBankError, SuwappuError, type Suwappu } from "./client.js";
import type {
  BankAccount,
  BankAgentAccountArgs,
  BankAgentDirectoryArgs,
  BankAgentPayArgs,
  BankAgentResourceArgs,
  BankAgentStreamArgs,
  BankAgentUsageArgs,
  BankApprovalPolicyArgs,
  BankApprovalRequestArgs,
  BankBillArgs,
  BankBillScheduleArgs,
  BankBooksCategoryArgs,
  BankBooksEntriesArgs,
  BankBooksRangeArgs,
  BankCardBudgetArgs,
  BankCardIssueArgs,
  BankCardListArgs,
  BankCardSimulateArgs,
  BankCreditAmountArgs,
  BankCreditEventsArgs,
  BankCreditMarketsArgs,
  BankCreditOpenLineArgs,
  BankCreditReceivableArgs,
  BankCreditScoreArgs,
  BankCreditUnsecuredArgs,
  BankEarnDepositArgs,
  BankEarnHistoryArgs,
  BankEarnSettingsArgs,
  BankEarnVaultsArgs,
  BankEarnWithdrawArgs,
  BankEnvelope,
  BankEscrowCreateArgs,
  BankFeeModelArgs,
  BankFxExecuteArgs,
  BankFxQuoteArgs,
  BankInvoiceCreateArgs,
  BankInvoiceListArgs,
  BankInvoicePayArgs,
  BankListAssetsArgs,
  BankListTransfersArgs,
  BankMemberPatchArgs,
  BankOpenAccountArgs,
  BankOrgAccountArgs,
  BankOrgCreateArgs,
  BankOrgInviteArgs,
  BankOrgTransferArgs,
  BankOrgUpdateArgs,
  BankPayeeArgs,
  BankPayrollPoolArgs,
  BankPayrollRunArgs,
  BankPayrollScheduleArgs,
  BankPlatformAccountArgs,
  BankPlatformConfigArgs,
  BankPlatformCustomerArgs,
  BankPlatformFxArgs,
  BankPlatformTransferArgs,
  BankPlatformUsageArgs,
  BankPrivacyAnnouncedArgs,
  BankPrivacyAnnouncementsArgs,
  BankPrivacyPayoutArgs,
  BankRampExternalAccountArgs,
  BankRampKycArgs,
  BankRampOfframpArgs,
  BankRampProvider,
  BankRampQuoteArgs,
  BankRampVirtualAccountArgs,
  BankReconcileReport,
  BankRecord,
  BankRemitClaimArgs,
  BankRemitQuoteArgs,
  BankRemitSendArgs,
  BankStatementArgs,
  BankStatementPage,
  BankStreamCreateArgs,
  BankTransfer,
  BankTransferArgs,
  BankTreasuryPolicyArgs,
  BankVendorArgs,
  BankAsset,
} from "./types.js";

/** Bounded retry policy for 429 / 503 LOCK_BUSY. Mutable: `client.bank.retry.maxRetries = 5`. */
export interface BankRetryOptions {
  /** Max additional attempts after the first. Default 3. */
  maxRetries: number;
  /** First backoff when the server sends no Retry-After. Doubles per attempt. Default 500ms. */
  baseDelayMs: number;
  /** Upper bound for any single wait (also caps Retry-After). Default 10000ms. */
  maxDelayMs: number;
}

const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const enc = encodeURIComponent;

type Params = Record<string, string | number | boolean | undefined>;
function qs(p?: Params): Record<string, string | undefined> | undefined {
  if (!p) return undefined;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(p)) out[k] = v === undefined ? undefined : String(v);
  return out;
}

export class BankNamespace {
  readonly retry: BankRetryOptions = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10_000 };

  readonly accounts: BankAccountsNamespace;
  readonly transfers: BankTransfersNamespace;
  readonly assets: BankAssetsNamespace;
  readonly fx: BankFxNamespace;
  readonly earn: BankEarnNamespace;
  readonly credit: BankCreditNamespace;
  readonly ramps: BankRampsNamespace;
  readonly remittance: BankRemittanceNamespace;
  readonly cards: BankCardsNamespace;
  readonly payments: BankPaymentsNamespace;
  readonly payroll: BankPayrollNamespace;
  readonly business: BankBusinessNamespace;
  readonly agents: BankAgentsNamespace;
  readonly platform: BankPlatformNamespace;
  readonly chains: BankChainsNamespace;
  readonly privacy: BankPrivacyNamespace;
  readonly segments: BankSegmentsNamespace;
  readonly ops: BankOpsNamespace;

  constructor(private readonly c: Suwappu) {
    this.accounts = new BankAccountsNamespace(this);
    this.transfers = new BankTransfersNamespace(this);
    this.assets = new BankAssetsNamespace(this);
    this.fx = new BankFxNamespace(this);
    this.earn = new BankEarnNamespace(this);
    this.credit = new BankCreditNamespace(this);
    this.ramps = new BankRampsNamespace(this);
    this.remittance = new BankRemittanceNamespace(this);
    this.cards = new BankCardsNamespace(this);
    this.payments = new BankPaymentsNamespace(this);
    this.payroll = new BankPayrollNamespace(this);
    this.business = new BankBusinessNamespace(this);
    this.agents = new BankAgentsNamespace(this);
    this.platform = new BankPlatformNamespace(this);
    this.chains = new BankChainsNamespace(this);
    this.privacy = new BankPrivacyNamespace(this);
    this.segments = new BankSegmentsNamespace(this);
    this.ops = new BankOpsNamespace(this);
  }

  /** @internal Throws TypeError unless `key` is a valid idempotency key. */
  _key(key: string | undefined): string {
    if (typeof key !== "string" || !IDEM_RE.test(key)) {
      throw new TypeError("idempotencyKey is required: 8-128 chars of A-Za-z0-9_.:-");
    }
    return key;
  }

  /**
   * @internal Bank request helper: bank-typed errors + bounded retry. Retries
   * only reads and calls that carry an idempotency key, with the same key.
   */
  async _call<T>(
    method: string,
    path: string,
    o: { params?: Params; json?: unknown; idempotencyKey?: string } = {},
  ): Promise<BankEnvelope<T>> {
    const headers = o.idempotencyKey ? { "Idempotency-Key": o.idempotencyKey } : undefined;
    const safeToRetry = method === "GET" || !!o.idempotencyKey;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.c._request<BankEnvelope<T>>(method, `/v1/agent/bank${path}`, {
          params: qs(o.params),
          json: o.json,
          headers,
        });
      } catch (e) {
        if (!(e instanceof SuwappuError)) throw e;
        const err = toBankError(e);
        if (!safeToRetry || !err.retryable || attempt >= this.retry.maxRetries) throw err;
        const backoff = err.retryAfter !== undefined ? err.retryAfter * 1000 : this.retry.baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, Math.min(backoff, this.retry.maxDelayMs)));
      }
    }
  }
}

function toBankError(e: SuwappuError): SuwappuBankError {
  if (e instanceof SuwappuBankError) return e;
  let detail = e.body;
  let missing: string | undefined;
  try {
    const p = JSON.parse(e.body);
    if (p && typeof p.message === "string") detail = p.message;
    if (p && typeof p.missing === "string") missing = p.missing;
  } catch {
    // non-JSON body
  }
  return new SuwappuBankError(e, detail, missing);
}

class Sub {
  constructor(protected readonly b: BankNamespace) {}
}

// ---------------------------------------------------------------- accounts
class BankAccountsNamespace extends Sub {
  /** POST /accounts */
  open(args: BankOpenAccountArgs) { return this.b._call<{ account: BankAccount }>("POST", "/accounts", { json: args }); }
  /** GET /accounts */
  list() { return this.b._call<{ accounts: BankAccount[] }>("GET", "/accounts"); }
  /** GET /accounts/:id */
  get(id: string) { return this.b._call<{ account: BankAccount }>("GET", `/accounts/${enc(id)}`); }
  /** GET /accounts/:id/statement */
  statement(id: string, args: BankStatementArgs = {}) {
    return this.b._call<BankStatementPage>("GET", `/accounts/${enc(id)}/statement`, { params: { limit: args.limit, cursor: args.cursor } });
  }
  /** GET /accounts/:id/reconcile */
  reconcile(id: string) { return this.b._call<BankReconcileReport>("GET", `/accounts/${enc(id)}/reconcile`); }
}

// --------------------------------------------------------------- transfers
class BankTransfersNamespace extends Sub {
  /** POST /transfers — `idempotencyKey` REQUIRED. */
  create(args: BankTransferArgs) {
    return this.b._call<{ transfer: BankTransfer }>("POST", "/transfers", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /transfers/:id */
  get(id: string) { return this.b._call<{ transfer: BankTransfer }>("GET", `/transfers/${enc(id)}`); }
  /** GET /transfers */
  list(args: BankListTransfersArgs = {}) { return this.b._call<{ transfers: BankTransfer[] }>("GET", "/transfers", { params: { ...args } }); }
}

class BankAssetsNamespace extends Sub {
  /** GET /assets */
  list(args: BankListAssetsArgs = {}) { return this.b._call<{ assets: BankAsset[] }>("GET", "/assets", { params: { ...args } }); }
}

// ---------------------------------------------------------------------- fx
class BankFxNamespace extends Sub {
  /** POST /fx/quote */
  quote(args: BankFxQuoteArgs) { return this.b._call<BankRecord>("POST", "/fx/quote", { json: args }); }
  /** POST /fx/execute — `idempotencyKey` REQUIRED. */
  execute(args: BankFxExecuteArgs) {
    return this.b._call<BankRecord>("POST", "/fx/execute", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
}

// -------------------------------------------------------------------- earn
class BankEarnNamespace extends Sub {
  /** GET /earn/vaults */
  vaults(args: BankEarnVaultsArgs) { return this.b._call<BankRecord>("GET", "/earn/vaults", { params: { ...args } }); }
  /** GET /earn/positions */
  positions() { return this.b._call<BankRecord>("GET", "/earn/positions"); }
  /** GET /earn/history */
  history(args: BankEarnHistoryArgs = {}) { return this.b._call<BankRecord>("GET", "/earn/history", { params: { ...args } }); }
  /** POST /earn/deposit — `idempotencyKey` REQUIRED. */
  deposit(args: BankEarnDepositArgs) {
    return this.b._call<BankRecord>("POST", "/earn/deposit", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /earn/withdraw — `idempotencyKey` REQUIRED. */
  withdraw(args: BankEarnWithdrawArgs) {
    return this.b._call<BankRecord>("POST", "/earn/withdraw", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /earn/settings */
  settings() { return this.b._call<BankRecord>("GET", "/earn/settings"); }
  /** PUT /earn/settings (auto-sweep settings; no idempotency key on this route) */
  setSettings(args: BankEarnSettingsArgs) { return this.b._call<BankRecord>("PUT", "/earn/settings", { json: args }); }
}

// ------------------------------------------------------------------ credit
class BankCreditNamespace extends Sub {
  /** GET /credit/markets */
  markets(args: BankCreditMarketsArgs = {}) { return this.b._call<BankRecord>("GET", "/credit/markets", { params: { ...args } }); }
  /** GET /credit/lines */
  lines() { return this.b._call<BankRecord>("GET", "/credit/lines"); }
  /** GET /credit/lines/:id */
  line(id: string) { return this.b._call<BankRecord>("GET", `/credit/lines/${enc(id)}`); }
  /** POST /credit/lines — `idempotencyKey` REQUIRED. */
  openLine(args: BankCreditOpenLineArgs) {
    return this.b._call<BankRecord>("POST", "/credit/lines", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /credit/draw — `idempotencyKey` REQUIRED. */
  draw(args: BankCreditAmountArgs) {
    return this.b._call<BankRecord>("POST", "/credit/draw", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /credit/repay — `idempotencyKey` REQUIRED. */
  repay(args: BankCreditAmountArgs) {
    return this.b._call<BankRecord>("POST", "/credit/repay", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /credit/withdraw-collateral — `idempotencyKey` REQUIRED. */
  withdrawCollateral(args: BankCreditAmountArgs) {
    return this.b._call<BankRecord>("POST", "/credit/withdraw-collateral", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /credit/events */
  events(args: BankCreditEventsArgs = {}) { return this.b._call<BankRecord>("GET", "/credit/events", { params: { ...args } }); }
  /** GET /credit/refunds/pending */
  refundsPending() { return this.b._call<BankRecord>("GET", "/credit/refunds/pending"); }
  /** GET /credit/score */
  score(args: BankCreditScoreArgs = {}) { return this.b._call<BankRecord>("GET", "/credit/score", { params: { ...args } }); }
  /** POST /credit/unsecured — `idempotencyKey` REQUIRED. */
  unsecured(args: BankCreditUnsecuredArgs) {
    return this.b._call<BankRecord>("POST", "/credit/unsecured", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /credit/receivables/accept — `idempotencyKey` REQUIRED. */
  receivablesAccept(args: BankCreditReceivableArgs) {
    return this.b._call<BankRecord>("POST", "/credit/receivables/accept", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /credit/receivables/finance — `idempotencyKey` REQUIRED. */
  receivablesFinance(args: BankCreditReceivableArgs) {
    return this.b._call<BankRecord>("POST", "/credit/receivables/finance", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
}

// ------------------------------------------------------------------- ramps
class BankRampsNamespace extends Sub {
  /** GET /ramps/rails */
  rails() { return this.b._call<BankRecord>("GET", "/ramps/rails"); }
  /** GET /ramps/providers */
  providers() { return this.b._call<BankRecord>("GET", "/ramps/providers"); }
  /** POST /ramps/quote */
  quote(args: BankRampQuoteArgs) { return this.b._call<BankRecord>("POST", "/ramps/quote", { json: args }); }
  /** POST /ramps/kyc */
  kyc(args: BankRampKycArgs) { return this.b._call<BankRecord>("POST", "/ramps/kyc", { json: args }); }
  /** GET /ramps/kyc/:provider */
  kycStatus(provider: BankRampProvider) { return this.b._call<BankRecord>("GET", `/ramps/kyc/${enc(provider)}`); }
  /** POST /ramps/external-accounts */
  createExternalAccount(args: BankRampExternalAccountArgs) { return this.b._call<BankRecord>("POST", "/ramps/external-accounts", { json: args }); }
  /** GET /ramps/external-accounts */
  listExternalAccounts() { return this.b._call<BankRecord>("GET", "/ramps/external-accounts"); }
  /** POST /ramps/virtual-accounts */
  createVirtualAccount(args: BankRampVirtualAccountArgs) { return this.b._call<BankRecord>("POST", "/ramps/virtual-accounts", { json: args }); }
  /** GET /ramps/virtual-accounts */
  listVirtualAccounts() { return this.b._call<BankRecord>("GET", "/ramps/virtual-accounts"); }
  /** POST /ramps/offramp — `idempotencyKey` REQUIRED. */
  offramp(args: BankRampOfframpArgs) {
    return this.b._call<BankRecord>("POST", "/ramps/offramp", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /ramps/transfers */
  listTransfers(args: { limit?: number } = {}) { return this.b._call<BankRecord>("GET", "/ramps/transfers", { params: { ...args } }); }
  /** GET /ramps/transfers/:id */
  getTransfer(id: string) { return this.b._call<BankRecord>("GET", `/ramps/transfers/${enc(id)}`); }
}

// -------------------------------------------------------------- remittance
class BankRemittanceNamespace extends Sub {
  /** POST /remittance/quote */
  quote(args: BankRemitQuoteArgs) { return this.b._call<BankRecord>("POST", "/remittance/quote", { json: args }); }
  /** POST /remittance/send — `idempotencyKey` REQUIRED. */
  send(args: BankRemitSendArgs) {
    return this.b._call<BankRecord>("POST", "/remittance/send", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /remittance/claim/:token */
  claimPreview(token: string) { return this.b._call<BankRecord>("GET", `/remittance/claim/${enc(token)}`); }
  /** POST /remittance/claim/:token */
  claim(token: string, args: BankRemitClaimArgs = {}) { return this.b._call<BankRecord>("POST", `/remittance/claim/${enc(token)}`, { json: args }); }
  /** POST /remittance/:id/cancel */
  cancel(id: string) { return this.b._call<BankRecord>("POST", `/remittance/${enc(id)}/cancel`); }
  /** GET /remittance */
  list(args: { limit?: number } = {}) { return this.b._call<BankRecord>("GET", "/remittance", { params: { ...args } }); }
  /** GET /remittance/:id */
  get(id: string) { return this.b._call<BankRecord>("GET", `/remittance/${enc(id)}`); }
  /** GET /remittance/identity */
  identity() { return this.b._call<BankRecord>("GET", "/remittance/identity"); }
  /** GET /remittance/corridors */
  corridors() { return this.b._call<BankRecord>("GET", "/remittance/corridors"); }
}

// ------------------------------------------------------------------- cards
class BankCardsNamespace extends Sub {
  /** POST /cards — `idempotencyKey` REQUIRED. */
  issue(args: BankCardIssueArgs) {
    return this.b._call<BankRecord>("POST", "/cards", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /cards */
  list(args: BankCardListArgs = {}) { return this.b._call<BankRecord>("GET", "/cards", { params: { ...args } }); }
  /** GET /cards/:id */
  get(id: string) { return this.b._call<BankRecord>("GET", `/cards/${enc(id)}`); }
  /** GET /cards/reveal-config */
  revealConfig(args: { provider?: "stripe" | "rain" } = {}) { return this.b._call<BankRecord>("GET", "/cards/reveal-config", { params: { ...args } }); }
  /** POST /cards/:id/freeze */
  freeze(id: string) { return this.b._call<BankRecord>("POST", `/cards/${enc(id)}/freeze`); }
  /** POST /cards/:id/unfreeze */
  unfreeze(id: string) { return this.b._call<BankRecord>("POST", `/cards/${enc(id)}/unfreeze`); }
  /** POST /cards/:id/cancel */
  cancel(id: string) { return this.b._call<BankRecord>("POST", `/cards/${enc(id)}/cancel`); }
  /** PUT /cards/:id/rules */
  setRules(id: string, rules: Record<string, unknown>) { return this.b._call<BankRecord>("PUT", `/cards/${enc(id)}/rules`, { json: { rules } }); }
  /** POST /cards/:id/simulate — dry-run an authorization against the card's rules. */
  simulate(id: string, args: BankCardSimulateArgs) { return this.b._call<BankRecord>("POST", `/cards/${enc(id)}/simulate`, { json: args }); }
  /** GET /cards/:id/transactions */
  transactions(id: string, args: { limit?: number } = {}) { return this.b._call<BankRecord>("GET", `/cards/${enc(id)}/transactions`, { params: { ...args } }); }
  /** GET /cards/:id/authorizations */
  authorizations(id: string, args: { limit?: number } = {}) { return this.b._call<BankRecord>("GET", `/cards/${enc(id)}/authorizations`, { params: { ...args } }); }
}

// ---------------------------------------------------------------- payments
class BankInvoicesNamespace extends Sub {
  /** POST /payments/invoices */
  create(args: BankInvoiceCreateArgs) {
    return this.b._call<BankRecord>("POST", "/payments/invoices", { json: args, idempotencyKey: args.idempotencyKey === undefined ? undefined : this.b._key(args.idempotencyKey) });
  }
  /** GET /payments/invoices */
  list(args: BankInvoiceListArgs = {}) { return this.b._call<BankRecord>("GET", "/payments/invoices", { params: { ...args } }); }
  /** GET /payments/invoices/:id */
  get(id: string) { return this.b._call<BankRecord>("GET", `/payments/invoices/${enc(id)}`); }
  /** POST /payments/invoices/pay — `idempotencyKey` REQUIRED. */
  pay(args: BankInvoicePayArgs) {
    return this.b._call<BankRecord>("POST", "/payments/invoices/pay", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /payments/invoices/:id/publish */
  publish(id: string) { return this.b._call<BankRecord>("POST", `/payments/invoices/${enc(id)}/publish`); }
  /** POST /payments/invoices/:id/accept */
  accept(id: string) { return this.b._call<BankRecord>("POST", `/payments/invoices/${enc(id)}/accept`); }
  /** POST /payments/invoices/:id/void */
  void(id: string) { return this.b._call<BankRecord>("POST", `/payments/invoices/${enc(id)}/void`); }
  /** GET /payments/request/parse (EIP-681 payment request URI) */
  parseRequest(uri: string) { return this.b._call<BankRecord>("GET", "/payments/request/parse", { params: { uri } }); }
}

class BankEscrowsNamespace extends Sub {
  /** POST /escrows — `idempotencyKey` REQUIRED. */
  create(args: BankEscrowCreateArgs) {
    return this.b._call<BankRecord>("POST", "/escrows", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /escrows */
  list(args: { role?: "payer" | "payee" | "arbiter" } = {}) { return this.b._call<BankRecord>("GET", "/escrows", { params: { ...args } }); }
  /** GET /escrows/:id */
  get(id: string) { return this.b._call<BankRecord>("GET", `/escrows/${enc(id)}`); }
  /** POST /escrows/:id/milestones/:seq/deliver */
  deliver(id: string, seq: number, proof: string) { return this.b._call<BankRecord>("POST", `/escrows/${enc(id)}/milestones/${seq}/deliver`, { json: { proof } }); }
  /** POST /escrows/:id/milestones/:seq/confirm */
  confirm(id: string, seq: number) { return this.b._call<BankRecord>("POST", `/escrows/${enc(id)}/milestones/${seq}/confirm`); }
  /** POST /escrows/:id/milestones/:seq/dispute */
  dispute(id: string, seq: number, reason: string) { return this.b._call<BankRecord>("POST", `/escrows/${enc(id)}/milestones/${seq}/dispute`, { json: { reason } }); }
  /** POST /escrows/:id/milestones/:seq/resolve (arbiter) */
  resolve(id: string, seq: number, args: { releaseMinor: string; note?: string }) { return this.b._call<BankRecord>("POST", `/escrows/${enc(id)}/milestones/${seq}/resolve`, { json: args }); }
  /** POST /escrows/:id/milestones/:seq/refund */
  refund(id: string, seq: number) { return this.b._call<BankRecord>("POST", `/escrows/${enc(id)}/milestones/${seq}/refund`); }
}

class BankStreamsNamespace extends Sub {
  /** POST /streams — `idempotencyKey` REQUIRED. */
  create(args: BankStreamCreateArgs) {
    return this.b._call<BankRecord>("POST", "/streams", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /streams */
  list(args: { role?: "payer" | "payee" } = {}) { return this.b._call<BankRecord>("GET", "/streams", { params: { ...args } }); }
  /** GET /streams/:id */
  get(id: string) { return this.b._call<BankRecord>("GET", `/streams/${enc(id)}`); }
  /** POST /streams/:id/pause */
  pause(id: string) { return this.b._call<BankRecord>("POST", `/streams/${enc(id)}/pause`); }
  /** POST /streams/:id/resume */
  resume(id: string) { return this.b._call<BankRecord>("POST", `/streams/${enc(id)}/resume`); }
  /** POST /streams/:id/cancel */
  cancel(id: string) { return this.b._call<BankRecord>("POST", `/streams/${enc(id)}/cancel`); }
  /** POST /streams/:id/settle */
  settle(id: string) { return this.b._call<BankRecord>("POST", `/streams/${enc(id)}/settle`); }
  /** POST /streams/:id/usage — `idempotencyKey` REQUIRED. */
  reportUsage(id: string, args: { units: string; idempotencyKey: string }) {
    return this.b._call<BankRecord>("POST", `/streams/${enc(id)}/usage`, { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
}

class BankPaymentsNamespace {
  readonly invoices: BankInvoicesNamespace;
  readonly escrows: BankEscrowsNamespace;
  readonly streams: BankStreamsNamespace;
  constructor(b: BankNamespace) {
    this.invoices = new BankInvoicesNamespace(b);
    this.escrows = new BankEscrowsNamespace(b);
    this.streams = new BankStreamsNamespace(b);
  }
}

// ----------------------------------------------------------------- payroll
class BankPayrollNamespace extends Sub {
  /** POST /payroll/payees */
  createPayee(args: BankPayeeArgs) { return this.b._call<BankRecord>("POST", "/payroll/payees", { json: args }); }
  /** GET /payroll/payees */
  listPayees() { return this.b._call<BankRecord>("GET", "/payroll/payees"); }
  /** POST /payroll/payees/:id/archive */
  archivePayee(id: string) { return this.b._call<BankRecord>("POST", `/payroll/payees/${enc(id)}/archive`); }
  /** POST /payroll/runs */
  createRun(args: BankPayrollRunArgs) { return this.b._call<BankRecord>("POST", "/payroll/runs", { json: args }); }
  /** GET /payroll/runs */
  listRuns() { return this.b._call<BankRecord>("GET", "/payroll/runs"); }
  /** GET /payroll/runs/:id */
  getRun(id: string) { return this.b._call<BankRecord>("GET", `/payroll/runs/${enc(id)}`); }
  /** POST /payroll/runs/:id/approve */
  approveRun(id: string) { return this.b._call<BankRecord>("POST", `/payroll/runs/${enc(id)}/approve`); }
  /** POST /payroll/runs/:id/execute */
  executeRun(id: string) { return this.b._call<BankRecord>("POST", `/payroll/runs/${enc(id)}/execute`); }
  /** POST /payroll/runs/:id/retry */
  retryRun(id: string) { return this.b._call<BankRecord>("POST", `/payroll/runs/${enc(id)}/retry`); }
  /** GET /payroll/runs/:id/receipts */
  runReceipts(id: string) { return this.b._call<BankRecord>("GET", `/payroll/runs/${enc(id)}/receipts`); }
  /** GET /payroll/my-payouts */
  myPayouts() { return this.b._call<BankRecord>("GET", "/payroll/my-payouts"); }
  /** POST /payroll/schedules */
  createSchedule(args: BankPayrollScheduleArgs) { return this.b._call<BankRecord>("POST", "/payroll/schedules", { json: args }); }
  /** GET /payroll/schedules */
  listSchedules() { return this.b._call<BankRecord>("GET", "/payroll/schedules"); }
  /** POST /payroll/schedules/:id/status */
  setScheduleStatus(id: string, status: "active" | "paused" | "cancelled") { return this.b._call<BankRecord>("POST", `/payroll/schedules/${enc(id)}/status`, { json: { status } }); }
  /** POST /payroll/pools */
  createPool(args: BankPayrollPoolArgs = {}) { return this.b._call<BankRecord>("POST", "/payroll/pools", { json: args }); }
  /** GET /payroll/pools */
  listPools() { return this.b._call<BankRecord>("GET", "/payroll/pools"); }
  /** GET /payroll/pools/receivables */
  poolReceivables(args: { role?: "payer" | "operator"; poolId?: string } = {}) { return this.b._call<BankRecord>("GET", "/payroll/pools/receivables", { params: { ...args } }); }
  /** GET /payroll/pools/:id */
  getPool(id: string) { return this.b._call<BankRecord>("GET", `/payroll/pools/${enc(id)}`); }
  /** POST /payroll/pools/:id/limits */
  setPoolPayerLimit(id: string, args: { payer: import("./types.js").BankOwnerRef; limitMinor: string }) { return this.b._call<BankRecord>("POST", `/payroll/pools/${enc(id)}/limits`, { json: args }); }
}

// ---------------------------------------------------------------- business
class BankOrgsNamespace extends Sub {
  /** POST /orgs */
  create(args: BankOrgCreateArgs) { return this.b._call<BankRecord>("POST", "/orgs", { json: args }); }
  /** GET /orgs */
  list() { return this.b._call<BankRecord>("GET", "/orgs"); }
  /** GET /orgs/:orgId */
  get(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}`); }
  /** PATCH /orgs/:orgId */
  update(orgId: string, args: BankOrgUpdateArgs) { return this.b._call<BankRecord>("PATCH", `/orgs/${enc(orgId)}`, { json: args }); }
  /** GET /orgs/:orgId/audit */
  audit(orgId: string, args: { limit?: number } = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/audit`, { params: { ...args } }); }
  /** POST /org-invites/accept */
  acceptInvite(token: string) { return this.b._call<BankRecord>("POST", "/org-invites/accept", { json: { token } }); }
  /** GET /orgs/:orgId/accounts */
  listAccounts(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/accounts`); }
  /** POST /orgs/:orgId/accounts */
  openAccount(orgId: string, args: BankOrgAccountArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/accounts`, { json: args }); }
  /** POST /orgs/:orgId/transfers — `idempotencyKey` REQUIRED; approval policies apply. */
  transfer(orgId: string, args: BankOrgTransferArgs) {
    return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/transfers`, { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /orgs/:orgId/card-budgets */
  listCardBudgets(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/card-budgets`); }
  /** PUT /orgs/:orgId/card-budgets */
  setCardBudget(orgId: string, args: BankCardBudgetArgs) { return this.b._call<BankRecord>("PUT", `/orgs/${enc(orgId)}/card-budgets`, { json: args }); }
}

class BankMembersNamespace extends Sub {
  /** GET /orgs/:orgId/members */
  list(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/members`); }
  /** PATCH /orgs/:orgId/members/:userId */
  update(orgId: string, userId: number, args: BankMemberPatchArgs) { return this.b._call<BankRecord>("PATCH", `/orgs/${enc(orgId)}/members/${userId}`, { json: args }); }
  /** DELETE /orgs/:orgId/members/:userId */
  remove(orgId: string, userId: number) { return this.b._call<BankRecord>("DELETE", `/orgs/${enc(orgId)}/members/${userId}`); }
  /** POST /orgs/:orgId/invites */
  invite(orgId: string, args: BankOrgInviteArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/invites`, { json: args }); }
  /** DELETE /orgs/:orgId/invites/:inviteId */
  revokeInvite(orgId: string, inviteId: string) { return this.b._call<BankRecord>("DELETE", `/orgs/${enc(orgId)}/invites/${enc(inviteId)}`); }
}

class BankApprovalsNamespace extends Sub {
  /** GET /orgs/:orgId/approval-policies */
  listPolicies(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/approval-policies`); }
  /** POST /orgs/:orgId/approval-policies */
  createPolicy(orgId: string, args: BankApprovalPolicyArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/approval-policies`, { json: args }); }
  /** DELETE /orgs/:orgId/approval-policies/:policyId */
  deletePolicy(orgId: string, policyId: string) { return this.b._call<BankRecord>("DELETE", `/orgs/${enc(orgId)}/approval-policies/${enc(policyId)}`); }
  /** GET /orgs/:orgId/approval-requests */
  listRequests(orgId: string, args: { status?: string } = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/approval-requests`, { params: { ...args } }); }
  /** POST /orgs/:orgId/approval-requests */
  request(orgId: string, args: BankApprovalRequestArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/approval-requests`, { json: args }); }
  /** POST /approval-requests/:id/approve */
  approve(id: string, args: { comment?: string } = {}) { return this.b._call<BankRecord>("POST", `/approval-requests/${enc(id)}/approve`, { json: args }); }
  /** POST /approval-requests/:id/reject */
  reject(id: string, args: { comment?: string } = {}) { return this.b._call<BankRecord>("POST", `/approval-requests/${enc(id)}/reject`, { json: args }); }
  /** POST /approval-requests/:id/token */
  issueToken(id: string) { return this.b._call<BankRecord>("POST", `/approval-requests/${enc(id)}/token`); }
  /** POST /approval-requests/:id/cancel */
  cancel(id: string) { return this.b._call<BankRecord>("POST", `/approval-requests/${enc(id)}/cancel`); }
}

class BankTreasuryNamespace extends Sub {
  /** GET /orgs/:orgId/treasury */
  consolidated(orgId: string, args: { reconcile?: boolean } = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/treasury`, { params: { reconcile: args.reconcile } }); }
  /** GET /orgs/:orgId/treasury/runway */
  runway(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/treasury/runway`); }
  /** GET /orgs/:orgId/treasury/fx-exposure */
  fxExposure(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/treasury/fx-exposure`); }
  /** GET /orgs/:orgId/treasury/policies */
  listPolicies(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/treasury/policies`); }
  /** PUT /orgs/:orgId/treasury/policies */
  setPolicy(orgId: string, args: BankTreasuryPolicyArgs) { return this.b._call<BankRecord>("PUT", `/orgs/${enc(orgId)}/treasury/policies`, { json: args }); }
  /** GET /orgs/:orgId/treasury/sweep-plan */
  sweepPlan(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/treasury/sweep-plan`); }
  /** POST /orgs/:orgId/treasury/sweep — `idempotencyKey` REQUIRED. */
  sweep(orgId: string, args: { idempotencyKey: string }) {
    return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/treasury/sweep`, { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
}

class BankBillsNamespace extends Sub {
  /** GET /orgs/:orgId/vendors */
  listVendors(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/vendors`); }
  /** POST /orgs/:orgId/vendors */
  createVendor(orgId: string, args: BankVendorArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/vendors`, { json: args }); }
  /** GET /orgs/:orgId/bills */
  list(orgId: string, args: { status?: string } = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/bills`, { params: { ...args } }); }
  /** POST /orgs/:orgId/bills */
  create(orgId: string, args: BankBillArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/bills`, { json: args }); }
  /** POST /orgs/:orgId/bills/:billId/schedule */
  schedule(orgId: string, billId: string, args: BankBillScheduleArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/bills/${enc(billId)}/schedule`, { json: args }); }
  /** POST /orgs/:orgId/bills/:billId/cancel */
  cancel(orgId: string, billId: string) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/bills/${enc(billId)}/cancel`); }
  /** GET /orgs/:orgId/collections/ageing */
  ageing(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/collections/ageing`); }
  /** GET /orgs/:orgId/collections/dunning */
  listDunning(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/collections/dunning`); }
  /** POST /orgs/:orgId/collections/dunning/run */
  runDunning(orgId: string) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/collections/dunning/run`); }
}

class BankBooksNamespace extends Sub {
  /** GET /orgs/:orgId/books/categories */
  listCategories(orgId: string) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/books/categories`); }
  /** POST /orgs/:orgId/books/categories */
  createCategory(orgId: string, args: BankBooksCategoryArgs) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/books/categories`, { json: args }); }
  /** GET /orgs/:orgId/books/entries */
  listEntries(orgId: string, args: BankBooksEntriesArgs = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/books/entries`, { params: { ...args } }); }
  /** PATCH /orgs/:orgId/books/entries/:entryId */
  categorize(orgId: string, entryId: string, categoryId: string | null) { return this.b._call<BankRecord>("PATCH", `/orgs/${enc(orgId)}/books/entries/${enc(entryId)}`, { json: { categoryId } }); }
  /** POST /orgs/:orgId/books/close */
  close(orgId: string, through: string) { return this.b._call<BankRecord>("POST", `/orgs/${enc(orgId)}/books/close`, { json: { through } }); }
  /** GET /orgs/:orgId/books/journal */
  journal(orgId: string, args: BankBooksRangeArgs = {}) { return this.b._call<BankRecord>("GET", `/orgs/${enc(orgId)}/books/journal`, { params: { ...args } }); }
}

class BankBusinessNamespace {
  readonly orgs: BankOrgsNamespace;
  readonly members: BankMembersNamespace;
  readonly approvals: BankApprovalsNamespace;
  readonly treasury: BankTreasuryNamespace;
  readonly bills: BankBillsNamespace;
  readonly books: BankBooksNamespace;
  constructor(b: BankNamespace) {
    this.orgs = new BankOrgsNamespace(b);
    this.members = new BankMembersNamespace(b);
    this.approvals = new BankApprovalsNamespace(b);
    this.treasury = new BankTreasuryNamespace(b);
    this.bills = new BankBillsNamespace(b);
    this.books = new BankBooksNamespace(b);
  }
}

// ------------------------------------------------------------------ agents
class BankAgentsNamespace extends Sub {
  /** POST /agents/accounts — open an agent account with a spending mandate. */
  openAccount(args: BankAgentAccountArgs) { return this.b._call<BankRecord>("POST", "/agents/accounts", { json: args }); }
  /** GET /agents/mandates */
  mandates() { return this.b._call<BankRecord>("GET", "/agents/mandates"); }
  /** DELETE /agents/mandates/:id */
  revokeMandate(id: string) { return this.b._call<BankRecord>("DELETE", `/agents/mandates/${enc(id)}`); }
  /**
   * POST /agents/pay — x402 pay-per-call within a mandate. `idempotencyKey` is
   * OPTIONAL: with one, the call is sent as the Idempotency-Key header and is
   * retried with the same key; without one it is NOT auto-retried.
   */
  pay(args: BankAgentPayArgs) {
    const { idempotencyKey, ...json } = args;
    return this.b._call<BankRecord>("POST", "/agents/pay", idempotencyKey === undefined ? { json } : { json, idempotencyKey: this.b._key(idempotencyKey) });
  }
  /** POST /agents/resources — register a paywalled resource you sell. */
  registerResource(args: BankAgentResourceArgs) { return this.b._call<BankRecord>("POST", "/agents/resources", { json: args }); }
  /** GET /agents/resources */
  resources() { return this.b._call<BankRecord>("GET", "/agents/resources"); }
  /** POST /agents/resources/:id/enable|disable */
  setResourceEnabled(id: string, enabled: boolean) { return this.b._call<BankRecord>("POST", `/agents/resources/${enc(id)}/${enabled ? "enable" : "disable"}`); }
  /** GET /agents/directory */
  directory(args: BankAgentDirectoryArgs = {}) { return this.b._call<BankRecord>("GET", "/agents/directory", { params: { ...args } }); }
  /** POST /agents/streams — `idempotencyKey` REQUIRED. */
  createStream(args: BankAgentStreamArgs) {
    return this.b._call<BankRecord>("POST", "/agents/streams", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** POST /agents/streams/usage — `idempotencyKey` REQUIRED. */
  reportUsage(args: BankAgentUsageArgs) {
    return this.b._call<BankRecord>("POST", "/agents/streams/usage", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
}

// ---------------------------------------------------------------- platform
class BankPlatformNamespace extends Sub {
  /** PUT /platform/config */
  setConfig(args: BankPlatformConfigArgs) { return this.b._call<BankRecord>("PUT", "/platform/config", { json: args }); }
  /** GET /platform/config */
  getConfig() { return this.b._call<BankRecord>("GET", "/platform/config"); }
  /** POST /platform/customers */
  createCustomer(args: BankPlatformCustomerArgs) { return this.b._call<BankRecord>("POST", "/platform/customers", { json: args }); }
  /** GET /platform/customers */
  listCustomers() { return this.b._call<BankRecord>("GET", "/platform/customers"); }
  /** POST /platform/customers/:cid/accounts */
  openAccount(customerId: string, args: BankPlatformAccountArgs) { return this.b._call<BankRecord>("POST", `/platform/customers/${enc(customerId)}/accounts`, { json: args }); }
  /** GET /platform/customers/:cid/accounts */
  listAccounts(customerId: string) { return this.b._call<BankRecord>("GET", `/platform/customers/${enc(customerId)}/accounts`); }
  /** POST /platform/transfers — `idempotencyKey` REQUIRED. */
  transfer(args: BankPlatformTransferArgs) {
    return this.b._call<BankRecord>("POST", "/platform/transfers", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /platform/transfers */
  listTransfers() { return this.b._call<BankRecord>("GET", "/platform/transfers"); }
  /** POST /platform/fx — `idempotencyKey` REQUIRED. */
  fx(args: BankPlatformFxArgs) {
    return this.b._call<BankRecord>("POST", "/platform/fx", { json: args, idempotencyKey: this.b._key(args.idempotencyKey) });
  }
  /** GET /platform/usage */
  usage(args: BankPlatformUsageArgs = {}) { return this.b._call<BankRecord>("GET", "/platform/usage", { params: { ...args } }); }
  /** POST /platform/connector/convert — `xml` (pain.001 -> JSON) or `batch` (JSON -> pain.001 XML). */
  connectorConvert(args: { xml: string } | { batch: unknown }) { return this.b._call<BankRecord>("POST", "/platform/connector/convert", { json: args }); }
  /** POST /platform/connector/pain001 — import a pain.001 credit-transfer batch for a customer. */
  connectorImportPain001(args: { customerId: string } & ({ xml: string } | { batch: unknown })) { return this.b._call<BankRecord>("POST", "/platform/connector/pain001", { json: args }); }
}

// ------------------------------------------------------- chains / privacy
class BankChainsNamespace extends Sub {
  /** POST /chains/fee-model */
  feeModel(args: BankFeeModelArgs) { return this.b._call<BankRecord>("POST", "/chains/fee-model", { json: args }); }
}

class BankPrivacyNamespace extends Sub {
  /** POST /privacy/meta-address — private keys are returned ONCE and never stored. */
  metaAddress() { return this.b._call<BankRecord>("POST", "/privacy/meta-address"); }
  /** POST /privacy/payout-address */
  payoutAddress(args: BankPrivacyPayoutArgs) { return this.b._call<BankRecord>("POST", "/privacy/payout-address", { json: args }); }
  /** POST /privacy/announced */
  announced(args: BankPrivacyAnnouncedArgs) { return this.b._call<BankRecord>("POST", "/privacy/announced", { json: args }); }
  /** GET /privacy/announcements (client-side scanning; no key material is sent). Paginates by a bounded block span: pass the returned cursor as the next `fromBlock`. */
  announcements(args: BankPrivacyAnnouncementsArgs) { return this.b._call<BankRecord>("GET", "/privacy/announcements", { params: { ...args } }); }
}

// ---------------------------------------------------------------- segments
class BankSegmentsNamespace extends Sub {
  /** GET /segments */
  list() { return this.b._call<BankRecord>("GET", "/segments"); }
  /** GET /segments/:segment */
  get(segment: string) { return this.b._call<BankRecord>("GET", `/segments/${enc(segment)}`); }
  /** GET /accounts/:id/features */
  accountFeatures(accountId: string) { return this.b._call<BankRecord>("GET", `/accounts/${enc(accountId)}/features`); }
  /** PUT /accounts/:id/segment (`null` clears the segment) */
  setAccountSegment(accountId: string, segment: string | null) { return this.b._call<BankRecord>("PUT", `/accounts/${enc(accountId)}/segment`, { json: { segment } }); }
}

// --------------------------------------------------------------------- ops
class BankOpsNamespace extends Sub {
  /** GET /ops/alerts — the owner's stuck transfers/ops (read-only). */
  alerts() { return this.b._call<BankRecord>("GET", "/ops/alerts"); }
}
