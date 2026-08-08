'use client'

import { useState, useCallback, type ReactNode } from 'react'

/**
 * Formatting primitives.
 *
 * Every number and address in the product goes through here. A raw
 * `toLocaleString()` at a call site is how alignment and precision drift apart
 * between screens, and that drift is one of the clearest tells of a rushed
 * build.
 */

/**
 * A token amount.
 *
 * Values arrive as base units (drops for XRP, satoshis for BTC) because that is
 * what the chain deals in; converting early and passing floats around is how
 * rounding errors get into money.
 */
export function Amount({
  value,
  decimals,
  symbol,
  precision = 2,
  muted = false,
}: {
  value: bigint
  decimals: number
  symbol?: string
  /** Fraction digits shown. The full value is always in the title attribute. */
  precision?: number
  muted?: boolean
}) {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fraction = abs % base

  const fractionStr = fraction.toString().padStart(decimals, '0')
  const shown = precision > 0 ? fractionStr.slice(0, precision) : ''

  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const exact = `${negative ? '-' : ''}${groupedWhole}${decimals > 0 ? `.${fractionStr}` : ''}`

  return (
    <span
      title={`${exact}${symbol ? ` ${symbol}` : ''}`}
      style={{ color: muted ? 'var(--text-secondary)' : undefined, whiteSpace: 'nowrap' }}
    >
      {negative ? '-' : ''}
      {groupedWhole}
      {shown && <span style={{ color: 'var(--text-tertiary)' }}>.{shown}</span>}
      {symbol && (
        <span style={{ color: 'var(--text-tertiary)', marginLeft: 'var(--space-1)' }}>
          {symbol}
        </span>
      )}
    </span>
  )
}

/** Basis points as a percentage. 6000 -> 60%. */
export function Share({ bps }: { bps: number }) {
  const whole = bps / 100
  const text = Number.isInteger(whole) ? `${whole}%` : `${whole.toFixed(2)}%`
  return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
}

/**
 * A truncated, copyable address or hash.
 *
 * Copy gives real feedback rather than a bare `alert` -- and it restores itself,
 * because a button stuck reading "Copied" is a lie about the current state.
 */
export function Address({
  value,
  chars = 4,
  href,
  label,
}: {
  value: string
  chars?: number
  /** Explorer link. Present on anything that exists on-chain. */
  href?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }, [value])

  const truncated =
    value.length > chars * 2 + 4
      ? `${value.slice(0, chars + 2)}…${value.slice(-chars)}`
      : value

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      {href ? (
        <a
          className="mono"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={value}
          style={{
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            borderBottom: '1px solid var(--border-strong)',
            paddingBottom: '1px',
          }}
        >
          {label ?? truncated}
        </a>
      ) : (
        <span className="mono" title={value} style={{ color: 'var(--text-secondary)' }}>
          {label ?? truncated}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${value}`}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'inline-flex',
          color: copied ? 'var(--success)' : 'var(--text-tertiary)',
          transition: `color var(--duration-fast) var(--ease)`,
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'confidential' | 'accent'
}) {
  const tones = {
    neutral: ['var(--surface-sunken)', 'var(--text-secondary)', 'var(--border)'],
    success: ['var(--success-subtle)', 'var(--success)', 'transparent'],
    warning: ['var(--warning-subtle)', 'var(--warning)', 'transparent'],
    danger: ['var(--danger-subtle)', 'var(--danger)', 'transparent'],
    info: ['var(--info-subtle)', 'var(--info)', 'transparent'],
    confidential: [
      'var(--confidential-subtle)',
      'var(--confidential)',
      'var(--confidential-border)',
    ],
    accent: ['var(--accent-subtle)', 'var(--accent)', 'var(--accent-border)'],
  } as const
  const [bg, fg, border] = tones[tone]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius-sm)',
        padding: '2px var(--space-2)',
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/**
 * A countdown that degrades gracefully.
 *
 * Past deadlines read "overdue" rather than showing a negative number, because
 * "-3d" is a puzzle and "overdue by 3d" is information.
 */
export function Duration({ seconds }: { seconds: number }) {
  const overdue = seconds < 0
  const abs = Math.abs(seconds)

  const units: Array<[number, string]> = [
    [86_400, 'd'],
    [3_600, 'h'],
    [60, 'm'],
    [1, 's'],
  ]

  // Show the largest unit plus one below it: "3d 4h" carries more than "3d",
  // and far more than "276480s".
  let text = '0s'
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i]!
    if (abs < size) continue

    const major = Math.floor(abs / size)
    const next = units[i + 1]
    const minor = next ? Math.floor((abs % size) / next[0]) : 0
    text = next && minor > 0 ? `${major}${suffix} ${minor}${next[1]}` : `${major}${suffix}`
    break
  }

  return (
    <span style={{ color: overdue ? 'var(--warning)' : undefined, whiteSpace: 'nowrap' }}>
      {overdue ? `overdue by ${text}` : text}
    </span>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
