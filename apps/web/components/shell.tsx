'use client'

import type { ReactNode } from 'react'

/**
 * The three-pane studio shell: icon rail, content, inspector.
 *
 * Every screen -- builder, deployment manager, monitor -- renders inside this,
 * which is what makes the product read as one tool rather than three pages that
 * happen to share a colour scheme.
 */
export function Shell({
  rail,
  children,
  inspector,
}: {
  rail?: ReactNode
  children: ReactNode
  inspector?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `56px 1fr ${inspector ? '320px' : ''}`,
        height: '100vh',
        background: 'var(--surface-shell)',
      }}
    >
      <nav
        style={{
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 'var(--space-3)',
          gap: 'var(--space-1)',
        }}
      >
        {rail}
      </nav>

      <main style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

      {inspector && (
        <aside
          style={{
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            overflowY: 'auto',
          }}
        >
          {inspector}
        </aside>
      )}
    </div>
  )
}

export function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        width: 36,
        height: 36,
        display: 'grid',
        placeItems: 'center',
        border: 'none',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        transition: `background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)`,
      }}
    >
      {children}
    </button>
  )
}

export function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        minHeight: 56,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 560, letterSpacing: '-0.011em' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 1 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>{actions}</div>
    </header>
  )
}

export function Button({
  children,
  variant = 'secondary',
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--text-inverse)',
      border: '1px solid var(--accent)',
    },
    secondary: {
      background: 'var(--surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid transparent',
    },
  } as const

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: '6px var(--space-3)',
        borderRadius: 'var(--radius)',
        fontSize: 13,
        fontWeight: 520,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease)`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

/**
 * A designed empty state, not a centred grey sentence.
 *
 * The empty Deployment Manager is the first screen most people will see, so it
 * is a moment worth designing rather than a fallback.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        padding: 'var(--space-10)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div
          style={{
            width: 44,
            height: 44,
            margin: '0 auto var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-strong)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-tertiary)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 5.6v4.8M5.6 8h4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <h3 style={{ marginBottom: 'var(--space-2)' }}>{title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{body}</p>
        {action && <div style={{ marginTop: 'var(--space-5)' }}>{action}</div>}
      </div>
    </div>
  )
}
