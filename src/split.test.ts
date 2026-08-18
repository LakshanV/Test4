import { describe, expect, it } from 'vitest'
import {
  distributeCents,
  fromCents,
  splitBill,
  toCents,
  type SplitInput,
} from './split'

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

describe('toCents', () => {
  it('converts a currency amount to whole cents', () => {
    expect(toCents(12.34)).toBe(1234)
    expect(toCents(0)).toBe(0)
    expect(toCents(84.5)).toBe(8450)
  })

  it('rounds half away from zero', () => {
    expect(toCents(0.005)).toBe(1)
    expect(toCents(-0.005)).toBe(-1)
  })

  it('survives amounts that are not exactly representable in binary floating point', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(19.99)).toBe(1999)
  })
})

describe('fromCents', () => {
  it('round-trips with toCents', () => {
    for (const amount of [0, 0.01, 1, 19.99, 84.5, 1234.56]) {
      expect(fromCents(toCents(amount))).toBe(amount)
    }
  })
})

describe('even split', () => {
  it('divides a bill that splits cleanly', () => {
    const result = splitBill({ mode: 'even', subtotal: 60, taxPercent: 0, tipPercent: 0, people: 4 })
    expect(result.totalCents).toBe(6000)
    expect(result.shares).toEqual([1500, 1500, 1500, 1500])
  })

  it('gives the whole bill to a single person', () => {
    const result = splitBill({ mode: 'even', subtotal: 19.99, taxPercent: 0, tipPercent: 0, people: 1 })
    expect(result.shares).toEqual([1999])
  })

  it('hands leftover cents to the earliest people when the split is not clean', () => {
    const result = splitBill({ mode: 'even', subtotal: 100, taxPercent: 0, tipPercent: 0, people: 3 })
    expect(result.totalCents).toBe(10000)
    expect(result.shares).toEqual([3334, 3333, 3333])
    expect(sum(result.shares)).toBe(result.totalCents)
  })

  it('never spreads even shares by more than one cent', () => {
    const result = splitBill({ mode: 'even', subtotal: 100, taxPercent: 0, tipPercent: 0, people: 7 })
    expect(result.shares).toEqual([1429, 1429, 1429, 1429, 1428, 1428, 1428])
    expect(Math.max(...result.shares) - Math.min(...result.shares)).toBe(1)
    expect(sum(result.shares)).toBe(10000)
  })

  it('handles more people than cents', () => {
    const result = splitBill({ mode: 'even', subtotal: 0.03, taxPercent: 0, tipPercent: 0, people: 5 })
    expect(result.shares).toEqual([1, 1, 1, 0, 0])
    expect(sum(result.shares)).toBe(3)
  })

  it('produces all zeroes for a zero bill', () => {
    const result = splitBill({ mode: 'even', subtotal: 0, taxPercent: 10, tipPercent: 20, people: 3 })
    expect(result.totalCents).toBe(0)
    expect(result.shares).toEqual([0, 0, 0])
  })
})

describe('weighted split', () => {
  it('allocates in proportion to the weights', () => {
    const result = splitBill({
      mode: 'weighted',
      subtotal: 100,
      taxPercent: 0,
      tipPercent: 0,
      weights: [1, 3],
    })
    expect(result.shares).toEqual([2500, 7500])
  })

  it('only cares about the ratio between weights, not their scale', () => {
    const shapes = [
      [1, 2, 1],
      [10, 20, 10],
      [0.5, 1, 0.5],
      [3.5, 7, 3.5],
    ]
    const shares = shapes.map(
      (weights) =>
        splitBill({ mode: 'weighted', subtotal: 100.01, taxPercent: 0, tipPercent: 0, weights }).shares,
    )
    for (const share of shares) {
      expect(share).toEqual(shares[0])
    }
  })

  it('gives a zero-weight person a zero share', () => {
    const result = splitBill({
      mode: 'weighted',
      subtotal: 10,
      taxPercent: 0,
      tipPercent: 0,
      weights: [0, 1, 1],
    })
    expect(result.shares).toEqual([0, 500, 500])
    expect(sum(result.shares)).toBe(result.totalCents)
  })

  it('keeps zero-weight people at zero even when there are leftover cents to place', () => {
    // 10 cents over weights 1:1:1 leaves one cent spare; it must not land on
    // the zero-weight person at index 0.
    expect(distributeCents(10, [0, 1, 1, 1])).toEqual([0, 4, 3, 3])
  })

  it('matches an even split when every weight is equal', () => {
    const weighted = splitBill({
      mode: 'weighted',
      subtotal: 100,
      taxPercent: 0,
      tipPercent: 0,
      weights: [1, 1, 1],
    })
    const even = splitBill({ mode: 'even', subtotal: 100, taxPercent: 0, tipPercent: 0, people: 3 })
    expect(weighted.shares).toEqual(even.shares)
  })
})

