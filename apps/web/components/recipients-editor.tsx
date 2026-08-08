'use client'

import { useCallback } from 'react'
import { Badge, Share } from './primitives'
import { Button } from './shell'

export type Recipient = { address: string; shareBps: number; label?: string }

/**
 * Editing the confidential half of a policy.
 *
 * Two decisions worth naming:
 *
 * 1. Shares are edited as percentages but stored as basis points, because the
 *    engine and the commitment deal in integers. Floating-point percentages
 *    would round differently in three languages.
 *
 * 2. The running total is shown continuously and rebalancing is one click. The
 *    compiler rejects anything that does not sum to 100%, so a user who cannot
 *    see the total until they hit Deploy is being set up to fail.
 */
export function RecipientsEditor({
  recipients,
  onChange,
}: {
  recipients: Recipient[]
  onChange: (next: Recipient[]) => void
}) {
  const total = recipients.reduce((sum, r) => sum + r.shareBps, 0)
  const balanced = total === 10_000

  const update = useCallback(
    (index: number, patch: Partial<Recipient>) => {
      onChange(recipients.map((r, i) => (i === index ? { ...r, ...patch } : r)))
    },
    [recipients, onChange],
  )

  const remove = useCallback(
    (index: number) => onChange(recipients.filter((_, i) => i !== index)),
    [recipients, onChange],
  )

  const add = useCallback(() => {
    onChange([...recipients, { address: '', shareBps: 0, label: '' }])
  }, [recipients, onChange])

  /** Split evenly, giving the remainder to the last so the total is exact. */
  const rebalance = useCallback(() => {
    const each = Math.floor(10_000 / recipients.length)
    onChange(
      recipients.map((r, i) => ({
        ...r,
        shareBps: i === recipients.length - 1 ? 10_000 - each * (recipients.length - 1) : each,
      })),
    )
  }, [recipients, onChange])

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Badge tone="confidential">Encrypted before it leaves your browser</Badge>
      </div>

      {recipients.map((r, i) => (
        <div
          key={i}
          style={{
            padding: 'var(--space-3) 0',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <Field
              value={r.label ?? ''}
              placeholder="Name (optional)"
              onChange={(v) => update(i, { label: v })}
              flex={1}
            />
            <PercentField
              bps={r.shareBps}
              onChange={(bps) => update(i, { shareBps: bps })}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${r.label || 'recipient'}`}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius)',
                width: 28,
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <Field
            value={r.address}
            placeholder="0x…"
            onChange={(v) => update(i, { address: v })}
            mono
            invalid={r.address.length > 0 && !/^0x[0-9a-fA-F]{40}$/.test(r.address)}
          />
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'var(--space-4)',
        }}
      >
        <Button variant="secondary" onClick={add}>
          Add recipient
        </Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {!balanced && recipients.length > 0 && (
            <Button variant="ghost" onClick={rebalance}>
              Split evenly
            </Button>
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 540,
              color: balanced ? 'var(--success)' : 'var(--warning)',
            }}
          >
            <Share bps={total} />
          </span>
        </div>
      </div>

      {!balanced && recipients.length > 0 && (
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--warning)',
            marginTop: 'var(--space-2)',
            lineHeight: 1.5,
          }}
        >
          Shares must total 100% before this policy can be deployed.
        </p>
      )}

      <p
        style={{
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          marginTop: 'var(--space-5)',
          lineHeight: 1.55,
        }}
      >
        Only a fingerprint of this list is written on-chain — enough to prove nobody
        substituted a different recipient, not enough to read who they are.
      </p>
    </div>
  )
}

function Field({
  value,
  placeholder,
  onChange,
  mono,
  flex,
  invalid,
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  mono?: boolean
  flex?: number
  invalid?: boolean
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={mono ? 'mono' : undefined}
      style={{
        flex: flex ?? undefined,
        width: flex ? undefined : '100%',
        minWidth: 0,
        padding: '5px var(--space-2)',
        border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        fontSize: 13,
        transition: `border-color var(--duration-fast) var(--ease)`,
      }}
    />
  )
}

/**
 * Percentages in, basis points out. Kept as a separate control because the
 * conversion is the kind of thing that silently drifts if every call site does
 * its own arithmetic.
 */
function PercentField({ bps, onChange }: { bps: number; onChange: (bps: number) => void }) {
  return (
    <div style={{ position: 'relative', width: 68, flexShrink: 0 }}>
      <input
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={bps / 100}
        onChange={(e) => {
          const pct = Number.parseFloat(e.target.value)
          onChange(Number.isFinite(pct) ? Math.round(pct * 100) : 0)
        }}
        style={{
          width: '100%',
          padding: '5px 18px 5px var(--space-2)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          fontSize: 13,
          textAlign: 'right',
        }}
      />
      <span
        style={{
          position: 'absolute',
          right: 7,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 12,
          color: 'var(--text-tertiary)',
          pointerEvents: 'none',
        }}
      >
        %
      </span>
    </div>
  )
}
