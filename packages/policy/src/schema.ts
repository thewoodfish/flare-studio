import { z } from 'zod'

/**
 * The policy intermediate representation.
 *
 * A policy is: an asset, one trigger, zero or more conditions, and one or more
 * actions. Nothing in this file mentions inheritance, and nothing should. A
 * template is seed data that produces one of these -- not a variant of it.
 *
 * The discriminated unions below are the extension points. Adding a template
 * should mean adding a member to one of them, never adding a field to
 * PolicyIR itself. If a new template needs a new top-level field, the
 * abstraction has leaked.
 */

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address')

/** Positive integer amount in the asset's smallest unit, as a decimal string. */
const amountSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'must be a positive integer in the asset base unit')

// --- triggers ---------------------------------------------------------------

/**
 * Proof-of-life via an on-chain check-in. The demo fallback, and the first
 * trigger built -- it lets the whole product work end to end before FDC lands.
 */
const manualHeartbeatTrigger = z.object({
  kind: z.literal('manualHeartbeat'),
  intervalSeconds: z.number().int().positive(),
  demoMode: z.boolean().default(false),
})

/**
 * Proof-of-life via an external-chain payment. The owner sends a small payment
 * carrying the policy's own reference before each deadline; FDC's
 * ReferencedPaymentNonexistence proves the absence if they stop.
 *
 * `sourceId` is configuration, not a constant: FDC supports XRP, BTC and DOGE,
 * so this same trigger generalises to every chain we can hold as an FAsset.
 */
const chainProofOfLifeTrigger = z.object({
  kind: z.literal('chainProofOfLife'),
  intervalSeconds: z.number().int().positive(),
  sourceId: z.string(),
  destinationAddress: z.string(),
  minimumAmount: amountSchema,
})

/** An absolute date. This is what makes a scheduled-distribution template free. */
const timestampTrigger = z.object({
  kind: z.literal('timestamp'),
  executeAfter: z.number().int().positive(),
})

export const triggerSchema = z.discriminatedUnion('kind', [
  manualHeartbeatTrigger,
  chainProofOfLifeTrigger,
  timestampTrigger,
])

// --- conditions -------------------------------------------------------------

const priceAboveCondition = z.object({
  kind: z.literal('priceAbove'),
  feedId: z.string(),
  minimumUsd: z.number().positive(),
})

export const conditionSchema = z.discriminatedUnion('kind', [priceAboveCondition])

// --- actions ----------------------------------------------------------------

/**
 * Split the balance among recipients by basis points.
 *
 * Proportions rather than fixed amounts, because the balance at execution time
 * is not knowable when the policy is written -- the whole point is that it fires
 * at some unknown future moment.
 */
const splitTransferAction = z.object({
  kind: z.literal('splitTransfer'),
  recipients: z
    .array(
      z.object({
        address: addressSchema,
        /** Basis points. Confidential: never leaves the enclave. */
        shareBps: z.number().int().min(1).max(10_000),
        /** Display only, for the owner's own reference. Confidential. */
        label: z.string().max(120).optional(),
      }),
    )
    .min(1),
})

export const actionSchema = z.discriminatedUnion('kind', [splitTransferAction])

// --- policy -----------------------------------------------------------------

export const policyIrSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    /** Symbol into the asset registry -- never a raw token address in the IR. */
    asset: z.string(),
    trigger: triggerSchema,
    conditions: z.array(conditionSchema).default([]),
    actions: z.array(actionSchema).min(1),
  })
  .superRefine((policy, ctx) => {
    for (const [i, action] of policy.actions.entries()) {
      if (action.kind !== 'splitTransfer') continue

      const total = action.recipients.reduce((sum, r) => sum + r.shareBps, 0)
      if (total !== 10_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actions', i, 'recipients'],
          message: `shares must total 100% (10000 bps), got ${total}`,
        })
      }

      const seen = new Set<string>()
      for (const [j, r] of action.recipients.entries()) {
        const key = r.address.toLowerCase()
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['actions', i, 'recipients', j, 'address'],
            message: 'duplicate recipient: combine into a single share instead',
          })
        }
        seen.add(key)
      }
    }
  })

export type PolicyIR = z.infer<typeof policyIrSchema>
export type Trigger = z.infer<typeof triggerSchema>
export type Condition = z.infer<typeof conditionSchema>
export type Action = z.infer<typeof actionSchema>
