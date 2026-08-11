'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * The icon rail, shared by every screen.
 *
 * It lives in one component rather than being repeated per page for the obvious
 * reason and one less obvious one: the active state has to be derived from the
 * route, and a rail copied into three files is a rail that will disagree with
 * itself in two of them.
 */
export function Rail() {
  const pathname = usePathname()

  return (
    <>
      <RailLink href="/studio" label="Builder" active={pathname.startsWith('/studio')}>
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 4.5h3.5a1 1 0 0 1 1 1V9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </RailLink>

      <RailLink href="/policies" label="Policies" active={pathname.startsWith('/policies')}>
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
          <rect x="2.5" y="2" width="11" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </RailLink>
    </>
  )
}

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        width: 36,
        height: 36,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--radius)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        transition: `background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease)`,
      }}
    >
      {children}
    </Link>
  )
}