describe('tax and tip', () => {
  it('applies tax and tip on top of the subtotal', () => {
    const result = splitBill({
      mode: 'even',
      subtotal: 84.5,
      taxPercent: 8.875,
      tipPercent: 20,
      people: 4,
    })
    expect(result.subtotalCents).toBe(8450)
    expect(result.taxCents).toBe(750) // 8450 * 8.875% = 749.9375 -> 750
    expect(result.tipCents).toBe(1690) // tipped on the pre-tax subtotal by default
    expect(result.totalCents).toBe(10890)
    expect(result.shares).toEqual([2723, 2723, 2722, 2722])
    expect(sum(result.shares)).toBe(result.totalCents)
  })

  it('tips on the post-tax amount when asked', () => {
    const result = splitBill({
      mode: 'even',
      subtotal: 84.5,
      taxPercent: 8.875,
      tipPercent: 20,
      tipBasis: 'postTax',
      people: 4,
    })
    expect(result.tipCents).toBe(1840) // (8450 + 750) * 20%
    expect(result.totalCents).toBe(11040)
    expect(result.shares).toEqual([2760, 2760, 2760, 2760])
  })

  it('treats an omitted tipBasis the same as an explicit subtotal basis', () => {
    const base = { mode: 'even', subtotal: 73.21, taxPercent: 7.25, tipPercent: 18, people: 5 } as const
    expect(splitBill(base)).toEqual(splitBill({ ...base, tipBasis: 'subtotal' }))
  })

  it('always reports a total equal to subtotal + tax + tip', () => {
    const result = splitBill({
      mode: 'weighted',
      subtotal: 57.33,
      taxPercent: 6.5,
      tipPercent: 15,
      weights: [1, 2, 3],
    })
    expect(result.totalCents).toBe(result.subtotalCents + result.taxCents + result.tipCents)
    expect(sum(result.shares)).toBe(result.totalCents)
  })

  it('derives tax from the rounded subtotal, not the raw input', () => {
    // 10.004 rounds to 1000 cents, so 10% tax is 100 cents -- not 100.04.
    const result = splitBill({ mode: 'even', subtotal: 10.004, taxPercent: 10, tipPercent: 0, people: 1 })
    expect(result.subtotalCents).toBe(1000)
    expect(result.taxCents).toBe(100)
    expect(result.totalCents).toBe(1100)
  })

  it('handles zero tax and zero tip', () => {
    const result = splitBill({ mode: 'even', subtotal: 25, taxPercent: 0, tipPercent: 0, people: 2 })
    expect(result.taxCents).toBe(0)
    expect(result.tipCents).toBe(0)
    expect(result.totalCents).toBe(2500)
  })
})

