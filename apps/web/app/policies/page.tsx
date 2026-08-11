'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getAsset } from '@flare-studio/policy'
import { Shell, TopBar, EmptyState, Button } from '@/components/shell'
import { Rail } from '@/components/rail'
import { Amount, Address as AddressChip, Badge, Duration } from '@/components/primitives'
import { WalletButton } from '@/components/wallet-button'
import { useWallet } from '@/lib/wallet'
import { listPolicies, type PolicySummary } from '@/lib/policies'
import { explorerAddress } from '@/lib/chain'
import { PolicyStatus } from '@/lib/abi'

/**
 * The Deployment Manager.
 *
 * Every row is a real contract at a real address, because the factory deploys
 * clones rather than writing rows into a registry. That is why each one links
 * to the explorer: "deployed" is a claim the user can check for themselves,
 * which is worth more than any badge we could render.
 */
export default function PoliciesPage() {
  const wallet = useWallet()
  const [policies, setPolicies] = useState<PolicySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!wallet.account) return
    setError(null)
    try {
      setPolicies(await listPolicies(wallet.account))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPolicies([])
    }
  }, [wallet.account])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Shell rail={<Rail />}>
      <TopBar
        title="Policies"
        subtitle="Everything you have deployed on Coston2"
        actions={
          <>
            <WalletButton wallet={wallet} />
            <Link
              href="/studio"
              style={{
                background: 'var(--accent)',
                color: 'var(--text-inverse)',
                border: '1px solid var(--accent)',
                padding: '6px var(--space-3)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                fontWeight: 520,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              New policy
            </Link>
          </>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
        {!wallet.account ? (
          <EmptyState
            title="Connect your wallet"
            body="Your policies live on-chain, so this list is read from Coston2 rather than from an account with us."
            action={<Button variant="primary" onClick={() => void wallet.connect()}>Connect wallet</Button>}
          />
        ) : policies === null ? (
          <SkeletonRows />
        ) : policies.length === 0 ? (
          <EmptyState
            title="No policies yet"
            body="A policy is a rule your assets follow on their own — who receives what, and what has to happen first. Start from a template and you will have one in a couple of minutes."
            action={
              <Link
                href="/studio"
                style={{
                  background: 'var(--accent)',
                  color: 'var(--text-inverse)',
                  border: '1px solid var(--accent)',
                  padding: '8px var(--space-4)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  fontWeight: 520,
                  textDecoration: 'none',
                }}
              >
                Create your first policy
              </Link>
            }
          />
        ) : (
          <div style={{ maxWidth: 880, margin: '0 auto', display: 'grid', gap: 'var(--space-3)' }}>
            {error && (
              <p style={{ fontSize: 12.5, color: 'var(--warning)' }}>
                Some data could not be read from the network: {error}
              </p>
            )}
            {policies.map((policy) => (
              <PolicyCard key={policy.address} policy={policy} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

function PolicyCard({ policy }: { policy: PolicySummary }) {
  const asset = getAsset('FXRP')
  const statusName = PolicyStatus[policy.status as keyof typeof PolicyStatus] ?? 'Unknown'

  return (
    <Link
      href={`/policies/${policy.address}`}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4) var(--space-5)',
        transition: `border-color var(--duration-fast) var(--ease)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 14, fontWeight: 560 }}>
              {policy.name ?? 'Untitled policy'}
            </span>
            <StatusBadge status={statusName} />
            {!policy.hasPrivateHalf && <Badge tone="warning">No local copy</Badge>}
          </div>

          <div style={{ marginTop: 'var(--space-2)' }}>
            <AddressChip value={policy.address} href={explorerAddress(policy.address)} chars={6} />
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 560 }}>
            <Amount value={policy.balance} decimals={asset.decimals} symbol={asset.symbol} />
          </div>
          {policy.deadline !== undefined && policy.status === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              <Duration seconds={policy.deadline - Math.floor(Date.now() / 1000)} />
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  // Plain language, per the copy rule. "Triggered" is engine vocabulary; what a
  // user needs to know is that the policy is now waiting to pay out.
  switch (status) {
    case 'Active':
      return <Badge tone="success">Active</Badge>
    case 'Triggered':
      return <Badge tone="warning">Ready to distribute</Badge>
    case 'Executed':
      return <Badge tone="info">Distributed</Badge>
    case 'Cancelled':
      return <Badge tone="neutral">Cancelled</Badge>
    default:
      return <Badge tone="neutral">{status}</Badge>
  }
}

/**
 * Skeletons matching the card geometry exactly, so nothing reflows when the
 * real rows arrive. A spinner here would be one line of code and a visible snap.
 */
function SkeletonRows() {
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', display: 'grid', gap: 'var(--space-3)' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4) var(--space-5)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 17, width: '38%' }} />
            <div className="skeleton" style={{ height: 15, width: '26%', marginTop: 10 }} />
          </div>
          <div style={{ width: 120 }}>
            <div className="skeleton" style={{ height: 20, width: '100%' }} />
            <div className="skeleton" style={{ height: 14, width: '60%', marginTop: 6, marginLeft: 'auto' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
