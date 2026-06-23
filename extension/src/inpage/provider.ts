import {
  RpcRequest,
  RpcResponse,
  InpageToContent,
  ContentToInpage,
  ProviderEventName,
  ProviderEvent,
} from "@/shared/protocol";
import { RpcError, RPC_ERROR_CODES, serializeError } from "@/shared/rpc-errors";
import { WALLET_NAMESPACE } from "@/shared/constants";

type ProviderEventListener = (data: unknown) => void;

/**
 * EIP-1193 compliant Ethereum provider.
 * Injects into the dApp's MAIN world via contentScript, relays RPC through postMessage.
 */
export class EthereumProvider {
  private listeners: Map<ProviderEventName, Set<ProviderEventListener>> = new Map();
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();

  private _isConnected = false;
  private _selectedAddress: string | null = null;
  private _chainId = 8453; // Base mainnet default

  constructor() {
    this.setupMessageListener();
  }

  /**
   * Set up the single window message listener that routes incoming ContentToInpage
   * messages to this provider instance.
   */
  private setupMessageListener(): void {
    window.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data as ContentToInpage | unknown;

      // Only process messages with our namespace and inpage target
      if (
        typeof msg === "object" &&
        msg !== null &&
        "namespace" in msg &&
        "target" in msg &&
        msg.namespace === WALLET_NAMESPACE &&
        msg.target === "inpage"
      ) {
        const content = msg as ContentToInpage;

        // Only handle EVM chain messages for this provider
        if (content.chain !== "eip155") return;

        // If payload present, this is an RPC response
        if (content.payload) {
          this.handleRpcResponse(content.payload);
        }

        // If event present, this is a pushed provider event
        if (content.event) {
          this.handleProviderEvent(content.event);
        }
      }
    });
  }

  /**
   * Handle an incoming RPC response by resolving or rejecting the pending request.
   */
  private handleRpcResponse(response: RpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);

    if (response.error) {
      const err = new RpcError(
        response.error.code,
        response.error.message,
        response.error.data
      );
      pending.reject(err);
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle a pushed provider event (accountsChanged, chainChanged, etc).
   * Update internal state and emit to listeners.
   */
  private handleProviderEvent(event: ProviderEvent): void {
    switch (event.event) {
      case "connect":
        this._isConnected = true;
        if (typeof event.data === "object" && event.data !== null && "chainId" in event.data) {
          const chainObj = event.data as { chainId: string };
          this._chainId = parseInt(chainObj.chainId, 16);
        }
        break;
      case "disconnect":
        this._isConnected = false;
        break;
      case "chainChanged":
        if (typeof event.data === "string") {
          this._chainId = parseInt(event.data, 16);
        }
        break;
      case "accountsChanged":
        if (Array.isArray(event.data) && event.data.length > 0) {
          this._selectedAddress = event.data[0];
        } else {
          this._selectedAddress = null;
        }
        break;
    }

    this.emit(event.event, event.data);
  }

  /**
   * EIP-1193 request method. Generates a UUID, wraps in InpageToContent,
   * posts to content bridge, and returns a promise resolved on ContentToInpage response.
   */
  async request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown> {
    const id = crypto.randomUUID();

    const rpcRequest: RpcRequest = {
      id,
      method: args.method,
      params: args.params,
    };

    const message: InpageToContent = {
      namespace: WALLET_NAMESPACE,
      target: "content",
      chain: "eip155",
      payload: rpcRequest,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        window.postMessage(message, window.location.origin);
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(serializeError(err));
      }

      // Safety timeout: if no response in 30s, fail the request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new RpcError(RPC_ERROR_CODES.INTERNAL, "Request timeout"));
        }
      }, 30000);
    });
  }

  /**
   * EventEmitter-like interface: on(event, listener)
   */
  on(event: ProviderEventName, listener: ProviderEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove a specific listener or all listeners for an event.
   */
  removeListener(event: ProviderEventName, listener?: ProviderEventListener): void {
    if (!listener) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners.
   */
  private emit(event: ProviderEventName, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[Suwappu] Error in ${event} handler:`, err);
        }
      });
    }
  }

  /**
   * Legacy send() method (EIP-1193 pre-1.0).
   * Synchronous for simple requests, async callback for others.
   */
  send(
    methodOrPayload: string | { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown },
    paramsOrCallback?:
      | unknown[]
      | Record<string, unknown>
      | ((err: Error | null, response?: unknown) => void)
  ): any {
    if (typeof methodOrPayload === "string") {
      // Legacy synchronous send(method, params)
      // For simple methods like eth_chainId, we can return synchronously
      if (methodOrPayload === "eth_chainId") {
        return {
          jsonrpc: "2.0",
          id: null,
          result: `0x${this._chainId.toString(16)}`,
        };
      }
      // For async methods, warn the caller
      console.warn(
        "[Suwappu] Synchronous send() is deprecated; use request() instead"
      );
      return undefined;
    } else if (typeof paramsOrCallback === "function") {
      // Legacy callback send(payload, callback)
      const payload = methodOrPayload as { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown };
      const callback = paramsOrCallback as (err: Error | null, response?: unknown) => void;

      this.request({
        method: payload.method,
        params: payload.params as unknown[] | Record<string, unknown>,
      }).then(
        (result) => {
          callback(null, {
            jsonrpc: "2.0",
            id: payload.id,
            result,
          });
        },
        (err) => {
          callback(err as Error);
        }
      );
    }
  }

  /**
   * Legacy sendAsync() method (EIP-1193 pre-1.0).
   * Alias for send(payload, callback).
   */
  sendAsync(
    payload: { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown },
    callback: (err: Error | null, response?: unknown) => void
  ): void {
    this.send(payload, callback);
  }

  /**
   * Legacy enable() method (MetaMask-specific).
   * Requests accounts access.
   */
  async enable(): Promise<string[]> {
    return this.request({ method: "eth_requestAccounts" }) as Promise<string[]>;
  }

  /**
   * Return true if the provider has ever been connected to a chain.
   */
  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Getter: current chain ID as hex string (EIP-1193).
   */
  get chainId(): string {
    return `0x${this._chainId.toString(16)}`;
  }

  /**
   * Getter: currently selected account or null.
   */
  get selectedAddress(): string | null {
    return this._selectedAddress;
  }

  /**
   * Getter: current chain ID as decimal string (MetaMask compat).
   */
  get networkVersion(): string {
    return this._chainId.toString();
  }

  /**
   * Identify as Suwappu, not MetaMask.
   */
  get isMetaMask(): boolean {
    return false;
  }

  get isSuwappu(): boolean {
    return true;
  }
}
