'use client'

import { getAsset, type SupportedAsset } from '@flare-studio/policy'
import type { DraftIr } from './canvas'

/**
 * What a user may choose and configure, as data.
 *
 * The builder used to render whatever trigger the template baked in, read-only,
 * which made the template the source of truth for the life of the draft. It is
 * meant to be seed data. So the shape of every trigger -- its plain-language
 * name, its editable fields, and sensible defaults -- lives here, and the editor
 * renders whatever it finds rather than knowing any kind by name.
 *
 * Adding a trigger is now: a contract, one arm in `configureRequest`, and one
 * entry below. Nothing in the canvas, the inspector or the editor changes.
 *
 * Defaults take the asset because several of them genuinely depend on it -- the
 * FDC source chain and a sensible minimum payment are properties of the asset,
 * not of the trigger, and `assets.ts` is already the one place that knows them.
 */

export type TriggerField =
  | { key: string; label: string; input: 'duration'; help?: string }
  | { key: string; label: string; input: 'date'; help?: string }
  | { key: string; label: string; input: 'text'; placeholder?: string; help?: string }
  | { key: string; label: string; input: 'amount'; help?: string }
  | { key: string; label: string; input: 'toggle'; help?: string }

export type TriggerKindSpec = {
  kind: string
  /** Plain language, as it appears in the picker. No protocol vocabulary. */
  label: string
  summary: string
  fields: TriggerField[]
  defaults: (asset: SupportedAsset) => DraftIr
  /**
   * Set when the kind is not deployable yet. Shown as a disabled option rather
   * than hidden, because a user choosing between three options should be able to
   * see the one they cannot have and why.
   */
  unavailable?: string
}

const YEAR = 365 * 86_400

export const TRIGGER_KINDS: TriggerKindSpec[] = [
  {
    kind: 'manualHeartbeat',
    label: 'If you stop checking in',
    summary: 'You check in on this site. Missing a deadline runs the policy.',
    fields: [
      {
        key: 'intervalSeconds',
        label: 'Check in every',
        input: 'duration',
        help: 'How long you may go without checking in before the policy can run.',
      },
      {
        key: 'demoMode',
        label: 'Demo control',
        input: 'toggle',
        help: 'Allows the deadline to be pulled into the past so the policy can be demonstrated without waiting. Leave this off for a policy holding funds you care about.',
      },
    ],
    defaults: () => ({ kind: 'manualHeartbeat', intervalSeconds: YEAR, demoMode: false }),
  },
  {
    kind: 'chainProofOfLife',
    label: 'If you stop sending a payment',
    summary:
      'You send a small payment on the asset’s own chain. The protocol proves the absence of one.',
    fields: [
      { key: 'intervalSeconds', label: 'Pay every', input: 'duration' },
      {
        key: 'destinationAddress',
        label: 'Pay to',
        input: 'text',
        placeholder: 'r… (an address on the source chain)',
        help: 'Where your proof-of-life payment is sent. It can be your own wallet — only the payment’s existence matters.',
      },
      {
        key: 'minimumAmount',
        label: 'At least',
        input: 'amount',
        help: 'Large enough to be unambiguous, small enough not to matter.',
      },
    ],
    defaults: (asset) => ({
      kind: 'chainProofOfLife',
      intervalSeconds: YEAR,
      sourceId: asset.fdcSourceId,
      destinationAddress: '',
      minimumAmount: asset.minimumHeartbeat.toString(),
    }),
  },
  {
    kind: 'timestamp',
    label: 'On a specific date',
    summary: 'The policy runs once that date has passed.',
    fields: [{ key: 'executeAfter', label: 'Runs on', input: 'date' }],
    defaults: () => ({
      kind: 'timestamp',
      executeAfter: Math.floor(Date.now() / 1000) + YEAR,
    }),
  },
]

export function triggerSpec(kind: string): TriggerKindSpec | undefined {
  return TRIGGER_KINDS.find((t) => t.kind === kind)
}

/**
 * Switch a draft to a different trigger kind, keeping what still applies.
 *
 * An interval means the same thing to a check-in trigger and a payment trigger,
 * so changing between them should not silently reset it. Anything the new kind
 * does not have a field for is dropped, which is what stops a stale
 * `destinationAddress` riding along into a timestamp trigger and confusing the
 * compiler.
 */
export function switchTriggerKind(current: DraftIr, kind: string, assetSymbol: string): DraftIr {
  const spec = triggerSpec(kind)
  if (!spec) return current

  const next = spec.defaults(getAsset(assetSymbol))
  for (const field of spec.fields) {
    const carried = current?.[field.key]
    if (carried !== undefined && carried !== '' && field.key !== 'kind') {
      next[field.key] = carried
    }
  }
  return next
}

/** Seconds to the `{ value, unit }` a duration input edits, choosing the coarsest exact unit. */
export function splitDuration(seconds: number): { value: number; unit: 'days' | 'months' | 'years' } {
  const days = Math.max(1, Math.round(seconds / 86_400))
  if (days % 365 === 0) return { value: days / 365, unit: 'years' }
  if (days % 30 === 0) return { value: days / 30, unit: 'months' }
  return { value: days, unit: 'days' }
}

export function joinDuration(value: number, unit: 'days' | 'months' | 'years'): number {
  const days = unit === 'years' ? value * 365 : unit === 'months' ? value * 30 : value
  return Math.max(1, Math.round(days)) * 86_400
}
