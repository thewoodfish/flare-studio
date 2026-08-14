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
  /**
   * Short name for the step strip. Distinct from `title` because the strip has
   * room for a word and the header has room for a phrase -- and because a
   * primitive knows what it should be called better than a lookup table does.
   */
  label: string
  title: string
  rows: InspectorRow[]
  /**
   * A named editor to mount below the rows. Named rather than passed as a
   * component so this module stays free of JSX and can be unit tested.
   */
  editor?: 'recipients' | 'trigger'
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
    label: 'Policy',
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
    help: 'An overview of everything this policy does.',
  }
}

function assetPanel(ir: DraftIr): InspectorPanel {
  const asset = getAsset(ir.asset)
  return {
    label: 'Asset',
    title: 'What it governs',
    rows: [
      { label: 'Symbol', value: asset.symbol },
      { label: 'Underlying', value: asset.name },
      { label: 'Decimals', value: String(asset.decimals) },
    ],
    help:
      `Your ${asset.name} is held by the policy contract itself — not by us, and not by ` +
      'anyone who could spend it. It stays yours, and you can withdraw it or cancel the ' +
      'policy at any time before it runs.',
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

  // The rows stay, and the editor mounts below them: the summary is what a user
  // reads, the fields are what they change. Dropping the rows in favour of the
  // form would lose the plain-language statement of what the policy does.
  return {
    label: 'Trigger',
    title: 'What starts it',
    rows,
    editor: 'trigger',
    help:
      'Nothing moves until this happens. Once it does, the policy runs on its own — ' +
      'including when you cannot act, which is usually the whole point of having one.',
  }
}

function conditionPanel(ir: DraftIr, index: number): InspectorPanel {
  const condition = (ir.conditions ?? [])[index]
  if (!condition) return policyPanel(ir)
  const described = describeCondition(condition)
  return {
    label: 'Condition',
    title: 'What must also hold',
    rows: [
      { label: 'Type', value: described.title },
      { label: 'Detail', value: described.summary },
    ],
    help:
      'Checked at the moment the trigger fires. If it does not hold, the policy waits ' +
      'rather than running — the trigger alone is not enough.',
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
    label: 'Action',
    title: 'What happens',
    rows,
    help:
      'The whole balance is distributed by the shares you set, in one transaction. ' +
      'The remainder from any uneven split goes to the last recipient, so nothing is ' +
      'ever left stranded — once a policy has run it can never run again.',
  }
}

function confidentialPanel(ir: DraftIr): InspectorPanel {
  const actions: any[] = ir.actions ?? []
  const count = actions.reduce((sum, a) => sum + confidentialInputCount(a), 0)

  // The recipients editor is mounted only when the confidential inputs actually
  // are recipients. Another action kind with private inputs of its own would add
  // its own editor here rather than inherit this one by accident.
  const editable = actions.some((a) => a.kind === 'splitTransfer')

  // Named for what it holds rather than for the primitive. "Private" left people
  // asking whether it meant conditions; "Recipients" cannot be misread. The
  // generic name survives for an action kind whose private inputs are not
  // recipients, which is exactly when the specific one would be wrong.
  return {
    label: editable ? 'Recipients' : 'Confidential',
    title: editable ? 'Who receives what' : 'Confidential inputs',
    rows: editable ? [] : [{ label: 'Private values', value: String(count) }],
    editor: editable ? 'recipients' : undefined,
    help: editable
      ? 'This list is encrypted in your browser before anything is sent. Only a ' +
        'fingerprint of it goes on chain — enough to prove later that nobody ' +
        'substituted a different recipient, not enough for anyone to read who they ' +
        'are. Not us, not a data provider, not someone reading the chain.'
      : 'These values are encrypted to the enclave and never appear on chain.',
  }
}
