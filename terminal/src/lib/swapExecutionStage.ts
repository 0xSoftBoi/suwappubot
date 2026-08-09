export const SWAP_EXECUTION_STAGES = [
  'connecting-wallet',
  'building',
  'switching-network',
  'signing-and-submitting-approval',
  'confirming-approval',
  'signing-swap',
  'signing-and-submitting-swap',
  'submitting-swap',
  'recording-submission',
] as const

export type SwapExecutionStage = (typeof SWAP_EXECUTION_STAGES)[number]

/**
 * Human copy for waits the client can actually observe.
 *
 * None of these labels imply settlement. A wallet signature or transaction
 * hash proves progress through submission, not that the swap filled on-chain.
 */
export function swapExecutionStageLabel(stage: SwapExecutionStage): string {
  switch (stage) {
    case 'connecting-wallet':
      return 'Connect wallet…'
    case 'building':
      return 'Building fresh transaction…'
    case 'switching-network':
      return 'Switch network in wallet…'
    case 'signing-and-submitting-approval':
      return 'Approve & submit token approval…'
    case 'confirming-approval':
      return 'Approval submitted · confirming…'
    case 'signing-swap':
      return 'Sign swap in wallet…'
    case 'signing-and-submitting-swap':
      return 'Sign & submit swap…'
    case 'submitting-swap':
      return 'Signed · submitting…'
    case 'recording-submission':
      return 'Submitted · saving record…'
  }
}
