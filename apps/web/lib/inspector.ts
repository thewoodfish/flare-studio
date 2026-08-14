'use client'

import { getAsset } from '@flare-studio/policy'
import {
  confidentialInputCount,
  describeAction,
  describeCondition,
  describeTrigger,
  formatDate,
  formatInterval,
  type DraftIr,
} from './canvas'

/**
 * The inspector, derived from the selected node.
 *
 * The sidebar used to be a chain of `if (nodeId === 'confidential')` branches
 * against four hardcoded ids, which meant it could only ever describe a policy
 * shaped exactly like the first template. Here the node id is resolved back to
 * the slice of IR it came from, and each primitive kind describes itself.
 *
 * The panel is data, not JSX, so the studio page renders it without knowing what
 * is in it -- and a new trigger or action kind becomes one `case` here rather
 * than a new branch in a component.
 */

export type InspectorRow = { label: string; value: string }

export type InspectorPanel = {
  title: string
  rows: InspectorRow[]
  /**
   * A named editor to mount below the rows. Named rather than passed as a
   * component so this module stays free of JSX and can be unit tested.
   */
  editor?: 'recipients'
  help?: string
}

export function inspectorFor(nodeId: string | null, ir: DraftIr): InspectorPanel {
  if (nodeId === 'asset') return assetPanel(ir)
  if (nodeId === 'trigger') return triggerPanel(ir)
  if (nodeId === 'confidential') return confidentialPanel(ir)

  const condition = indexOf(nodeId, 'condition-')
  if (condition !== null) return conditionPanel(ir, condition)

  const action = indexOf(nodeId, 'action-')
  if (action !== null) return actionPanel(ir, action)

  return policyPanel(ir)
}

/** `action-2` -> 2. Returns null for anything that is not that prefix. */
function indexOf(nodeId: string | null, prefix: string): number | null {
  if (!nodeId?.startsWith(prefix)) return null
  const index = Number(nodeId.slice(prefix.length))
  return Number.isInteger(index) && index >= 0 ? index : null
}

function policyPanel(ir: DraftIr): InspectorPanel {
  const conditions: any[] = ir.conditions ?? []
  const actions: any[] = ir.actions ?? []
  return {
    title: 'Policy',
    rows: [
      { label: 'Name', value: ir.name ?? '' },
      { label: 'Asset', value: ir.asset ?? '' },
      { label: 'Trigger', value: describeTrigger(ir.trigger).title },
      ...(conditions.length
        ? [{ label: 'Conditions', value: String(conditions.length) }]
        : []),
      { label: 'Actions', value: String(actions.length) },
    ],
    help: 'Select a node to configure it.',
  }
}

function assetPanel(ir: DraftIr): InspectorPanel {
  const asset = getAsset(ir.asset)
  return {
    title: 'Asset',
    rows: [
      { label: 'Symbol', value: asset.symbol },
      { label: 'Underlying', value: asset.name },
      { label: 'Decimals', value: String(asset.decimals) },
    ],
    help: `Held as an FAsset so your ${asset.name} can participate in a policy without leaving your control.`,
  }
}

function triggerPanel(ir: DraftIr): InspectorPanel {
  const trigger = ir.trigger ?? {}
  const described = describeTrigger(trigger)

  // Rows past the first are trigger-kind specific. Adding a trigger to the
  // schema means adding a case here, and nothing else in the UI.
  const rows: InspectorRow[] = [{ label: 'Condition', value: described.title }]
  switch (trigger.kind) {
    case 'manualHeartbeat':
      rows.push({ label: 'Check in every', value: formatInterval(trigger.intervalSeconds) })
      if (trigger.demoMode) rows.push({ label: 'Demo mode', value: 'On' })
      break
    case 'chainProofOfLife':
      rows.push({ label: 'Check in every', value: formatInterval(trigger.intervalSeconds) })
      rows.push({ label: 'Chain', value: trigger.sourceId })
      break
    case 'timestamp':
      rows.push({ label: 'Runs on', value: formatDate(trigger.executeAfter) })
      break
  }

  return {
    title: 'Trigger',
    rows,
    help: 'What causes this policy to run. Nothing happens before it does.',
  }
}

function conditionPanel(ir: DraftIr, index: number): InspectorPanel {
  const condition = (ir.conditions ?? [])[index]
  if (!condition) return policyPanel(ir)
  const described = describeCondition(condition)
  return {
    title: 'Condition',
    rows: [
      { label: 'Type', value: described.title },
      { label: 'Detail', value: described.summary },
    ],
    help: 'Checked when the trigger fires. If it does not hold, the policy waits.',
  }
}

function actionPanel(ir: DraftIr, index: number): InspectorPanel {
  const action = (ir.actions ?? [])[index]
  if (!action) return policyPanel(ir)
  const described = describeAction(action)

  const rows: InspectorRow[] = [{ label: 'Type', value: described.title }]
  if (action.kind === 'splitTransfer') {
    rows.push({ label: 'Recipients', value: String(action.recipients?.length ?? 0) })
  }

  return {
    title: 'Action',
    rows,
    help: 'The whole balance is distributed by the shares you set, so nothing is ever left stranded in the policy.',
  }
}

function confidentialPanel(ir: DraftIr): InspectorPanel {
  const actions: any[] = ir.actions ?? []
  const count = actions.reduce((sum, a) => sum + confidentialInputCount(a), 0)

  // The recipients editor is mounted only when the confidential inputs actually
  // are recipients. Another action kind with private inputs of its own would add
  // its own editor here rather than inherit this one by accident.
  const editable = actions.some((a) => a.kind === 'splitTransfer')

  return {
    title: 'Confidential inputs',
    rows: editable ? [] : [{ label: 'Private values', value: String(count) }],
    editor: editable ? 'recipients' : undefined,
    help: editable
      ? undefined
      : 'These values are encrypted to the enclave and never appear on chain.',
  }
}
