'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react'
import { TEMPLATES, getAsset } from '@flare-studio/policy'
import { nodeTypes } from '@/components/nodes'
import { Shell, RailButton, TopBar, Button } from '@/components/shell'
import { Badge, Share, Address } from '@/components/primitives'

/**
 * The policy builder.
 *
 * The canvas is seeded from the shared template registry -- the same array the
 * compiler and the tests consume. Nothing here knows what an inheritance is; it
 * renders whatever primitives the selected template produced.
 */
export default function StudioPage() {
  const [templateId, setTemplateId] = useState(TEMPLATES[0]!.id)
  const template = TEMPLATES.find((t) => t.id === templateId)!

  // Placeholder recipients until the inspector can edit them. Real addresses
  // arrive from the confidential inputs panel.
  const recipients = useMemo(
    () => [
      { address: '0x1111111111111111111111111111111111111111', shareBps: 6000, label: 'Partner' },
      { address: '0x2222222222222222222222222222222222222222', shareBps: 4000, label: 'Child' },
    ],
    [],
  )

  const ir = useMemo(
    () => template.build({ recipients, demoMode: true }) as Record<string, any>,
    [template, recipients],
  )

  const initialNodes = useMemo<Node[]>(() => {
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
        position: { x: 320, y: 320 },
        data: {
          title: 'Split transfer',
          summary: `Distribute the full balance across ${recipients.length} recipients`,
        },
      },
    ]
  }, [ir, recipients])

  const initialEdges = useMemo(
    () => [
      { id: 'a-t', source: 'asset', target: 'trigger', animated: false },
      { id: 't-c', source: 'trigger', target: 'confidential' },
      { id: 't-x', source: 'trigger', target: 'action' },
    ],
    [],
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const [selected, setSelected] = useState<string | null>(null)

  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node[] }) => setSelected(sel[0]?.id ?? null),
    [],
  )

  return (
    <Shell
      rail={
        <>
          <RailButton active label="Builder">
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 4.5h3.5a1 1 0 0 1 1 1V9" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </RailButton>
          <RailButton label="Policies">
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="2" width="11" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </RailButton>
        </>
      }
      inspector={<Inspector nodeId={selected} ir={ir} recipients={recipients} />}
    >
      <TopBar
        title={ir.name}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            Draft
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            {template.title}
          </span>
        }
        actions={
          <>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
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
            <Button variant="secondary">Review</Button>
            <Button variant="primary">Deploy policy</Button>
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
          defaultEdgeOptions={{
            style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e4e4e7" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </Shell>
  )
}

function Inspector({
  nodeId,
  ir,
  recipients,
}: {
  nodeId: string | null
  ir: Record<string, any>
  recipients: Array<{ address: string; shareBps: number; label?: string }>
}) {
  if (!nodeId) {
    return (
      <Panel title="Policy">
        <Row label="Template" value={ir.name} />
        <Row label="Asset" value={ir.asset} />
        <Row label="Trigger" value={describeTrigger(ir.trigger).title} />
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--text-tertiary)',
            marginTop: 'var(--space-5)',
            lineHeight: 1.55,
          }}
        >
          Select a node to configure it.
        </p>
      </Panel>
    )
  }

  if (nodeId === 'confidential') {
    return (
      <Panel title="Confidential inputs">
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Badge tone="confidential">Encrypted before it leaves your browser</Badge>
        </div>
        {recipients.map((r) => (
          <div
            key={r.address}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 520 }}>{r.label ?? 'Recipient'}</div>
              <div style={{ marginTop: 2 }}>
                <Address value={r.address} />
              </div>
            </div>
            <Share bps={r.shareBps} />
          </div>
        ))}
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            marginTop: 'var(--space-4)',
            lineHeight: 1.55,
          }}
        >
          Only a fingerprint of this list is written on-chain — enough to prove nobody
          substituted a different recipient, not enough to read who they are.
        </p>
      </Panel>
    )
  }

  const meta: Record<string, { title: string; body: string }> = {
    asset: { title: 'Asset', body: 'What this policy governs.' },
    trigger: { title: 'Trigger', body: 'What causes the policy to run.' },
    action: { title: 'Action', body: 'What happens when it does.' },
  }
  const m = meta[nodeId] ?? { title: 'Node', body: '' }

  return (
    <Panel title={m.title}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{m.body}</p>
    </Panel>
  )
}

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
      return {
        title: 'If you stop checking in',
        summary: `After ${formatInterval(trigger.intervalSeconds)} without a check-in`,
      }
    case 'chainProofOfLife':
      return {
        title: 'If you stop checking in',
        summary: `After ${formatInterval(trigger.intervalSeconds)} with no proof-of-life payment`,
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
