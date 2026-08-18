import './style.css'
import { fromCents, splitBill, type SplitInput, type SplitResult } from './split'

interface Person {
  id: number
  name: string
  weight: number
}

/** A user-facing reason the current form cannot be split, plus the field at fault. */
interface Problem {
  message: string
  field?: HTMLElement
}

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

/**
 * Shares are recomputed on every keystroke, but a screen reader should not hear
 * a new total per character. The visible receipt updates immediately; the live
 * region waits for typing to settle.
 */
const ANNOUNCE_DELAY_MS = 700

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`The page is missing ${selector}`)
  }
  return element
}

const form = must<HTMLFormElement>('#bill-form')
const subtotalInput = must<HTMLInputElement>('#subtotal')
const taxInput = must<HTMLInputElement>('#tax')
const tipInput = must<HTMLInputElement>('#tip')
const tipBasisSelect = must<HTMLSelectElement>('#tip-basis')
const peopleList = must<HTMLUListElement>('#people')
const emptyNote = must<HTMLParagraphElement>('#people-empty')
const addButton = must<HTMLButtonElement>('#add-person')
const modeHint = must<HTMLParagraphElement>('#mode-hint')
const errorNote = must<HTMLParagraphElement>('#error')
const liveSummary = must<HTMLParagraphElement>('#live-summary')
const rowTemplate = must<HTMLTemplateElement>('#person-template')

const receiptLines = must<HTMLDivElement>('#receipt-lines')
const receiptTotal = must<HTMLDivElement>('#receipt-total')
const receiptShares = must<HTMLOListElement>('#receipt-shares')
const receiptStamp = must<HTMLParagraphElement>('#receipt-stamp')
const receiptFoot = must<HTMLParagraphElement>('#receipt-foot')

const people: Person[] = []
let nextId = 1
let announceTimer: number | undefined
let flaggedField: HTMLElement | undefined

function currentMode(): 'even' | 'weighted' {
  const checked = form.querySelector<HTMLInputElement>('input[name="mode"]:checked')
  return checked?.value === 'weighted' ? 'weighted' : 'even'
}

/** Empty means zero; anything unparseable stays NaN so validation can catch it. */
function readAmount(input: HTMLInputElement): number {
  const raw = input.value.trim()
  return raw === '' ? 0 : Number(raw)
}

function displayName(person: Person, index: number): string {
  return person.name.trim() || `Guest ${index + 1}`
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '0'
}

function findPerson(row: HTMLElement): Person | undefined {
  return people.find((person) => String(person.id) === row.dataset['id'])
}

function buildRow(person: Person): HTMLLIElement {
  const fragment = rowTemplate.content.cloneNode(true) as DocumentFragment
  const row = fragment.firstElementChild as HTMLLIElement
  row.dataset['id'] = String(person.id)

  const name = row.querySelector<HTMLInputElement>('.person__name')
  const weight = row.querySelector<HTMLInputElement>('.person__weight')
  if (name) name.value = person.name
  if (weight) weight.value = String(person.weight)

  return row
}

/** Keep every row's labels, numbering and weight visibility in step with state. */
function syncRows(): void {
  const weighted = currentMode() === 'weighted'
  const rows = Array.from(peopleList.children)

  rows.forEach((row, index) => {
    const person = people[index]
    if (!(row instanceof HTMLElement) || !person) return

    const label = displayName(person, index)
    row.querySelector('.person__name')?.setAttribute('aria-label', `Name for guest ${index + 1}`)
    row.querySelector('.person__remove')?.setAttribute('aria-label', `Remove ${label}`)

    const weight = row.querySelector<HTMLInputElement>('.person__weight')
    if (weight) {
      weight.hidden = !weighted
      weight.setAttribute('aria-label', `Weight for ${label}`)
    }
  })

  modeHint.textContent = weighted
    ? 'Weights are relative — a 2 pays twice what a 1 pays.'
    : 'Everyone pays the same, give or take a cent.'
}

function line(label: string, value: string, options: { tag?: 'div' | 'li' } = {}): HTMLElement {
  const row = document.createElement(options.tag ?? 'div')
  row.className = 'line'

  const labelEl = document.createElement('span')
  labelEl.className = 'line__label'
  labelEl.textContent = label

  const leader = document.createElement('span')
  leader.className = 'line__leader'
  leader.setAttribute('aria-hidden', 'true')

  const valueEl = document.createElement('span')
  valueEl.className = 'line__value'
  valueEl.textContent = value

  row.append(labelEl, leader, valueEl)
  return row
}

function renderReceipt(result: SplitResult | null): void {
  receiptLines.replaceChildren()
  receiptTotal.replaceChildren()
  receiptShares.replaceChildren()

  if (!result) {
    receiptLines.append(line('Subtotal', '—'), line('Tax', '—'), line('Tip', '—'))
    receiptTotal.append(line('Total', '—'))
    receiptStamp.hidden = true
    receiptFoot.textContent = 'Nothing to split yet'
    return
  }

  const taxLabel = `Tax ${formatPercent(readAmount(taxInput))}%`
  const tipLabel = `Tip ${formatPercent(readAmount(tipInput))}%`
  receiptLines.append(
    line('Subtotal', money.format(fromCents(result.subtotalCents))),
    line(taxLabel, money.format(fromCents(result.taxCents))),
    line(tipLabel, money.format(fromCents(result.tipCents))),
  )
  receiptTotal.append(line('Total', money.format(fromCents(result.totalCents))))

  people.forEach((person, index) => {
    const cents = result.shares[index] ?? 0
    receiptShares.append(
      line(displayName(person, index), money.format(fromCents(cents)), { tag: 'li' }),
    )
  })

  // Stated rather than assumed: the figure is re-derived from what is on screen.
  const paid = result.shares.reduce((running, share) => running + share, 0)
  const balanced = paid === result.totalCents
  receiptStamp.hidden = false
  receiptStamp.classList.toggle('receipt__stamp--off', !balanced)
  receiptStamp.textContent = balanced
    ? `✓ Shares add up to ${money.format(fromCents(result.totalCents))} exactly`
    : `Shares are off by ${money.format(fromCents(paid - result.totalCents))}`

  const ways = people.length === 1 ? 'way' : 'ways'
  const style = currentMode() === 'weighted' ? 'By weight' : 'Even'
  receiptFoot.textContent = `Split ${people.length} ${ways} · ${style}`
}

