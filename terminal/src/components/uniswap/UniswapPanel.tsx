import { UNISWAP_CONFIG } from '../../lib/uniswap'
import { V3AmmPanel } from '../v3amm/V3AmmPanel'

export function UniswapPanel() {
  return <V3AmmPanel config={UNISWAP_CONFIG} />
}
