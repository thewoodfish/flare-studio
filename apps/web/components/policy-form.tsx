'use client'

import { PRIMITIVE } from './primitive-meta'
import { RecipientsEditor, type Recipient } from './recipients-editor'
import { TriggerEditor } from './trigger-editor'
import { Button } from './shell'
import type { CanvasGraph, DraftIr } from '@/lib/canvas'
import { inspectorFor } from '@/lib/inspector'

/**
 * A policy as a form you fill in, one primitive at a time.
 *
 * This replaced a diagram, which replaced a drag-and-drop canvas. The canvas
 * pretended to be an editor and was not; the diagram was honest but was still a
 * picture beside the controls, so the thing you looked at and the thing you
 * changed were in different places. A form is what this screen has been the
 * whole time.
 *
 * The steps are the policy's own primitives, in the order the engine evaluates
 * them: asset, then what starts it, then anything that must also hold, then what
 * is kept private, then what is done. Nothing here is a fixed list -- a template
 * with two actions or a condition grows a step, because the steps come from the
 * IR.
 *
 * `graphFromIr` still produces them. It emits ordered, typed primitives with
 * ids, which is what a step strip needs and what a diagram needed before it.
 */
export function PolicyForm({
  graph,
  ir,
  step,
  onStep,
  recipients,
  onRecipientsChange,
  onTriggerChange,
  onReview,
}: {
  graph: CanvasGraph
  ir: DraftIr
  step: string
  onStep: (id: string) => void
  recipients: Recipient[]
  onRecipientsChange: (next: Recipient[]) => void
  onTriggerChange: (next: DraftIr) => void
  onReview: () => void
}) {
  const steps = graph.nodes
  const index = Math.max(0, steps.findIndex((n) => n.id === step))
  const current = steps[index] ?? steps[0]
  if (!current) return null

  const panel = inspectorFor(current.id, ir)
  const meta = PRIMITIVE[current.type]
  const isLast = index === steps.length - 1

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--space-6)' }}>
      <div style={{ maxWidth: 660, margin: '0 auto' }}>
        <StepStrip steps={steps} ir={ir} activeId={current.id} onStep={onStep} />

        <section
          style={{
            marginTop: 'var(--space-6)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--surface-sunken)',
            }}
          >
            <span style={{ display: 'inline-flex', color: meta.colour }}>{meta.icon}</span>
            <h2 style={{ fontSize: 15 }}>{panel.title}</h2>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
              }}
            >
              Step {index + 1} of {steps.length}
            </span>
          </header>

          <div style={{ padding: 'var(--space-5)' }}>
            {panel.help && (
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  marginBottom: 'var(--space-5)',
                }}
              >
                {panel.help}
              </p>
            )}

            {/* Rows are the read-only view of a primitive. Where there is an
                editor they are the same facts twice -- "Check in every: 1 year"
                directly above a control labelled "Check in every" -- so the
                editor wins and the rows step aside. */}
            {panel.editor === 'trigger' ? (
              <TriggerEditor trigger={ir.trigger} assetSymbol={ir.asset} onChange={onTriggerChange} />
            ) : panel.editor === 'recipients' ? (
              <RecipientsEditor recipients={recipients} onChange={onRecipientsChange} />
            ) : (
              panel.rows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--space-4)',
                    padding: 'var(--space-3) 0',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{row.label}</span>
                  <span
                    style={{
                      fontWeight: 520,
                      textAlign: 'right',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={row.value}
                  >
                    {row.value}
                  </span>
                </div>
              ))
            )}
          </div>

          <footer
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
              padding: 'var(--space-4) var(--space-5)',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--surface-sunken)',
            }}
          >
            <Button
              onClick={() => onStep(steps[index - 1]!.id)}
              disabled={index === 0}
            >
              Back
            </Button>

            {isLast ? (
              <Button variant="primary" onClick={onReview}>
                Review and deploy
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onStep(steps[index + 1]!.id)}>
                Next
              </Button>
            )}
          </footer>
        </section>
      </div>
    </div>
  )
}

/**
 * The steps, as a strip.
 *
 * Every step is reachable at any time rather than gated behind the one before
 * it. A policy is a document being edited, not a checkout — someone changing
 * the recipients of a policy they already understand should not have to walk
 * past the asset to get there.
 */
function StepStrip({
  steps,
  ir,
  activeId,
  onStep,
}: {
  steps: CanvasGraph['nodes']
  ir: DraftIr
  activeId: string
  onStep: (id: string) => void
}) {
  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        flexWrap: 'wrap',
      }}
    >
      {steps.map((node, i) => {
        const meta = PRIMITIVE[node.type]
        const active = node.id === activeId
        // The primitive names itself. A lookup table cannot know that a
        // confidential input holding recipients should say "Recipients".
        const { label } = inspectorFor(node.id, ir)

        return (
          <li key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && (
              <span aria-hidden="true" style={{ color: 'var(--text-tertiary)', padding: '0 2px' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}

            <button
              type="button"
              onClick={() => onStep(node.id)}
              aria-current={active ? 'step' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '6px var(--space-3)',
                borderRadius: 'var(--radius)',
                border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                background: active ? 'var(--accent-subtle)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: active ? 560 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: `background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)`,
              }}
            >
              <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : meta.colour }}>
                {meta.icon}
              </span>
              {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