function validate(): Problem | null {
  if (!(readAmount(subtotalInput) >= 0)) {
    return { message: 'Enter a bill amount of 0 or more.', field: subtotalInput }
  }
  if (!(readAmount(taxInput) >= 0)) {
    return { message: 'Enter a tax rate of 0 or more.', field: taxInput }
  }
  if (!(readAmount(tipInput) >= 0)) {
    return { message: 'Enter a tip rate of 0 or more.', field: tipInput }
  }
  if (currentMode() === 'weighted') {
    const bad = people.findIndex((person) => !(person.weight >= 0))
    if (bad !== -1) {
      const person = people[bad]
      const name = person ? displayName(person, bad) : 'that person'
      return { message: `Enter a weight of 0 or more for ${name}.` }
    }
    if (!people.some((person) => person.weight > 0)) {
      return { message: 'Give at least one person a weight above zero.' }
    }
  }
  return null
}

function showProblem(problem: Problem | null): void {
  flaggedField?.removeAttribute('aria-invalid')
  flaggedField = undefined

  if (!problem) {
    errorNote.hidden = true
    errorNote.textContent = ''
    return
  }

  errorNote.hidden = false
  errorNote.textContent = problem.message
  if (problem.field) {
    problem.field.setAttribute('aria-invalid', 'true')
    flaggedField = problem.field
  }
}

function announce(text: string): void {
  window.clearTimeout(announceTimer)
  announceTimer = window.setTimeout(() => {
    liveSummary.textContent = text
  }, ANNOUNCE_DELAY_MS)
}

function summarise(result: SplitResult): string {
  const low = money.format(fromCents(Math.min(...result.shares)))
  const high = money.format(fromCents(Math.max(...result.shares)))
  const spread = low === high ? `${low} each` : `${low} to ${high}`
  const count = `${people.length} ${people.length === 1 ? 'share' : 'shares'}`
  return `Total ${money.format(fromCents(result.totalCents))}. ${count}, ${spread}.`
}

function currentInput(): SplitInput {
  const shared = {
    subtotal: readAmount(subtotalInput),
    taxPercent: readAmount(taxInput),
    tipPercent: readAmount(tipInput),
    tipBasis: tipBasisSelect.value === 'postTax' ? ('postTax' as const) : ('subtotal' as const),
  }
  return currentMode() === 'weighted'
    ? { ...shared, mode: 'weighted', weights: people.map((person) => person.weight) }
    : { ...shared, mode: 'even', people: people.length }
}

function render(): void {
  syncRows()
  emptyNote.hidden = people.length > 0

  if (people.length === 0) {
    showProblem(null)
    renderReceipt(null)
    announce('Add someone to start splitting.')
    return
  }

  const problem = validate()
  if (problem) {
    showProblem(problem)
    renderReceipt(null)
    announce(problem.message)
    return
  }

  try {
    const result = splitBill(currentInput())
    showProblem(null)
    renderReceipt(result)
    announce(summarise(result))
  } catch (error) {
    // The checks above should have caught anything splitBill rejects; if one is
    // ever missed, say so plainly rather than leaving stale figures on screen.
    showProblem({ message: error instanceof Error ? error.message : String(error) })
    renderReceipt(null)
  }
}

function addPerson(options: { focus: boolean }): void {
  const person: Person = { id: nextId++, name: '', weight: 1 }
  people.push(person)

  const row = buildRow(person)
  peopleList.append(row)
  render()

  if (options.focus) {
    row.querySelector<HTMLInputElement>('.person__name')?.focus()
  }
}

function removePerson(row: HTMLElement): void {
  const index = people.findIndex((person) => String(person.id) === row.dataset['id'])
  if (index === -1) return

  // Chosen before the row leaves the DOM: focus falls to the next person's
  // remove button, or the previous one at the end of the list.
  const rows = Array.from(peopleList.children)
  const neighbour = rows[index + 1] ?? rows[index - 1]

  people.splice(index, 1)
  row.remove()
  render()

  const target = neighbour?.querySelector<HTMLButtonElement>('.person__remove')
  ;(target ?? addButton).focus()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
})

form.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement) {
    const row = target.closest<HTMLLIElement>('.person')
    const person = row ? findPerson(row) : undefined
    if (person) {
      if (target.classList.contains('person__name')) person.name = target.value
      if (target.classList.contains('person__weight')) person.weight = readAmount(target)
    }
  }
  render()
})

peopleList.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('.person__remove') : null
  const row = button?.closest<HTMLLIElement>('.person')
  if (row) removePerson(row)
})

addButton.addEventListener('click', () => {
  addPerson({ focus: true })
})

for (let seat = 0; seat < 3; seat++) {
  addPerson({ focus: false })
}
render()
