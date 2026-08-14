'use client'

import { formatUnits, parseUnits } from 'viem'
import { getAsset } from '@flare-studio/policy'
import type { DraftIr } from '@/lib/canvas'
import {
  TRIGGER_KINDS,
  joinDuration,
  splitDuration,
  switchTriggerKind,
  triggerSpec,
  type TriggerField,
} from '@/lib/triggers'

/**
 * Editing the trigger.
 *
 * This component knows about input *types* -- a duration, a date, an amount --
 * and nothing about trigger kinds. The fields it renders come from
 * `TRIGGER_KINDS`, so a new trigger appears here without this file changing.
 * That is the difference between a builder and a form that happens to be shaped
 * like the first template.
 */
export function TriggerEditor({
  trigger,
  assetSymbol,
  onChange,
}: {
  trigger: DraftIr
  assetSymbol: string
  onChange: (next: DraftIr) => void
}) {
  const spec = triggerSpec(trigger?.kind)
  const asset = getAsset(assetSymbol)

  const set = (key: string, value: unknown) => onChange({ ...trigger, [key]: value })

  return (
    <div>
      <Label>What starts it</Label>
      <select
        aria-label="Trigger type"
        value={trigger?.kind ?? ''}
        onChange={(e) => onChange(switchTriggerKind(trigger, e.target.value, assetSymbol))}
        style={{
          width: '100%',
          padding: '8px var(--space-3)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {TRIGGER_KINDS.map((t) => (
          <option key={t.kind} value={t.kind} disabled={Boolean(t.unavailable)}>
            {t.label}
            {t.unavailable ? ` — ${t.unavailable}` : ''}
          </option>
        ))}
      </select>

      {spec && (
        <p style={help}>{spec.summary}</p>
      )}

      {spec?.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={trigger?.[field.key]}
          decimals={asset.decimals}
          symbol={asset.symbol}
          onChange={(v) => set(field.key, v)}
        />
      ))}
    </div>
  )
}

function Field({
  field,
  value,
  decimals,
  symbol,
  onChange,
}: {
  field: TriggerField
  value: unknown
  decimals: number
  symbol: string
  onChange: (value: unknown) => void
}) {
  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      <Label>{field.label}</Label>

      {field.input === 'duration' && (
        <DurationInput seconds={Number(value ?? 0)} onChange={onChange} />
      )}

      {field.input === 'date' && (
        <input
          type="date"
          aria-label={field.label}
          // `toISOString` is UTC, which is what the contract compares against.
          value={new Date(Number(value ?? 0) * 1000).toISOString().slice(0, 10)}
          onChange={(e) => {
            const seconds = Math.floor(new Date(`${e.target.value}T00:00:00Z`).getTime() / 1000)
            if (Number.isFinite(seconds)) onChange(seconds)
          }}
          style={input}
        />
      )}

      {field.input === 'text' && (
        <input
          type="text"
          aria-label={field.label}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={input}
        />
      )}

      {field.input === 'amount' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            inputMode="decimal"
            aria-label={field.label}
            // Stored in base units as a string, because that is what the schema
            // and the contract take; shown in whole units, because nobody thinks
            // in drops.
            value={safeFormat(value, decimals)}
            onChange={(e) => {
              const parsed = safeParse(e.target.value, decimals)
              if (parsed !== null) onChange(parsed)
            }}
            style={{ ...input, flex: 1 }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{symbol}</span>
        </div>
      )}

      {field.input === 'toggle' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {value ? 'On' : 'Off'}
        </label>
      )}

      {field.help && <p style={help}>{field.help}</p>}
    </div>
  )
}

function DurationInput({
  seconds,
  onChange,
}: {
  seconds: number
  onChange: (seconds: number) => void
}) {
  const { value, unit } = splitDuration(seconds)

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <input
        type="number"
        min={1}
        aria-label="Amount of time"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 1) onChange(joinDuration(n, unit))
        }}
        style={{ ...input, width: 88 }}
      />
      <select
        aria-label="Unit of time"
        value={unit}
        onChange={(e) => onChange(joinDuration(value, e.target.value as 'days' | 'months' | 'years'))}
        style={{ ...input, flex: 1, cursor: 'pointer' }}
      >
        <option value="days">days</option>
        <option value="months">months</option>
        <option value="years">years</option>
      </select>
    </div>
  )
}

/** Base units to a display string, tolerating the empty and malformed cases. */
function safeFormat(value: unknown, decimals: number): string {
  try {
    return formatUnits(BigInt(String(value ?? '0')), decimals)
  } catch {
    return ''
  }
}

function safeParse(input: string, decimals: number): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return '0'
  if (!/^\d*\.?\d*$/.test(trimmed)) return null
  try {
    return parseUnits(trimmed, decimals).toString()
  } catch {
    return null
  }
}

const input = {
  padding: '8px var(--space-3)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
  fontSize: 13,
  width: '100%',
} as const

const help = {
  fontSize: 12,
  color: 'var(--text-tertiary)',
  lineHeight: 1.55,
  marginTop: 'var(--space-2)',
} as const

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12.5,
        fontWeight: 520,
        marginBottom: 'var(--space-2)',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </div>
  )
}
