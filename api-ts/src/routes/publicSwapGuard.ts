import { Hono } from 'hono'
import { trustedSpendPreflight } from '../middleware/trustedSpend'
import { publicSwapRoutes as rawPublicSwapRoutes } from './publicSwap'

/**
 * Keep preview/quote/token discovery behavior unchanged, but require a trusted
 * trading session before the route that asks Suwappu/Turnkey to sign and
 * broadcast on the user's behalf. rawPublicSwapRoutes still runs flexAuth()
 * afterwards and performs the real JWT/cookie signature verification.
 */
const guardedPublicSwapRoutes = new Hono()
guardedPublicSwapRoutes.use('/execute', trustedSpendPreflight())
guardedPublicSwapRoutes.route('/', rawPublicSwapRoutes)

export { guardedPublicSwapRoutes }
