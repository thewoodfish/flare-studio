'use client'

import { PolicyNode } from './nodes'
import type { CanvasGraph, DiagramNode } from '@/lib/canvas'

/**
 * The policy, as a picture.
 *
 * This replaced a React Flow canvas, and the reasoning is worth keeping. That
 * canvas could drag, connect and delete nodes, and none of the three changed the
 * policy — dragging moved a node to a position nothing saved, connecting drew an
 * edge nothing read, and deleting removed a node while the primitive stayed in
 * the IR. Three affordances that lied, for about 50 kB of JavaScript, to provide
 * a second way of selecting four things the sidebar already lists.
 *
 * What the picture was actually earning was comprehension: a policy is a chain
 * from an asset, through what starts it, to what it does — and one node in that
 * chain is locked. That survives being static.
 *
 * Slots are a fixed width so the connectors can be drawn from arithmetic rather
 * than measurement. A diagram that has to observe its own layout to draw its own
 * lines is how this kind of thing ends up needing a layout engine again.
 *
 * Nodes are buttons, so the whole diagram is keyboard navigable. The canvas was
 * not.
 */

const SLOT = 244
const GAP = 28

export function PolicyDiagram({
  graph,
  selected,
  onSelect,
}: {
  graph: CanvasGraph
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const of = (type: DiagramNode['type']) => graph.nodes.filter((n) => n.type === type)

  const chain = [...of('asset'), ...of('trigger'), ...of('condition')]
  const leaves = [...of('confidential'), ...of('action')]

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-10) var(--space-6) var(--space-12)',
        // Kept verbatim from the canvas: a dot grid reads as a design surface,
        // which is what the product is.
        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
      onClick={() => onSelect(null)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {chain.map((node, i) => (
          <div key={node.id} style={{ display: 'contents' }}>
            {i > 0 && <Stem />}
            <Slot node={node} selected={selected} onSelect={onSelect} />
          </div>
        ))}

        {leaves.length > 0 && <Fork count={leaves.length} />}

        <div style={{ display: 'flex', gap: GAP, alignItems: 'flex-start' }}>
          {leaves.map((node) => (
            <Slot key={node.id} node={node} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Slot({
  node,
  selected,
  onSelect,
}: {
  node: DiagramNode
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const isSelected = selected === node.id

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(isSelected ? null : node.id)
      }}
      style={{
        width: SLOT,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'block',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <PolicyNode node={node} selected={isSelected} />
    </button>
  )
}

/** The line between two links in the chain. */
function Stem() {
  return (
    <span aria-hidden="true" style={{ width: 1, height: 32, background: 'var(--border-strong)' }} />
  )
}

/**
 * The split from the chain down to the final row.
 *
 * One leaf is a straight line. Several fan out to a rule spanning their centres,
 * with a stub down to each — the geometry is exact because every slot is `SLOT`
 * wide and every gap is `GAP`.
 */
function Fork({ count }: { count: number }) {
  if (count === 1) return <Stem />

  const span = (count - 1) * (SLOT + GAP)

  return (
    <span aria-hidden="true" style={{ display: 'block', width: span, height: 48, position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          width: 1,
          height: 24,
          background: 'var(--border-strong)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 24,
          height: 1,
          background: 'var(--border-strong)',
        }}
      />
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: `${(i / (count - 1)) * 100}%`,
            top: 24,
            width: 1,
            height: 24,
            background: 'var(--border-strong)',
          }}
        />
      ))}
    </span>
  )
}
