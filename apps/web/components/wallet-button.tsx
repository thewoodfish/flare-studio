'use client'

import { Button } from './shell'
import { Badge } from './primitives'
import { coston2 } from '@/lib/chain'
import type { WalletState } from '@/lib/wallet'

/**
 * The connect control, sized to sit in the top bar next to everything else.
 *
 * Three states, all designed rather than one plus two error strings: no wallet
 * installed, connected to the wrong network, and connected. The middle one is
 * the common case in practice and the one most dapps handle worst -- it gets a
 * button that fixes it, not a warning that describes it.
 */
export function WalletButton({
  wallet,
  /**
   * Secondary by default. There is one accent colour in this product and the
   * screen's own primary action has first claim on it -- two coral buttons side
   * by side in a top bar is the exact overuse the design direction warns about.
   * The deploy dialog passes `primary`, because there connecting *is* the action.
   */
  variant = 'secondary',
}: {
  wallet: WalletState
  variant?: 'primary' | 'secondary'
}) {
  if (!wallet.available) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: 13,
          fontWeight: 520,
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          padding: '6px var(--space-3)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
        }}
      >
        Install a wallet
      </a>
    )
  }

  if (!wallet.account) {
    return (
      <Button variant={variant} onClick={() => void wallet.connect()} disabled={wallet.connecting}>
        {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
      </Button>
    )
  }

  if (!wallet.onCoston2) {
    return (
      <Button variant={variant} onClick={() => void wallet.switchToCoston2()}>
        Switch to {coston2.name}
      </Button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <Badge tone="success">Coston2</Badge>
      <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        {wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}
      </span>
    </span>
  )
}
