'use client'

import type { Edge, Node } from '@xyflow/react'
import { getAsset } from '@flare-studio/policy'

/**
 * The canvas, derived from the policy IR.
 *
 * Nothing in this file knows what an inheritance is, or that any particular
 * template exists. It walks the five primitives the IR is built from -- asset,
 * trigger, conditions, confidential inputs, actions -- and lays out one node per
 * primitive it actually finds.
 *
 * That is the whole point. The previous version hardcoded four nodes at four
 * fixed positions with four fixed ids, so a template with two actions, or a
 * condition, or no confidential input rendered the wrong picture. A template is
 * seed data; the canvas has to be a function of what that seed produced.
 *
 * `describe*` returns plain language on purpose. "FDC ReferencedPaymentNonexistence"
 * belongs in the under-the-hood panel, not on a node.
 */

/** The IR as the builder holds it: built, not yet parsed. */
export type DraftIr = Record<string, any>

const COLUMN = 260
const ROW = 170
const SPREAD = 320

export type CanvasGraph = { nodes: Node[]; edges: Edge[] }

export function graphFromIr(ir: DraftIr): CanvasGraph {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const asset = getAsset(ir.asset)
  nodes.push({
    id: 'asset',
    type: 'asset',
    position: { x: COLUMN, y: 0 },
    data: { symbol: asset.symbol, name: asset.name },
  })

  nodes.push({
    id: 'trigger',
    type: 'trigger',
    position: { x: COLUMN, y: ROW },
    data: describeTrigger(ir.trigger),
  })
  edges.push({ id: 'asset-trigger', source: 'asset', target: 'trigger' })

  // Conditions chain below the trigger, each gating the next. Zero conditions is
  // the common case and simply produces no nodes -- the chain head stays the
  // trigger, which is why `upstream` is tracked rather than assumed.
  let upstream = 'trigger'
  const conditions: any[] = ir.conditions ?? []
  conditions.forEach((condition, i) => {
    const id = `condition-${i}`
    nodes.push({
      id,
      type: 'condition',
      position: { x: COLUMN, y: ROW * (2 + i) },
      data: describeCondition(condition),
    })
    edges.push({ id: `${upstream}-${id}`, source: upstream, target: id })
    upstream = id
  })

  const actions: any[] = ir.actions ?? []
  const actionRow = ROW * (2 + conditions.length)

  // Confidential inputs are a property of the actions, not a fixed node: a
  // policy whose actions carry nothing private should not display a lock.
  const confidentialCount = actions.reduce(
    (sum, action) => sum + confidentialInputCount(action),
    0,
  )
  const hasConfidential = confidentialCount > 0
  if (hasConfidential) {
    nodes.push({
      id: 'confidential',
      type: 'confidential',
      position: { x: COLUMN - SPREAD, y: actionRow },
      data: { count: confidentialCount },
    })
    edges.push({
      id: `${upstream}-confidential`,
      source: upstream,
      target: 'confidential',
    })
  }

  // Actions fan out to the right of centre. One action -- overwhelmingly the
  // common case -- sits directly under the chain.
  actions.forEach((action, i) => {
    const id = `action-${i}`
    nodes.push({
      id,
      type: 'action',
      position: { x: COLUMN + (hasConfidential ? SPREAD * 0.25 : 0) + i * SPREAD, y: actionRow },
      data: describeAction(action),
    })
    edges.push({ id: `${upstream}-${id}`, source: upstream, target: id })
  })

  return { nodes, edges }
}

/** How many values in this action never leave the enclave. */
export function confidentialInputCount(action: DraftIr): number {
  switch (action.kind) {
    case 'splitTransfer':
      return action.recipients?.length ?? 0
    default:
      return 0
  }
}

export function describeTrigger(trigger: DraftIr): { title: string; summary: string } {
  switch (trigger?.kind) {
    case 'manualHeartbeat':
    case 'chainProofOfLife':
      return {
        title: 'If you stop checking in',
        summary: `After ${formatInterval(trigger.intervalSeconds)} without a check-in`,
      }
    case 'timestamp':
      return {
        title: 'On a specific date',
        summary: formatDate(trigger.executeAfter),
      }
    default:
      return { title: 'Trigger', summary: '' }
  }
}

export function describeCondition(condition: DraftIr): { title: string; summary: string } {
  switch (condition?.kind) {
    case 'priceAbove':
      return {
        title: 'Only above a price',
        summary: `Runs only while the price is over $${condition.minimumUsd}`,
      }
    default:
      return { title: 'Condition', summary: '' }
  }
}

export function describeAction(action: DraftIr): { title: string; summary: string } {
  switch (action?.kind) {
    case 'splitTransfer': {
      const n = action.recipients?.length ?? 0
      return {
        title: 'Split transfer',
        summary: `Distribute the full balance across ${n} recipient${n === 1 ? '' : 's'}`,
      }
    }
    default:
      return { title: 'Action', summary: '' }
  }
}

export function formatInterval(seconds: number): string {
  const days = Math.round(seconds / 86_400)
  if (days >= 365 && days % 365 === 0) {
    const years = days / 365
    return years === 1 ? '1 year' : `${years} years`
  }
  if (days >= 30 && days % 30 === 0) {
    const months = days / 30
    return months === 1 ? '1 month' : `${months} months`
  }
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * Dates are formatted in a fixed locale, deliberately.
 *
 * `toLocaleDateString(undefined, ...)` resolves to the *server's* locale during
 * SSR and the *browser's* on hydration, so a date rendered by both sides
 * disagrees with itself -- "August 14, 2027" against "14 August 2027" -- and
 * React discards the server tree. Pinning the locale is what makes the two
 * halves agree; it is not a formatting preference.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function formatDate(unixSeconds: number): string {
  return DATE_FORMAT.format(new Date(unixSeconds * 1000))
}
