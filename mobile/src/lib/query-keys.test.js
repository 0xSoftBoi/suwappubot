import { describe, expect, test } from 'bun:test'
import { queryKeys } from './queryKeys'

describe('Gecko account query keys', () => {
  test('namespace financial snapshots by auth revision', () => {
    expect(queryKeys.snapshot(1)).not.toEqual(queryKeys.snapshot(2))
  })

  test('namespace activity by auth revision', () => {
    expect(queryKeys.activity(1, 20, 0)).not.toEqual(queryKeys.activity(2, 20, 0))
  })
})
