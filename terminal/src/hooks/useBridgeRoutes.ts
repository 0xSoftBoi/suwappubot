import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../lib/api";
import type { BridgeRoutesRequest, BridgeTransfer } from "../types/bridge";
import { STATE_COPY } from "../components/bridge/custody";

const QUOTE_DEBOUNCE_MS = 500;

/**
 * Cross-chain routes for a token.
 *
 * Mirrors useSwapQuote's debounce/stale behaviour so route refreshes feel the
 * same as quote refreshes elsewhere in the terminal.
 */
export function useBridgeRoutes(
  request: Partial<BridgeRoutesRequest> | null,
  enabled = true,
) {
  const isValidRequest = useMemo(() => {
    if (!request) return false;
    const { fromChain, toChain, token, amount } = request;
    if (!fromChain || !toChain || !token || !amount) return false;
    // Same chain is a swap, not a bridge.
    if (fromChain === toChain) return false;
    const amountNum = parseFloat(amount);
    return Number.isFinite(amountNum) && amountNum > 0;
  }, [request]);

  const queryKey = useMemo(() => {
    if (!request) return ["bridge-routes", null];
    return [
      "bridge-routes",
      request.fromChain,
      request.toChain,
      request.token,
      request.amount,
      request.slippageBps,
    ];
  }, [request]);

  return useQuery({
    queryKey,
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, QUOTE_DEBOUNCE_MS));
      return api.getBridgeRoutes(request as BridgeRoutesRequest);
    },
    enabled: enabled && isValidRequest,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * Track one in-flight transfer.
 *
 * Polls while the transfer is unsettled and stops once it is. The polling
 * matters more here than it does for a swap: between leaving the source chain
 * and arriving on the destination there is a window where the user's funds are
 * on neither, and that window is where transfers get stuck. A screen that
 * silently stopped updating during it would be worse than no screen at all.
 */
export function useBridgeTransfer(transferId: string | null) {
  return useQuery({
    queryKey: ["bridge-transfer", transferId],
    queryFn: () => api.getBridgeTransfer(transferId as string),
    enabled: Boolean(transferId),
    // Poll while in flight; back off to nothing once settled.
    refetchInterval: (query) => {
      const data = query.state.data as BridgeTransfer | undefined;
      if (!data) return 5_000;
      return STATE_COPY[data.state].settled ? false : 5_000;
    },
    // Keep polling in a background tab: an unattended transfer is exactly the
    // case where the user comes back and wants the truth, not a stale frame.
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: 2,
  });
}
