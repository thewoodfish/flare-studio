'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react'
import { TEMPLATES, getAsset, type CompiledPolicy } from '@flare-studio/policy'
import { nodeTypes } from '@/components/nodes'
import { Shell, TopBar, Button } from '@/components/shell'
import { Rail } from '@/components/rail'
import { Badge } from '@/components/primitives'
import { RecipientsEditor, type Recipient } from '@/components/recipients-editor'
import { ReviewDrawer } from '@/components/review-drawer'
import { DeployDialog } from '@/components/deploy-dialog'
import { WalletButton } from '@/components/wallet-button'
import { useWallet } from '@/lib/wallet'

/**
 * The policy builder.
 *
 * The canvas is seeded from the shared template registry -- the same array the
 * compiler and the tests consume. Nothing here knows what an inheritance is; it
 * renders whatever primitives the selected template produced.
 */
export default function StudioPage() {
  const [templateId, setTemplateId] = useState(TEMPLATES[0]!.id)
  const [recipients, setRecipients] = useState<Recipient[]>([
    { address: '0x1111111111111111111111111111111111111111', shareBps: 6000, label: 'Partner' },
    { address: '0x2222222222222222222222222222222222222222', shareBps: 4000, label: 'Child' },
  ])
  const [reviewing, setReviewing] = useState(false)
  const [deploying, setDeploying] = useState<CompiledPolicy | null>(null)
  const [deployed, setDeployed] = useState(false)

  const wallet = useWallet()
  const template = TEMPLATES.find((t) => t.id === templateId)!

  // Stable for the session. In the real deploy path this is fresh randomness
  // per policy -- it is what stops the commitment being brute-forceable over a
  // small recipient space.
  const salt = useMemo(
    () =>
      `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as `0x${string}`,
    [],
  )

  const ir = useMemo(
    () => template.build({ recipients, demoMode: true }) as Record<string, any>,
    [template, recipients],
  )

  const nodesFromIr = useMemo<Node[]>(() => {
    const asset = getAsset(ir.asset)
    return [
      {
        id: 'asset',
        type: 'asset',
        position: { x: 260, y: 0 },
        data: { symbol: asset.symbol, name: asset.name },
      },
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 260, y: 150 },
        data: describeTrigger(ir.trigger),
      },
      {
        id: 'confidential',
        type: 'confidential',
        position: { x: 20, y: 320 },
        data: { count: recipients.length },
      },
      {
        id: 'action',
        type: 'action',
        position: { x: 340, y: 320 },
        data: {
          title: 'Split transfer',
          summary: `Distribute the full balance across ${recipients.length} recipient${
            recipients.length === 1 ? '' : 's'
          }`,
        },
      },
    ]
  }, [ir, recipients])

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesFromIr)
  const [edges, , onEdgesChange] = useEdgesState([
    { id: 'a-t', source: 'asset', target: 'trigger' },
    { id: 't-c', source: 'trigger', target: 'confidential' },
    { id: 't-x', source: 'trigger', target: 'action' },
  ])
  const [selected, setSelected] = useState<string | null>(null)

  // Keep node *data* in sync with the draft while preserving positions the user
  // has dragged. Replacing the whole array would yank nodes back to their seed
  // positions on every keystroke.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => {
        const fresh = nodesFromIr.find((f) => f.id === n.id)
        return fresh ? { ...n, data: fresh.data } : n
      }),
    )
  }, [nodesFromIr, setNodes])

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node[] }) => setSelected(sel[0]?.id ?? null),
    [],
  )

  return (
    <Shell
      rail={<Rail />}
      inspector={
        <Inspector
          nodeId={selected}
          ir={ir}
          recipients={recipients}
          onRecipientsChange={setRecipients}
        />
      }
    >
      <TopBar
        title={ir.name}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {deployed ? <Badge tone="success">Deployed</Badge> : 'Draft'}
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            {template.title}
          </span>
        }
        actions={
          <>
            <WalletButton wallet={wallet} />
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label="Template"
              style={{
                padding: '6px var(--space-3)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius)',
                background: 'var(--surface)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => setReviewing(true)}>
              Review and deploy
            </Button>
          </>
        }
      />

      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          fitView
          // maxZoom matters: with only a handful of nodes, fitView happily
          // scales past 1 and every type size in the design system inflates
          // with it. Never zoom in past natural size.
          fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e4e4e7" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {reviewing && (
        <ReviewDrawer
          ir={ir}
          salt={salt}
          onClose={() => setReviewing(false)}
          onDeploy={(compiled) => {
            // The review already compiled for real, so what the user just read
            // is exactly what is handed to the deploy flow -- no recompile, no
            // opportunity for the two to disagree.
            setDeploying(compiled)
            setReviewing(false)
          }}
        />
      )}

      {deploying && (
        <DeployDialog
          compiled={deploying}
          salt={salt}
          templateId={templateId}
          onClose={() => setDeploying(null)}
          onDeployed={() => setDeployed(true)}
        />
      )}
    </Shell>
  )
}

function Inspector({
  nodeId,
  ir,
  recipients,
  onRecipientsChange,
}: {
  nodeId: string | null
  ir: Record<string, any>
  recipients: Recipient[]
  onRecipientsChange: (next: Recipient[]) => void
}) {
  if (nodeId === 'confidential') {
    return (
      <Panel title="Confidential inputs">
        <RecipientsEditor recipients={recipients} onChange={onRecipientsChange} />
      </Panel>
    )
  }

  if (nodeId === 'asset') {
    const asset = getAsset(ir.asset)
    return (
      <Panel title="Asset">
        <Row label="Symbol" value={asset.symbol} />
        <Row label="Underlying" value={asset.name} />
        <Row label="Decimals" value={String(asset.decimals)} />
        <p style={helpText}>
          Held as an FAsset so your {asset.name} can participate in a policy without leaving
          your control.
        </p>
      </Panel>
    )
  }

  if (nodeId === 'trigger') {
    const t = describeTrigger(ir.trigger)
    return (
      <Panel title="Trigger">
        <Row label="Condition" value={t.title} />
        <Row label="Detail" value={t.summary} />
        <p style={helpText}>What causes this policy to run. Nothing happens before it does.</p>
      </Panel>
    )
  }

  if (nodeId === 'action') {
    return (
      <Panel title="Action">
        <Row label="Type" value="Split transfer" />
        <Row label="Recipients" value={String(recipients.length)} />
        <p style={helpText}>
          The whole balance is distributed by the shares you set, so nothing is ever left
          stranded in the policy.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Policy">
      <Row label="Template" value={ir.name} />
      <Row label="Asset" value={ir.asset} />
      <Row label="Trigger" value={describeTrigger(ir.trigger).title} />
      <Row label="Recipients" value={String(recipients.length)} />
      <p style={helpText}>Select a node to configure it.</p>
    </Panel>
  )
}

const helpText = {
  fontSize: 12.5,
  color: 'var(--text-secondary)',
  marginTop: 'var(--space-4)',
  lineHeight: 1.55,
} as const

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 'var(--space-5)' }}>
      <h4
        style={{
          fontSize: 11,
          fontWeight: 560,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontWeight: 520,
          marginLeft: 'var(--space-4)',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Plain language, no blockchain vocabulary. The product principle is that users
 * think about intent -- "FDC ReferencedPaymentNonexistence" belongs in the
 * under-the-hood panel, not on the canvas.
 */
function describeTrigger(trigger: Record<string, any>): { title: string; summary: string } {
  switch (trigger.kind) {
    case 'manualHeartbeat':
    case 'chainProofOfLife':
      return {
        title: 'If you stop checking in',
        summary: `After ${formatInterval(trigger.intervalSeconds)} without a check-in`,
      }
    case 'timestamp':
      return {
        title: 'On a specific date',
        summary: new Date(trigger.executeAfter * 1000).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      }
    default:
      return { title: 'Trigger', summary: '' }
  }
}

function formatInterval(seconds: number): string {
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
