'use client'

import type { ReactNode } from 'react'
import type { DiagramNode } from '@/lib/canvas'

/**
 * Canvas node types, one per policy primitive.
 *
 * The primitives are Asset, Trigger, Condition, Confidential Input, Action --
 * the same five the policy IR is built from. That correspondence is deliberate:
 * what the user drags is what the compiler consumes, so the canvas is not a
 * metaphor for the model, it *is* the model.
 *
 * Confidential nodes carry a distinct lock treatment and a violet border. That
 * one visual does more to explain the product than any amount of copy.
 *
 * These are plain cards. They were React Flow nodes, which brought drag, connect
 * and delete handlers that all did nothing to the policy -- three affordances
 * that lied. A diagram that explains is worth keeping; an editor that cannot
 * edit is not.
 */

type Category = 'asset' | 'trigger' | 'condition' | 'confidential' | 'action'

const CATEGORY: Record<Category, { label: string; dot: string; icon: ReactNode }> = {
  asset: { label: 'Asset', dot: '#1e5fa8', icon: <CoinIcon /> },
  trigger: { label: 'Trigger', dot: '#96601a', icon: <BoltIcon /> },
  condition: { label: 'Condition', dot: '#0f7b4a', icon: <FilterIcon /> },
  confidential: { label: 'Confidential', dot: '#6134c4', icon: <LockIcon /> },
  action: { label: 'Action', dot: '#e62058', icon: <ArrowIcon /> },
}

function NodeShell({
  category,
  title,
  summary,
  selected,
  children,
}: {
  category: Category
  title: string
  summary: string
  selected?: boolean
  children?: ReactNode
}) {
  const meta = CATEGORY[category]
  const isConfidential = category === 'confidential'

  return (
    <div
      style={{
        minWidth: 236,
        maxWidth: 280,
        background: 'var(--surface)',
        border: `1px solid ${
          selected
            ? 'var(--accent)'
            : isConfidential
              ? 'var(--confidential-border)'
              : 'var(--border)'
        }`,
        borderRadius: 'var(--radius-md)',
        boxShadow: selected ? 'var(--shadow-node-selected)' : 'var(--shadow-node)',
        transition: `box-shadow var(--duration) var(--ease), border-color var(--duration) var(--ease)`,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          background: isConfidential ? 'var(--confidential-subtle)' : 'var(--surface-sunken)',
          borderBottom: `1px solid ${
            isConfidential ? 'var(--confidential-border)' : 'var(--border-subtle)'
          }`,
        }}
      >
        <span style={{ display: 'inline-flex', color: meta.dot }}>{meta.icon}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 560,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: isConfidential ? 'var(--confidential)' : 'var(--text-tertiary)',
          }}
        >
          {meta.label}
        </span>
      </header>

      <div style={{ padding: 'var(--space-3)' }}>
        <div style={{ fontSize: 14, fontWeight: 540, letterSpacing: '-0.011em' }}>{title}</div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            marginTop: 'var(--space-1)',
            lineHeight: 1.45,
          }}
        >
          {summary}
        </div>
        {children}
      </div>
    </div>
  )
}

/** Renders whichever primitive the node is. The diagram never switches on type. */
export function PolicyNode({ node, selected }: { node: DiagramNode; selected?: boolean }) {
  const d = node.data as Record<string, any>

  if (node.type === 'asset') {
    return (
      <NodeShell
        category="asset"
        title={d.symbol}
        summary={`Governs your ${d.name}`}
        selected={selected}
      />
    )
  }

  if (node.type === 'confidential') return <ConfidentialNode count={d.count} selected={selected} />

  return (
    <NodeShell
      category={node.type}
      title={d.title}
      summary={d.summary}
      selected={selected}
    />
  )
}

/**
 * The node that sells the product.
 *
 * It deliberately shows a *count* and never the contents -- the canvas itself
 * demonstrates the confidentiality property rather than describing it. Even the
 * person who wrote the policy sees "3 recipients, encrypted" here, and opens the
 * inspector to see who.
 */
function ConfidentialNode({ count, selected }: { count: number; selected?: boolean }) {
  const d = { count }
  return (
    <NodeShell
      category="confidential"
      title={`${d.count} recipient${d.count === 1 ? '' : 's'}`}
      summary="Encrypted to the secure enclave. Never written on-chain."
      selected={selected}
    >
      {/* Redacted rows, one per hidden recipient. Reads as "there is content
          here you cannot see" -- which is exactly the property being claimed --
          where a progress-style meter would read as a loading state. */}
      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        {Array.from({ length: Math.min(d.count, 4) }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div
              style={{
                height: 8,
                flex: i % 2 === 0 ? 1 : 0.72,
                borderRadius: 2,
                background: 'var(--confidential-border)',
                opacity: 0.75,
              }}
            />
            <div
              style={{
                height: 8,
                width: 26,
                borderRadius: 2,
                background: 'var(--confidential-border)',
                opacity: 0.45,
              }}
            />
          </div>
        ))}
      </div>
    </NodeShell>
  )
}

/* Icons: one family, one stroke width (1.4), one 16px box. */

function CoinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.2v5.6M6.3 6.6h3.4M6.3 9.4h3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8.8 1.8 3.6 9.1h3.5l-.9 5.1 5.2-7.3H7.9l.9-5.1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.6 3.4h10.8L9.4 8.1v4.6l-2.8 1.4V8.1L2.6 3.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.6 8h10.8M9.4 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
