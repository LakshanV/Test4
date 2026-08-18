import { describe, expect, it } from 'vitest'
import { toCents } from './split'

describe('toCents', () => {
  it('converts a currency amount to whole cents', () => {
    expect(toCents(12.34)).toBe(1234)
  })

  it('rounds half away from zero', () => {
    expect(toCents(0.005)).toBe(1)
    expect(toCents(-0.005)).toBe(-1)
  })
})
