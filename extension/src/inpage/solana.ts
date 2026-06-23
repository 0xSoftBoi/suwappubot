import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { ContentToInpage, InpageToContent, RpcRequest } from "@/shared/protocol";
import { WALLET_NAMESPACE } from "@/shared/constants";
import { RPC_ERROR_CODES, RpcError } from "@/shared/rpc-errors";

/** Phantom-compatible Solana window.solana provider. */
export interface SuwappuSolanaProvider {
  isPhantom: boolean;
  isSuwappu: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;

  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array; publicKey: PublicKey }>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  signAndSendTransaction(
    tx: Transaction | VersionedTransaction,
  ): Promise<{ signature: string; publicKey: PublicKey }>;

  on(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void;
  off(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void;
  removeListener(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

class SolanaProvider implements SuwappuSolanaProvider {
  isPhantom = false;
  isSuwappu = true;
  publicKey: PublicKey | null = null;
  isConnected = false;

  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();

  constructor() {
    this.listeners.set("connect", new Set());
    this.listeners.set("disconnect", new Set());
    this.listeners.set("accountChanged", new Set());

    // Listen for responses from content script
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const msg = event.data as ContentToInpage | undefined;
      if (!msg || msg.namespace !== WALLET_NAMESPACE || msg.target !== "inpage" || msg.chain !== "solana") return;

      // Handle RPC response
      if (msg.payload) {
        const { id, result, error } = msg.payload;
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          if (error) {
            pending.reject(new RpcError(error.code, error.message, error.data));
          } else {
            pending.resolve(result);
          }
        }
      }

      // Handle provider event
      if (msg.event) {
        const handlers = this.listeners.get(msg.event.event);
        if (handlers) {
          handlers.forEach((listener) => {
            try {
              listener(msg.event!.data);
            } catch (err) {
              console.error(`Error in Solana provider "${msg.event!.event}" listener:`, err);
            }
          });
        }
      }
    });
  }

  private async request(method: string, params?: Record<string, unknown> | unknown[]): Promise<unknown> {
    const id = crypto.randomUUID();
    const payload: RpcRequest = { id, method, params };

    const request = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      // 30s timeout per request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new RpcError(RPC_ERROR_CODES.INTERNAL, "Solana provider request timeout"));
      }, 30000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.pendingRequests.get(id) as any)._timeout = timeout;
    });

    const msg: InpageToContent = {
      namespace: WALLET_NAMESPACE,
      target: "content",
      chain: "solana",
      payload,
    };
    window.postMessage(msg, window.location.origin);

    try {
      return await request;
    } finally {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clearTimeout((pending as any)._timeout);
        this.pendingRequests.delete(id);
      }
    }
  }

  async connect(): Promise<{ publicKey: PublicKey }> {
    const result = (await this.request("connect")) as { publicKey: string };
    this.publicKey = new PublicKey(result.publicKey);
    this.isConnected = true;
    this.emit("connect", { publicKey: this.publicKey });
    return { publicKey: this.publicKey };
  }

  async disconnect(): Promise<void> {
    await this.request("disconnect");
    this.publicKey = null;
    this.isConnected = false;
    this.emit("disconnect");
  }

  async signMessage(message: Uint8Array): Promise<{ signature: Uint8Array; publicKey: PublicKey }> {
    const encoded = bs58.encode(message);
    const result = (await this.request("signMessage", { message: encoded })) as {
      signature: string;
      publicKey: string;
    };
    return {
      signature: bs58.decode(result.signature),
      publicKey: new PublicKey(result.publicKey),
    };
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const serialized = tx.serialize().toString("base64");
    const isVersioned = "version" in tx;
    const result = (await this.request("signTransaction", {
      transaction: serialized,
      isVersioned,
    })) as { transaction: string };

    const buf = Buffer.from(result.transaction, "base64");
    if (isVersioned) {
      return VersionedTransaction.deserialize(buf) as T;
    } else {
      return Transaction.from(buf) as T;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    const serialized = txs.map((tx) => ({
      transaction: tx.serialize().toString("base64"),
      isVersioned: "version" in tx,
    }));
    const result = (await this.request("signAllTransactions", { transactions: serialized })) as {
      transactions: { transaction: string; isVersioned: boolean }[];
    };

    return result.transactions.map((item) => {
      const buf = Buffer.from(item.transaction, "base64");
      if (item.isVersioned) {
        return VersionedTransaction.deserialize(buf) as T;
      } else {
        return Transaction.from(buf) as T;
      }
    });
  }

  async signAndSendTransaction(
    tx: Transaction | VersionedTransaction,
  ): Promise<{ signature: string; publicKey: PublicKey }> {
    const serialized = tx.serialize().toString("base64");
    const isVersioned = "version" in tx;
    const result = (await this.request("signAndSendTransaction", {
      transaction: serialized,
      isVersioned,
    })) as { signature: string; publicKey: string };
    return {
      signature: result.signature,
      publicKey: new PublicKey(result.publicKey),
    };
  }

  on(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.add(listener);
    }
  }

  off(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  removeListener(event: "connect" | "disconnect" | "accountChanged", listener: (...args: unknown[]) => void): void {
    this.off(event, listener);
  }

  private emit(event: string, data?: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((listener) => {
        try {
          listener(data);
        } catch (err) {
          console.error(`Error in Solana provider "${event}" listener:`, err);
        }
      });
    }
  }
}

/**
 * Dispatch handler for Solana RPC messages from src/inpage/index.ts.
 * Routes ContentToInpage messages with chain:'solana' to the provider instance.
 * Exported so index.ts can call it when registering the provider.
 */
export function createSolanaProvider(): SuwappuSolanaProvider {
  return new SolanaProvider();
}

/**
 * Register the Solana provider globally as window.solana.
 * Called by src/inpage/index.ts.
 */
export function registerSolana(): void {
  const provider = createSolanaProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).solana = provider;
}
