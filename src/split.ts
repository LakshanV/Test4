/**
 * Pure split calculation.
 *
 * Every amount is carried as integer cents once it enters this module, so the
 * per-person shares can be proven to sum exactly to the computed total. The
 * only floating point work happens at the edges: converting the caller's
 * currency amounts to cents, and converting percentages to cent amounts.
 */

export type SplitMode = 'even' | 'weighted'

/**
 * What the tip percentage applies to. Both conventions are in real-world use,
 * so the caller picks; `'subtotal'` (tip on the pre-tax amount) is the default.
 */
export type TipBasis = 'subtotal' | 'postTax'

interface SplitInputBase {
  /** Pre-tax, pre-tip bill amount, in currency units (e.g. 84.5 for $84.50). */
  subtotal: number
  /** Tax rate as a percentage, e.g. 8.875 for 8.875%. */
  taxPercent: number
  /** Tip rate as a percentage, e.g. 20 for 20%. */
  tipPercent: number
  /** Defaults to `'subtotal'`. */
  tipBasis?: TipBasis
}

export interface EvenSplitInput extends SplitInputBase {
  mode: 'even'
  /** Number of people sharing the bill; must be a positive integer. */
  people: number
}

export interface WeightedSplitInput extends SplitInputBase {
  mode: 'weighted'
  /**
   * One relative weight per person. Weights need not sum to anything in
   * particular; only their ratios matter. A weight of 0 always yields a 0
   * share. At least one weight must be greater than 0.
   */
  weights: readonly number[]
}

export type SplitInput = EvenSplitInput | WeightedSplitInput

export interface SplitResult {
  subtotalCents: number
  taxCents: number
  tipCents: number
  /** `subtotalCents + taxCents + tipCents`. Always equals the sum of `shares`. */
  totalCents: number
  /** Per-person share in cents, index-aligned with the input people/weights. */
  shares: number[]
}

/**
 * Weights are quantised to this many units before the integer arithmetic runs,
 * which keeps the remainder comparison exact. Two weights closer together than
 * 1e-6 are therefore treated as equal.
 */
const WEIGHT_PRECISION = 1_000_000

function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Round a currency amount to whole cents, away from zero on a .5 tie. */
export function toCents(amount: number): number {
  // Scaling by 100 can land just short of a .5 boundary that the decimal value
  // sits exactly on -- 1.005 * 100 is 100.49999999999999 -- which would round
  // the wrong way. Collapsing to 12 significant digits first discards that
  // representation error while leaving any real difference intact.
  return roundHalfAwayFromZero(Number((amount * 100).toPrecision(12)))
}

/** Convert whole cents back to a currency amount. */
export function fromCents(cents: number): number {
  return cents / 100
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite number >= 0, received ${value}`)
  }
}

/**
 * Split `totalCents` across `weights` using the largest-remainder method, so
 * the returned shares sum to exactly `totalCents`.
 *
 * Each person's exact entitlement is `totalCents * weight / sumOfWeights`.
 * Everyone first receives the floor of that, which leaves a leftover of fewer
 * cents than there are people; those cents go one each to the people with the
 * largest truncated fraction, ties broken by ascending index. That makes the
 * result a deterministic function of the inputs alone, with no dependence on
 * floating point ordering.
 */
export function distributeCents(totalCents: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new RangeError(`totalCents must be a non-negative integer, received ${totalCents}`)
  }
  if (weights.length === 0) {
    throw new RangeError('weights must not be empty')
  }

  const units = weights.map((weight, index) => {
    assertNonNegative(weight, `weights[${index}]`)
    return Math.round(weight * WEIGHT_PRECISION)
  })
  const totalUnits = units.reduce((sum, unit) => sum + unit, 0)
  if (totalUnits <= 0) {
    throw new RangeError('weights must include at least one weight greater than 0')
  }

  // BigInt keeps `totalCents * unit` exact no matter how large the bill or how
  // finely the weights are expressed.
  const total = BigInt(totalCents)
  const divisor = BigInt(totalUnits)

  const shares: number[] = []
  const remainders: bigint[] = []
  let allocated = 0

  for (const unit of units) {
    const exact = total * BigInt(unit)
    const share = Number(exact / divisor)
    shares.push(share)
    remainders.push(exact % divisor)
    allocated += share
  }

  const byRemainderDesc = shares
    .map((_, index) => index)
    .sort((a, b) => {
      const left = remainders[a] ?? 0n
      const right = remainders[b] ?? 0n
      if (left > right) return -1
      if (left < right) return 1
      return a - b
    })

  // A person with a zero remainder is never reached here: the leftover equals
  // the sum of the truncated fractions, which is bounded by the number of
  // people who have one. Zero-weight people therefore always pay exactly 0.
  let leftover = totalCents - allocated
  for (const index of byRemainderDesc) {
    if (leftover <= 0) break
    shares[index] = (shares[index] ?? 0) + 1
    leftover -= 1
  }

  return shares
}

function weightsFor(input: SplitInput): readonly number[] {
  if (input.mode === 'weighted') {
    return input.weights
  }
  if (!Number.isInteger(input.people) || input.people < 1) {
    throw new RangeError(`people must be a positive integer, received ${input.people}`)
  }
  return Array.from({ length: input.people }, () => 1)
}

/**
 * Compute the tax, tip, total and per-person shares for a bill.
 *
 * Tax and tip are derived from the rounded subtotal rather than the raw input,
 * so no sub-cent amount that rounding discarded can reappear as tax or tip.
 */
export function splitBill(input: SplitInput): SplitResult {
  assertNonNegative(input.subtotal, 'subtotal')
  assertNonNegative(input.taxPercent, 'taxPercent')
  assertNonNegative(input.tipPercent, 'tipPercent')

  const subtotalCents = toCents(input.subtotal)
  const taxCents = roundHalfAwayFromZero((subtotalCents * input.taxPercent) / 100)
  const tipBase = input.tipBasis === 'postTax' ? subtotalCents + taxCents : subtotalCents
  const tipCents = roundHalfAwayFromZero((tipBase * input.tipPercent) / 100)
  const totalCents = subtotalCents + taxCents + tipCents

  return {
    subtotalCents,
    taxCents,
    tipCents,
    totalCents,
    shares: distributeCents(totalCents, weightsFor(input)),
  }
}
