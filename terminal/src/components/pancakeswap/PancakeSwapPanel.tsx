import { PANCAKESWAP_CONFIG } from '../../lib/pancakeswap'
import { V3AmmPanel } from '../v3amm/V3AmmPanel'

export function PancakeSwapPanel() {
  return <V3AmmPanel config={PANCAKESWAP_CONFIG} />
}
