/**
 * Pure split calculation.
 *
 * Scaffold only: the even/weighted share logic lands here next. Money is
 * carried as integer cents throughout so shares can sum exactly to the total.
 */

/** Round a currency amount to whole cents, away from zero on a .5 tie. */
export function toCents(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount) * 100)
}
