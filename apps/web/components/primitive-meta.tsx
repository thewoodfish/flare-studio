'use client'

import type { ReactNode } from 'react'
import type { DiagramNodeType } from '@/lib/canvas'

/**
 * How each policy primitive presents itself: a name, a colour, an icon.
 *
 * One family of icons, one stroke width, one 16px box. This is the only place
 * that assigns visual identity to a primitive, so a new one is a single entry
 * here and the step strip, the panel header and anything later all agree
 * without being told.
 */
export const PRIMITIVE: Record<
  DiagramNodeType,
  { label: string; colour: string; icon: ReactNode }
> = {
  asset: { label: 'Asset', colour: '#1e5fa8', icon: <CoinIcon /> },
  trigger: { label: 'Trigger', colour: '#96601a', icon: <BoltIcon /> },
  condition: { label: 'Condition', colour: '#0f7b4a', icon: <FilterIcon /> },
  confidential: { label: 'Private', colour: '#6134c4', icon: <LockIcon /> },
  action: { label: 'Action', colour: '#e62058', icon: <ArrowIcon /> },
}

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
