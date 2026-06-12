import { FileStore, DelegationStore } from './storage';
import {
  KeyringService,
  ChainService,
  SDKService,
  WalletClientService,
  AccountService,
  RecoveryService,
  DelegationService,
} from './services';
import { resolveProvider } from './providers';
import type { SecretProvider } from './providers';
import type { AccountInfo } from './types';

/**
 * Application context — the service container.
 *
 * Extension uses singletons + eventBus for inter-service wiring.
 * CLI uses explicit dependency injection via this context object.
 * All commands receive the context and pick the services they need.
 */
export interface AppContext {
  store: FileStore;
  keyring: KeyringService;
  chain: ChainService;
  sdk: SDKService;
  walletClient: WalletClientService;
  account: AccountService;
  delegation: DelegationService;
  recovery: RecoveryService;
  /**
   * The resolved provider for storing/loading the vault key.
   * null if no provider was available at boot (init not yet run, or unsupported platform).
   */
  secretProvider: SecretProvider | null;
}

/**
 * Bootstrap all services and return the app context.
 * Called once at CLI startup.
 *
 * If a vault key can be loaded (from OS keychain, file, or env var),
 * the keyring is automatically unlocked.
 * Commands can check keyring.isUnlocked to verify readiness.
 */
export async function createAppContext(): Promise<AppContext> {
  const store = new FileStore();
  await store.init();

  const keyring = new KeyringService(store);
  const chain = new ChainService(store);
  const sdk = new SDKService();
  const walletClient = new WalletClientService();

  // Load persisted chain config
  await chain.init();

  // Resolve secret provider (OS keychain > file > env var > null)
  const { loadProvider } = await resolveProvider();

  // Auto-load vault key and unlock keyring
  const isInitialized = await keyring.isInitialized();
  if (isInitialized) {
    if (!loadProvider) {
      throw new Error(
        'Wallet is initialized but no secret provider is available.\n' + noProviderHint(),
      );
    }

    const vaultKey = await loadProvider.load();
    if (!vaultKey) {
      throw new Error(
        `Wallet is initialized but vault key not found in ${loadProvider.name}.\n` +
          'The credential may have been deleted. Re-run `elytro init` to create a new wallet,\n' +
          'or import a backup with `elytro import`.',
      );
    }

    try {
      await keyring.unlock(vaultKey);
    } catch (err) {
      // Zero-fill before rethrowing
      vaultKey.fill(0);
      throw new Error(
        `Wallet unlock failed: ${(err as Error).message}\n` +
          'The vault key may not match the encrypted keyring. ' +
          'Re-run `elytro init` or import a backup.',
      );
    }

    await chain.unlockUserKeys(vaultKey);

    // Zero-fill the key buffer after successful use
    vaultKey.fill(0);

    const unlockedChain = chain.currentChain;
    walletClient.initForChain(unlockedChain);
    await sdk.initForChain(unlockedChain);
  } else {
    // No vault yet — init with public endpoints so commands like `init` work
    const defaultChain = chain.currentChain;
    walletClient.initForChain(defaultChain);
    await sdk.initForChain(defaultChain);
  }

  const account = new AccountService({
    store,
    keyring,
    sdk,
    chain,
    walletClient,
  });
  await account.init();

  const delegationStore = new DelegationStore(store);

  const delegation = new DelegationService({
    delegationStore,
    account,
    sdk,
    keyring,
    chain,
    walletClient,
  });

  // Migrate legacy delegations from accounts.json → per-account files.
  // Safe to run on every startup: idempotent (drainLegacy clears after first run).
  await delegation.migrateLegacy();

  const recovery = new RecoveryService({
    store,
    sdk,
    chain,
    account,
    keyring,
  });

  const appCtx: AppContext = {
    store,
    keyring,
    chain,
    sdk,
    walletClient,
    account,
    delegation,
    recovery,
    secretProvider: loadProvider,
  };

  const currentAccount = account.currentAccount;
  if (currentAccount) {
    await syncContextForAccount(appCtx, currentAccount);
  }

  return appCtx;
}

/**
 * Synchronize keyring owner + chain-dependent services to match the given account.
 *
 * Must be called whenever the active account changes (switch, bootstrap, or
 * before any signing operation on a specific account). Ensures:
 *   1. keyring signs with the account's owner key
 *   2. SDK + walletClient target the account's chain
 */
export async function syncContextForAccount(ctx: AppContext, account: AccountInfo): Promise<void> {
  // 1. Switch keyring owner if mismatched
  if (ctx.keyring.currentOwner?.toLowerCase() !== account.owner.toLowerCase()) {
    await ctx.keyring.switchOwner(account.owner);
  }

  // 2. Re-init chain-dependent services for account's chain
  const chainConfig = ctx.chain.chains.find((c) => c.id === account.chainId);
  if (!chainConfig) {
    throw new Error(`Chain ${account.chainId} is not configured.`);
  }
  ctx.walletClient.initForChain(chainConfig);
  await ctx.sdk.initForChain(chainConfig);
}

/** Platform-specific hint when no secret provider is available. */
function noProviderHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS Keychain access failed. Check Keychain permissions or security settings.';
    case 'win32':
      return 'Windows Credential Manager access failed. Run as the same user who initialized the wallet.';
    default:
      return (
        'No secret provider available. Options:\n' +
        '  1. Check whether the OS credential store is reachable\n' +
        '  2. Check whether the vault key file (~/.elytro/.vault-key) is writable/readable\n' +
        '  3. Verify ~/.elytro permissions allow Elytro to access its files'
      );
  }
}
