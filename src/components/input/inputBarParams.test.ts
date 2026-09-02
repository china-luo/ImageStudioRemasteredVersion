import { describe, expect, it } from 'vitest'
import { normalizeCompressionInput, normalizeCountInput } from './inputBarParams'

describe('input bar parameter helpers', () => {
  it('clamps compression and restores the last value for invalid input', () => {
    expect(normalizeCompressionInput('120', 70)).toEqual({ input: '100', value: 100 })
    expect(normalizeCompressionInput('bad', 70)).toEqual({ input: '70', value: undefined })
    expect(normalizeCompressionInput('', 70)).toEqual({ input: '', value: null })
  })

  it('clamps image count to the provider limit', () => {
    expect(normalizeCountInput('9', 1, 4)).toEqual({ input: '4', value: 4 })
    expect(normalizeCountInput('', 2, 4)).toEqual({ input: '1', value: 1 })
    expect(normalizeCountInput('bad', 2, 4)).toEqual({ input: '2', value: 2 })
  })
})
