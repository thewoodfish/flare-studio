import { describe, expect, it } from 'vitest'
import { inspectorFor } from '../lib/inspector'
import type { DraftIr } from '../lib/canvas'

/**
 * The sidebar used to be four `if (nodeId === ...)` branches, so it could only
 * describe a policy shaped like the first template. These tests are mostly about
 * the shapes that used to be impossible: a second action, a condition, an
 * unknown node id, an index past the end.
 *
 * The panel is data rather than JSX precisely so it can be asserted here.
 */

function ir(overrides: DraftIr = {}): DraftIr {
  return {
    version: 1,
    name: 'Test policy',
    asset: 'FXRP',
    trigger: { kind: 'manualHeartbeat', intervalSeconds: 365 * 86_400, demoMode: true },
    conditions: [],
    actions: [
      {
        kind: 'splitTransfer',
        recipients: [{ address: '0x1111111111111111111111111111111111111111', shareBps: 10_000 }],
      },
    ],
    ...overrides,
  }
}

const value = (panel: { rows: Array<{ label: string; value: string }> }, label: string) =>
  panel.rows.find((r) => r.label === label)?.value

describe('inspectorFor', () => {
  it('describes the whole policy when nothing is selected', () => {
    const panel = inspectorFor(null, ir())
    expect(panel.label).toBe('Policy')
    expect(value(panel, 'Actions')).toBe('1')
  })

  it('does not offer a conditions row when there are none', () => {
    expect(value(inspectorFor(null, ir()), 'Conditions')).toBeUndefined()
    expect(
      value(inspectorFor(null, ir({ conditions: [{ kind: 'priceAbove', minimumUsd: 5 }] })), 'Conditions'),
    ).toBe('1')
  })

  it('reads asset facts from the registry rather than the draft', () => {
    const panel = inspectorFor('asset', ir())
    expect(value(panel, 'Symbol')).toBe('FXRP')
    expect(value(panel, 'Decimals')).toBe('6')
  })

  /**
   * The detail the old hardcoded sidebar could not show. Each trigger kind
   * contributes its own rows, so adding one is a case here and nothing else.
   */
  it('shows heartbeat-specific rows', () => {
    const panel = inspectorFor('trigger', ir())
    expect(value(panel, 'Check in every')).toBe('1 year')
    expect(value(panel, 'Demo mode')).toBe('On')
  })

  it('hides demo mode when it is off', () => {
    const off = ir({ trigger: { kind: 'manualHeartbeat', intervalSeconds: 86_400, demoMode: false } })
    expect(value(inspectorFor('trigger', off), 'Demo mode')).toBeUndefined()
  })

  it('shows a date for the timestamp trigger, not an interval', () => {
    const panel = inspectorFor('trigger', ir({ trigger: { kind: 'timestamp', executeAfter: 1_818_000_000 } }))
    expect(value(panel, 'Runs on')).toBe('11 August 2027')
    expect(value(panel, 'Check in every')).toBeUndefined()
  })

  it('names the source chain for the payment-based trigger', () => {
    const panel = inspectorFor(
      'trigger',
      ir({ trigger: { kind: 'chainProofOfLife', intervalSeconds: 30 * 86_400, sourceId: 'testXRP' } }),
    )
    expect(value(panel, 'Chain')).toBe('testXRP')
  })

  it('resolves an action by its index, not by assuming the first', () => {
    const twoActions = ir({
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
    })
    expect(value(inspectorFor('action-0', twoActions), 'Recipients')).toBe('1')
    expect(value(inspectorFor('action-1', twoActions), 'Recipients')).toBe('2')
  })

  it('resolves a condition by its index', () => {
    const panel = inspectorFor(
      'condition-1',
      ir({
        conditions: [
          { kind: 'priceAbove', minimumUsd: 1 },
          { kind: 'priceAbove', minimumUsd: 99 },
        ],
      }),
    )
    expect(panel.label).toBe('Condition')
    expect(value(panel, 'Detail')).toContain('99')
  })

  /** A stale selection must not crash the sidebar. */
  it('falls back to the policy panel for an index past the end', () => {
    expect(inspectorFor('action-7', ir()).label).toBe('Policy')
    expect(inspectorFor('condition-3', ir()).label).toBe('Policy')
  })

  it('falls back for a node id it has never seen', () => {
    expect(inspectorFor('something-else', ir()).label).toBe('Policy')
    expect(inspectorFor('action-not-a-number', ir()).label).toBe('Policy')
  })

  describe('confidential inputs', () => {
    it('mounts the recipients editor when the private values are recipients', () => {
      const panel = inspectorFor('confidential', ir())
      expect(panel.editor).toBe('recipients')
    })

    /**
     * "Private" as a step name had people asking whether it meant conditions.
     * The step is named for what it holds, which cannot be misread.
     */
    it('names the step for what it holds', () => {
      expect(inspectorFor('confidential', ir()).label).toBe('Recipients')
    })

    /** Every step explains itself; a step with no help is a step with no answer. */
    it('explains itself, as every step must', () => {
      for (const id of ['asset', 'trigger', 'confidential', 'action-0', null]) {
        const panel = inspectorFor(id, ir())
        expect(panel.help, `${id} has no explanation`).toBeTruthy()
        expect(panel.label, `${id} has no label`).toBeTruthy()
      }
    })

    /**
     * Another action kind with private inputs of its own must not silently
     * inherit the recipients editor -- it would offer to edit values that are
     * not there.
     */
    it('does not mount it for an action kind that is not a split transfer', () => {
      const panel = inspectorFor('confidential', ir({ actions: [{ kind: 'notifyOnly' }] }))
      expect(panel.editor).toBeUndefined()
      expect(panel.label).toBe('Confidential')
      expect(value(panel, 'Private values')).toBe('0')
    })
  })
})