describe('awkward fractions', () => {
  it('splits 100.01 three ways with the spare cent going to the earliest person', () => {
    const result = splitBill({ mode: 'even', subtotal: 100.01, taxPercent: 0, tipPercent: 0, people: 3 })
    expect(result.totalCents).toBe(10001)
    expect(result.shares).toEqual([3334, 3334, 3333])
    expect(sum(result.shares)).toBe(10001)
  })

  it('splits 100.01 by 1:2:1 and lands the spare cent on the largest fraction', () => {
    // Exact entitlements are 2500.25, 5000.5 and 2500.25 cents. Flooring gives
    // 10000, so one cent is spare and index 1 holds the largest fraction.
    const result = splitBill({
      mode: 'weighted',
      subtotal: 100.01,
      taxPercent: 0,
      tipPercent: 0,
      weights: [1, 2, 1],
    })
    expect(result.shares).toEqual([2500, 5001, 2500])
    expect(sum(result.shares)).toBe(result.totalCents)
  })

  it('places two spare cents by descending fraction across a 1:2:4 split', () => {
    // 10001 cents over 7 parts: fractions are 5/7, 3/7 and 6/7, so index 2
    // takes the first spare cent and index 0 the second.
    const shares = distributeCents(10001, [1, 2, 4])
    expect(shares).toEqual([1429, 2857, 5715])
    expect(sum(shares)).toBe(10001)
  })

  it('breaks an exact tie by ascending index', () => {
    expect(distributeCents(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(distributeCents(11, [1, 1, 1])).toEqual([4, 4, 3])
  })

  it('splits a repeating-decimal bill with tax and tip and still balances', () => {
    const result = splitBill({
      mode: 'weighted',
      subtotal: 33.33,
      taxPercent: 8.875,
      tipPercent: 17.5,
      weights: [1, 1, 1],
    })
    expect(result.subtotalCents).toBe(3333)
    expect(result.taxCents).toBe(296) // 3333 * 8.875% = 295.80... -> 296
    expect(result.tipCents).toBe(583) // 3333 * 17.5% = 583.275 -> 583
    expect(result.totalCents).toBe(4212)
    expect(result.shares).toEqual([1404, 1404, 1404])
    expect(sum(result.shares)).toBe(result.totalCents)
  })
})

describe('exact-sum invariant', () => {
  const lcg = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  it('holds across a wide sweep of generated bills', () => {
    const rand = lcg(20260818)
    let checked = 0

    for (let n = 0; n < 3000; n++) {
      const subtotal = Math.round(rand() * 100000) / 100
      const taxPercent = Math.round(rand() * 2000) / 100
      const tipPercent = Math.round(rand() * 3000) / 100
      const people = 1 + Math.floor(rand() * 12)
      const weights = Array.from({ length: people }, () => Math.round(rand() * 400) / 100)

      const inputs: SplitInput[] = [
        { mode: 'even', subtotal, taxPercent, tipPercent, people },
        { mode: 'even', subtotal, taxPercent, tipPercent, tipBasis: 'postTax', people },
      ]
      if (weights.some((weight) => weight > 0)) {
        inputs.push({ mode: 'weighted', subtotal, taxPercent, tipPercent, weights })
      }

      for (const input of inputs) {
        const result = splitBill(input)
        expect(sum(result.shares)).toBe(result.totalCents)
        expect(result.totalCents).toBe(result.subtotalCents + result.taxCents + result.tipCents)
        expect(result.shares.every((share) => Number.isInteger(share) && share >= 0)).toBe(true)
        if (input.mode === 'even') {
          expect(result.shares).toHaveLength(input.people)
          expect(Math.max(...result.shares) - Math.min(...result.shares)).toBeLessThanOrEqual(1)
        } else {
          expect(result.shares).toHaveLength(input.weights.length)
        }
        checked++
      }
    }

    expect(checked).toBeGreaterThan(8000)
  })

  it('stays exact for a very large bill', () => {
    const result = splitBill({
      mode: 'weighted',
      subtotal: 9_999_999.99,
      taxPercent: 8.875,
      tipPercent: 22.5,
      weights: [1, 3, 7, 11, 0.25],
    })
    expect(sum(result.shares)).toBe(result.totalCents)
  })
})

describe('determinism', () => {
  it('returns identical shares for repeated calls with the same input', () => {
    const input: SplitInput = {
      mode: 'weighted',
      subtotal: 100,
      taxPercent: 8.875,
      tipPercent: 18,
      weights: [1, 2, 3, 0.5],
    }
    const first = splitBill(input)
    for (let n = 0; n < 25; n++) {
      expect(splitBill(input)).toEqual(first)
    }
  })

  it('does not depend on the order the weights happen to be built in', () => {
    const built = [1, 2, 1].map((weight) => weight)
    expect(distributeCents(10001, built)).toEqual(distributeCents(10001, [1, 2, 1]))
  })

  it('does not mutate the caller\'s weights array', () => {
    const weights = [1, 2, 3]
    splitBill({ mode: 'weighted', subtotal: 10, taxPercent: 0, tipPercent: 0, weights })
    expect(weights).toEqual([1, 2, 3])
  })
})

describe('input validation', () => {
  it('rejects negative or non-finite money and percentages', () => {
    const base = { mode: 'even', subtotal: 10, taxPercent: 5, tipPercent: 10, people: 2 } as const
    expect(() => splitBill({ ...base, subtotal: -1 })).toThrow(RangeError)
    expect(() => splitBill({ ...base, taxPercent: -0.1 })).toThrow(RangeError)
    expect(() => splitBill({ ...base, tipPercent: Number.NaN })).toThrow(RangeError)
    expect(() => splitBill({ ...base, subtotal: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })

  it('rejects a people count that is not a positive integer', () => {
    const base = { mode: 'even', subtotal: 10, taxPercent: 0, tipPercent: 0 } as const
    expect(() => splitBill({ ...base, people: 0 })).toThrow(RangeError)
    expect(() => splitBill({ ...base, people: -3 })).toThrow(RangeError)
    expect(() => splitBill({ ...base, people: 2.5 })).toThrow(RangeError)
  })

  it('rejects weight lists that cannot describe a split', () => {
    const base = { mode: 'weighted', subtotal: 10, taxPercent: 0, tipPercent: 0 } as const
    expect(() => splitBill({ ...base, weights: [] })).toThrow(/must not be empty/)
    expect(() => splitBill({ ...base, weights: [0, 0] })).toThrow(/greater than 0/)
    expect(() => splitBill({ ...base, weights: [1, -1] })).toThrow(RangeError)
    expect(() => splitBill({ ...base, weights: [1, Number.NaN] })).toThrow(RangeError)
  })

  it('rejects a non-integer or negative cent total', () => {
    expect(() => distributeCents(10.5, [1, 1])).toThrow(RangeError)
    expect(() => distributeCents(-1, [1, 1])).toThrow(RangeError)
  })
})
