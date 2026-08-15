import type { QueryClient } from '@tanstack/react-query'

/**
 * Mutation handlers that optimistically remove an item by `id` from a list query,
 * so a cancel/delete feels instant. Snapshots the cache, removes the row
 * immediately, rolls back if the request fails, and reconciles with the server on
 * settle. Use as: `...optimisticRemoveById(queryClient, ['limit-orders'])`.
 */
export function optimisticRemoveById(queryClient: QueryClient, queryKey: unknown[]) {
  return {
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (old: unknown) =>
        Array.isArray(old) ? old.filter((o: any) => String(o?.id) !== String(id)) : old,
      )
      return { prev }
    },
    onError: (_err: unknown, _id: string, ctx: { prev: unknown } | undefined) => {
      if (ctx && ctx.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  }
}
