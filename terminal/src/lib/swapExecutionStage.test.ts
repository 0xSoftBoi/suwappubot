import { describe, expect, test } from 'bun:test'
import { SWAP_EXECUTION_STAGES, swapExecutionStageLabel } from './swapExecutionStage'

describe('swap execution stage copy', () => {
  test('gives every observable stage a concise label', () => {
    for (const stage of SWAP_EXECUTION_STAGES) {
      expect(swapExecutionStageLabel(stage).trim()).not.toBe('')
    }
  })

  test('never presents an in-flight stage as a settled outcome', () => {
    for (const stage of SWAP_EXECUTION_STAGES) {
      expect(swapExecutionStageLabel(stage).toLowerCase()).not.toMatch(
        /\b(completed|filled|settled|success(?:ful)?)\b/,
      )
    }
  })

  test('distinguishes broadcast from confirmation', () => {
    expect(swapExecutionStageLabel('recording-submission')).toContain('Submitted')
    expect(swapExecutionStageLabel('confirming-approval')).toContain('confirming')
  })
})
