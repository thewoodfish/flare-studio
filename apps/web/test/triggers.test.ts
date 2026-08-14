import { describe, expect, it } from 'vitest'
import { getAsset, policyIrSchema } from '@flare-studio/policy'
import {
  TRIGGER_KINDS,
  joinDuration,
  splitDuration,
  switchTriggerKind,
  triggerSpec,
} from '../lib/triggers'

/**
 * The catalogue is the contract between the builder and the schema.
 *
 * A trigger the user can select must be one the compiler accepts, and a field
 * they can edit must be one the trigger actually has. Both are easy to get
 * subtly wrong -- a renamed schema field leaves an editor writing a key nothing
 * reads, and the policy fails to compile only at the review step.
 */

const FXRP = getAsset('FXRP')

/** The catalogue's defaults, wrapped in an otherwise valid policy. */
function policyWith(trigger: unknown) {
  return {
    version: 1,
    name: 'Test policy',
    asset: 'FXRP',
    trigger,
    conditions: [],
    actions: [
      {
        kind: 'splitTransfer',
        recipients: [{ address: '0x1111111111111111111111111111111111111111', shareBps: 10_000 }],
      },
    ],
  }
}

describe('TRIGGER_KINDS', () => {
  it('covers every trigger kind the schema accepts', () => {
    // Derived from the schema rather than listed, so a new kind added there
    // fails here until it is offered to users -- which is the whole point of a
    // builder that is generic over triggers.
    const schemaKinds = new Set(
      policyIrSchema._def.schema.shape.trigger._def.options.map(
        (o: any) => o.shape.kind._def.value as string,
      ),
    )
    const offered = new Set(TRIGGER_KINDS.map((t) => t.kind))
    expect(offered).toEqual(schemaKinds)
  })

  it('has defaults that compile, for every kind', () => {
    for (const spec of TRIGGER_KINDS) {
      const trigger = spec.defaults(FXRP)
      const result = policyIrSchema.safeParse(policyWith(trigger))

      // chainProofOfLife defaults to an empty destination on purpose -- the user
      // must supply it -- so it is the one kind allowed to start invalid.
      if (spec.kind === 'chainProofOfLife') {
        expect(trigger.sourceId).toBe(FXRP.fdcSourceId)
        expect(trigger.destinationAddress).toBe('')
        continue
      }
      expect(result.success, `${spec.kind} defaults do not parse`).toBe(true)
    }
  })

  it('only offers fields the kind actually carries', () => {
    for (const spec of TRIGGER_KINDS) {
      const trigger = spec.defaults(FXRP)
      for (const field of spec.fields) {
        expect(
          Object.hasOwn(trigger, field.key),
          `${spec.kind} offers "${field.key}" but its defaults do not have it`,
        ).toBe(true)
      }
    }
  })

  it('speaks plain language in the picker', () => {
    const copy = JSON.stringify(TRIGGER_KINDS.map((t) => [t.label, t.summary]))
    for (const jargon of ['FDC', 'FTSO', 'attestation', 'Nonexistence', 'oracle']) {
      expect(copy).not.toContain(jargon)
    }
  })
})

describe('switchTriggerKind', () => {
  it('carries the interval across kinds that both have one', () => {
    const from = { kind: 'manualHeartbeat', intervalSeconds: 30 * 86_400, demoMode: true }
    const to = switchTriggerKind(from, 'chainProofOfLife', 'FXRP')

    expect(to.kind).toBe('chainProofOfLife')
    expect(to.intervalSeconds).toBe(30 * 86_400)
  })

  /**
   * A stale field riding along is worse than a reset one: the compiler would
   * see a timestamp trigger carrying a destination address and the schema would
   * reject a policy the user believes they configured correctly.
   */
  it('drops fields the new kind does not have', () => {
    const from = {
      kind: 'chainProofOfLife',
      intervalSeconds: 86_400,
      sourceId: 'testXRP',
      destinationAddress: 'rSomeone',
      minimumAmount: '100000',
    }
    const to = switchTriggerKind(from, 'timestamp', 'FXRP')

    expect(to).not.toHaveProperty('destinationAddress')
    expect(to).not.toHaveProperty('intervalSeconds')
    expect(to.kind).toBe('timestamp')
    expect(policyIrSchema.safeParse(policyWith(to)).success).toBe(true)
  })

  it('takes the source chain from the asset, not from the previous trigger', () => {
    const to = switchTriggerKind({ kind: 'timestamp', executeAfter: 1 }, 'chainProofOfLife', 'FXRP')
    expect(to.sourceId).toBe(FXRP.fdcSourceId)
  })

  it('leaves the draft alone for a kind it does not know', () => {
    const from = { kind: 'manualHeartbeat', intervalSeconds: 1 }
    expect(switchTriggerKind(from, 'inventedKind', 'FXRP')).toBe(from)
  })

  it('does not carry an empty string over a real default', () => {
    const from = { kind: 'chainProofOfLife', destinationAddress: '' }
    const to = switchTriggerKind(from, 'chainProofOfLife', 'FXRP')
    expect(to.minimumAmount).toBe(FXRP.minimumHeartbeat.toString())
  })
})

describe('duration round trip', () => {
  it.each([
    [365 * 86_400, 1, 'years'],
    [2 * 365 * 86_400, 2, 'years'],
    [30 * 86_400, 1, 'months'],
    [90 * 86_400, 3, 'months'],
    [86_400, 1, 'days'],
    [5 * 86_400, 5, 'days'],
  ])('%i seconds splits to %i %s', (seconds, value, unit) => {
    expect(splitDuration(seconds)).toEqual({ value, unit })
    expect(joinDuration(value, unit as 'days' | 'months' | 'years')).toBe(seconds)
  })

  /** The editor must never produce a zero interval; the schema rejects it. */
  it('never produces less than a day', () => {
    expect(joinDuration(0, 'days')).toBe(86_400)
    expect(splitDuration(0).value).toBeGreaterThan(0)
  })
})

describe('triggerSpec', () => {
  it('finds a known kind and returns nothing for an unknown one', () => {
    expect(triggerSpec('timestamp')?.label).toBeTruthy()
    expect(triggerSpec('nope')).toBeUndefined()
  })
})
