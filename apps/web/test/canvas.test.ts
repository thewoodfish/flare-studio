import { describe, expect, it } from 'vitest'
import {
  graphFromIr,
  confidentialInputCount,
  describeTrigger,
  formatDate,
  formatInterval,
  type DraftIr,
} from '../lib/canvas'

/**
 * The canvas is where the platform claim is either true or decorative.
 *
 * Every policy in the product today is asset + trigger + one action, which is
 * also the shape the old hardcoded canvas assumed. So the tests that matter are
 * the ones for policies no shipped template produces: two actions, a condition,
 * nothing confidential. If those draw correctly, the canvas is a function of the
 * IR. If they do not, it is an inheritance renderer with extra steps.
 */

const heartbeat = { kind: 'manualHeartbeat', intervalSeconds: 365 * 86_400, demoMode: false }

function ir(overrides: DraftIr = {}): DraftIr {
  return {
    version: 1,
    name: 'Test policy',
    asset: 'FXRP',
    trigger: heartbeat,
    conditions: [],
    actions: [
      {
        kind: 'splitTransfer',
        recipients: [
          { address: '0x1111111111111111111111111111111111111111', shareBps: 10_000 },
        ],
      },
    ],
    ...overrides,
  }
}

const ids = (g: ReturnType<typeof graphFromIr>) => g.nodes.map((n) => n.id)

describe('graphFromIr', () => {
  it('draws the common shape: asset, trigger, confidential, one action', () => {
    const g = graphFromIr(ir())
    expect(ids(g)).toEqual(['asset', 'trigger', 'confidential', 'action-0'])
    expect(g.edges).toHaveLength(3)
  })

  /**
   * React Flow silently drops duplicates, so a collision shows up as a missing
   * node rather than an error. Asserted over a deliberately awkward policy.
   */
  it('never emits a duplicate node or edge id', () => {
    const g = graphFromIr(
      ir({
        conditions: [
          { kind: 'priceAbove', feedId: 'x', minimumUsd: 1 },
          { kind: 'priceAbove', feedId: 'y', minimumUsd: 2 },
        ],
        actions: [
          { kind: 'splitTransfer', recipients: [{ address: '0x1', shareBps: 5000 }] },
          { kind: 'splitTransfer', recipients: [{ address: '0x2', shareBps: 5000 }] },
        ],
      }),
    )
    expect(new Set(ids(g)).size).toBe(g.nodes.length)
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length)
  })

  /** A policy whose actions carry nothing private must not display a lock. */
  it('omits the confidential node when no action carries private inputs', () => {
    const g = graphFromIr(ir({ actions: [{ kind: 'notifyOnly' }] }))
    expect(ids(g)).not.toContain('confidential')
    expect(ids(g)).toEqual(['asset', 'trigger', 'action-0'])
  })

  it('counts confidential inputs across every action, not just the first', () => {
    const g = graphFromIr(
      ir({
        actions: [
          { kind: 'splitTransfer', recipients: [{ address: '0x1', shareBps: 5000 }] },
          {
            kind: 'splitTransfer',
            recipients: [
              { address: '0x2', shareBps: 2500 },
              { address: '0x3', shareBps: 2500 },
            ],
          },
        ],
      }),
    )
    expect(g.nodes.find((n) => n.id === 'confidential')?.data).toEqual({ count: 3 })
  })

  /**
   * Conditions gate each other in sequence, and the actions must hang off the
   * *last* one. Attaching them to the trigger would draw a policy that executes
   * whether or not its conditions hold.
   */
  it('chains conditions and hangs the actions off the last one', () => {
    const g = graphFromIr(
      ir({
        conditions: [
          { kind: 'priceAbove', feedId: 'x', minimumUsd: 1 },
          { kind: 'priceAbove', feedId: 'y', minimumUsd: 2 },
        ],
      }),
    )
    expect(ids(g)).toEqual([
      'asset',
      'trigger',
      'condition-0',
      'condition-1',
      'confidential',
      'action-0',
    ])
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'trigger', target: 'condition-0' }),
    )
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'condition-0', target: 'condition-1' }),
    )
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'condition-1', target: 'action-0' }),
    )
  })

  it('gives every action its own node and edge', () => {
    const g = graphFromIr(
      ir({
        actions: [
          { kind: 'splitTransfer', recipients: [{ address: '0x1', shareBps: 5000 }] },
          { kind: 'splitTransfer', recipients: [{ address: '0x2', shareBps: 5000 }] },
          { kind: 'splitTransfer', recipients: [{ address: '0x3', shareBps: 0 }] },
        ],
      }),
    )
    expect(ids(g).filter((id) => id.startsWith('action-'))).toEqual([
      'action-0',
      'action-1',
      'action-2',
    ])
    // Fanned out rather than stacked, or they would render on top of each other.
    const xs = g.nodes.filter((n) => n.id.startsWith('action-')).map((n) => n.position.x)
    expect(new Set(xs).size).toBe(3)
  })

  it('survives a policy with no actions at all', () => {
    const g = graphFromIr(ir({ actions: [] }))
    expect(ids(g)).toEqual(['asset', 'trigger'])
  })

  it('treats a missing conditions array as none', () => {
    const g = graphFromIr(ir({ conditions: undefined }))
    expect(ids(g)).not.toContain('condition-0')
  })
})

describe('describeTrigger', () => {
  it('speaks plain language, with no protocol vocabulary', () => {
    const words = JSON.stringify([
      describeTrigger(heartbeat),
      describeTrigger({ kind: 'timestamp', executeAfter: 1_800_000_000 }),
      describeTrigger({ kind: 'chainProofOfLife', intervalSeconds: 86_400, sourceId: 'testXRP' }),
    ])
    for (const jargon of ['FDC', 'FTSO', 'attestation', 'Nonexistence', 'commitment']) {
      expect(words).not.toContain(jargon)
    }
  })

  it('falls back rather than throwing on a kind it has never seen', () => {
    expect(describeTrigger({ kind: 'somethingNew' })).toEqual({ title: 'Trigger', summary: '' })
    expect(describeTrigger(undefined as never)).toEqual({ title: 'Trigger', summary: '' })
  })
})

describe('confidentialInputCount', () => {
  it('is zero for an action kind with nothing private', () => {
    expect(confidentialInputCount({ kind: 'notifyOnly' })).toBe(0)
  })

  it('does not assume recipients exist', () => {
    expect(confidentialInputCount({ kind: 'splitTransfer' })).toBe(0)
  })
})

/**
 * The hydration regression guard.
 *
 * `toLocaleDateString(undefined, ...)` resolves the server's locale during SSR
 * and the browser's on hydration, so the two disagree and React discards the
 * server tree. Asserting the exact string is what makes that failure impossible
 * to reintroduce quietly.
 */
describe('formatDate', () => {
  it('is stable regardless of the ambient locale', () => {
    expect(formatDate(1_818_000_000)).toBe('11 August 2027')
  })
})

describe('formatInterval', () => {
  it.each([
    [365 * 86_400, '1 year'],
    [2 * 365 * 86_400, '2 years'],
    [30 * 86_400, '1 month'],
    [90 * 86_400, '3 months'],
    [86_400, '1 day'],
    [3 * 86_400, '3 days'],
  ])('%i seconds reads as %s', (seconds, expected) => {
    expect(formatInterval(seconds)).toBe(expected)
  })
})
