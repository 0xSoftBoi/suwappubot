// EIP-1193 / EIP-1474 standard provider error codes and helpers.
// Both the inpage provider (to reject dApp promises) and the background
// router (to produce error responses) MUST use these — never ad-hoc codes.

export interface SerializedRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export const RPC_ERROR_CODES = {
  // EIP-1193 provider errors
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  // EIP-1474 / JSON-RPC errors
  INVALID_INPUT: -32000,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  // Custom (wallet locked)
  WALLET_LOCKED: 4101,
} as const;

const DEFAULT_MESSAGES: Record<number, string> = {
  4001: "User rejected the request.",
  4100: "The requested account and/or method has not been authorized by the user.",
  4101: "Wallet is locked.",
  4200: "The requested method is not supported by this provider.",
  4900: "The provider is disconnected from all chains.",
  4901: "The provider is disconnected from the specified chain.",
  [-32600]: "The JSON sent is not a valid Request object.",
  [-32601]: "The method does not exist / is not available.",
  [-32602]: "Invalid method parameters.",
  [-32603]: "Internal JSON-RPC error.",
};

export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message?: string, data?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code] ?? "Unspecified error.");
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
  serialize(): SerializedRpcError {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export function userRejected(msg?: string) {
  return new RpcError(RPC_ERROR_CODES.USER_REJECTED, msg);
}
export function unauthorized(msg?: string) {
  return new RpcError(RPC_ERROR_CODES.UNAUTHORIZED, msg);
}
export function walletLocked(msg?: string) {
  return new RpcError(RPC_ERROR_CODES.WALLET_LOCKED, msg);
}
export function unsupportedMethod(method: string) {
  return new RpcError(RPC_ERROR_CODES.UNSUPPORTED_METHOD, `Unsupported method: ${method}`);
}

/** Normalize any thrown value into a SerializedRpcError for transport. */
export function serializeError(err: unknown): SerializedRpcError {
  if (err instanceof RpcError) return err.serialize();
  if (err instanceof Error) return { code: RPC_ERROR_CODES.INTERNAL, message: err.message };
  return { code: RPC_ERROR_CODES.INTERNAL, message: String(err) };
}
