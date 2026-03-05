export { healthRoutes } from './health'
export { webappRoutes } from './webapp'
export { swapRoutes } from './swap'
export { agentRoutes } from './agent'
export { a2aRoutes } from './a2a'
export { adminRoutes } from './admin'
export { tokenRoutes } from './tokens'

// Stub for removed publicSwapRoutes (previously in publicSwap.ts)
import { Hono } from 'hono'
export const publicSwapRoutes = new Hono()
