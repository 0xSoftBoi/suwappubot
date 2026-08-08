/**
 * Centralised query keys.
 *
 * Keys are declared in one place so invalidation is precise. Scattering
 * inline array literals across screens is how you end up calling
 * `invalidateQueries()` with no arguments and refetching the entire app.
 */
export const queryKeys = {
  snapshot: (authRevision: number) => ['gecko', authRevision, 'snapshot'] as const,
  activity: (authRevision: number, limit: number, offset: number) =>
    ['gecko', authRevision, 'activity', limit, offset] as const,
  health: () => ['health'] as const,
} as const
