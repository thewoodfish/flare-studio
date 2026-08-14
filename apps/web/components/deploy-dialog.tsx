'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatUnits, parseUnits, type Address } from 'viem'
import { getAsset, type CompiledPolicy } from '@flare-studio/policy'
import { Address as AddressChip, Badge } from './primitives'
import { Button } from './shell'
import { ADDRESSES, contractsConfigured, explorerTx } from '@/lib/chain'
import { erc20Abi } from '@/lib/abi'
import { publicClient, useWallet } from '@/lib/wallet'
import { deployPolicy, probeEnclaveKey, type DeployStep } from '@/lib/deploy'
import { exportEntry, type VaultEntry } from '@/lib/vault'
import { WalletButton } from './wallet-button'

/**
 * Deployment, as four visible steps rather than one opaque spinner.
 *
 * The design decision worth naming: the step list stays on screen after it
 * finishes. A user who has just signed four transactions wants to see the four
 * explorer links, not a checkmark that replaced them. It is also the panel a
 * judge will screenshot.
 */
export function DeployDialog({
  compiled,
  salt,
  templateId,
  onClose,
  onDeployed,
}: {
  compiled: CompiledPolicy
  salt: `0x${string}`
  templateId: string
  onClose: () => void
  onDeployed: (entry: VaultEntry) => void
}) {
  const wallet = useWallet()
  const asset = getAsset(compiled.ir.asset)

  const [amount, setAmount] = useState('')
  const [held, setHeld] = useState<bigint | null>(null)
  const [steps, setSteps] = useState<DeployStep[] | null>(null)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [entry, setEntry] = useState<VaultEntry | null>(null)
  const [enclave, setEnclave] = useState<{ ok: boolean; reason?: string } | null>(null)

  // The wallet's own balance, so "deposit" can be a decision rather than a guess.
  useEffect(() => {
    if (!wallet.account || !wallet.onCoston2) return
    let cancelled = false
    void publicClient()
      .readContract({
        address: ADDRESSES.fxrp,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet.account],
      })
      .then((balance) => {
        if (!cancelled) setHeld(balance)
      })
      .catch(() => {
        if (!cancelled) setHeld(null)
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account, wallet.onCoston2])

  // Asked before the user commits gas. Finding out afterwards that nothing was
  // sealed means a policy that can never pay out, which is exactly the failure
  // this check exists to make visible while it is still cheap.
  useEffect(() => {
    if (!wallet.account || !wallet.onCoston2) return
    let cancelled = false
    void probeEnclaveKey().then((r) => {
      if (!cancelled) setEnclave(r)
    })
    return () => {
      cancelled = true
    }
  }, [wallet.account, wallet.onCoston2])

  const parsedAmount = parseAmount(amount, asset.decimals)
  const overBalance = parsedAmount !== null && held !== null && parsedAmount > held
  const amountInvalid = amount.trim() !== '' && parsedAmount === null

  const run = useCallback(async () => {
    if (!wallet.account) return
    setRunning(true)
    setFailure(null)
    try {
      const result = await deployPolicy({
        compiled,
        salt,
        templateId,
        account: wallet.account as Address,
        deposit: parsedAmount ?? 0n,
        onProgress: setSteps,
      })
      setEntry(result)
      onDeployed(result)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [wallet.account, compiled, salt, templateId, parsedAmount, onDeployed])

  const dismissable = !running

  return (
    <div
      role="dialog"
      aria-label="Deploy policy"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 10, 11, 0.28)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-8)',
        zIndex: 60,
      }}
      onClick={() => dismissable && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '84vh',
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-popover)',
        }}
      >
        <header style={{ padding: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 'var(--space-4)',
            }}
          >
            <div>
              <h2>{entry ? 'Your policy is live' : 'Deploy your policy'}</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                {entry
                  ? 'It is now running on Coston2 and will act on its own.'
                  : 'Each step is a transaction you approve in your wallet.'}
              </p>
            </div>
            <WalletButton wallet={wallet} variant="primary" />
          </div>
        </header>

        {!contractsConfigured() ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <Badge tone="warning">Not configured</Badge>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginTop: 'var(--space-3)',
              }}
            >
              This build has no policy engine deployed to point at, so there is nothing to
              deploy into. Run the deploy script against Coston2 and put the resulting
              addresses in <code>apps/web/.env.local</code> — <code>pnpm preflight</code> will
              tell you exactly which are missing.
            </p>
          </div>
        ) : !wallet.account || !wallet.onCoston2 ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Connect a wallet on Coston2 to deploy. Your confidential inputs are encrypted in
              this browser before anything is sent, so connecting reveals nothing about who your
              recipients are.
            </p>
            {wallet.error && (
              <p style={{ fontSize: 13, color: 'var(--danger)', marginTop: 'var(--space-3)' }}>
                {wallet.error}
              </p>
            )}
          </div>
        ) : (
          <>
            {!steps && enclave && !enclave.ok && (
              <div style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
                <div
                  style={{
                    padding: 'var(--space-4)',
                    background: 'var(--warning-subtle)',
                    border: '1px solid var(--warning)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <Badge tone="warning">The enclave is unreachable</Badge>
                  <p
                    style={{
                      fontSize: 12.5,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      marginTop: 'var(--space-3)',
                    }}
                  >
                    Your confidential inputs cannot be encrypted right now, so this policy
                    would deploy without them and <strong>could never pay out</strong> until
                    they are sealed and sent. You can deploy anyway and do that later from the
                    policy screen — or stop, fix the connection, and start again.
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--text-tertiary)',
                      marginTop: 'var(--space-2)',
                    }}
                  >
                    {enclave.reason}
                  </p>
                </div>
              </div>
            )}

            {!steps && (
              <div style={{ padding: 'var(--space-5)' }}>
                <label
                  htmlFor="deposit"
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    fontWeight: 520,
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Amount to deposit now
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    id="deposit"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px var(--space-3)',
                      border: `1px solid ${
                        amountInvalid || overBalance ? 'var(--danger)' : 'var(--border-strong)'
                      }`,
                      borderRadius: 'var(--radius)',
                      background: 'var(--surface)',
                      fontSize: 13,
                    }}
                  />
                  <Button
                    onClick={() =>
                      held !== null && setAmount(formatUnits(held, asset.decimals))
                    }
                    disabled={held === null || held === 0n}
                  >
                    Max
                  </Button>
                </div>

                <p
                  style={{
                    fontSize: 12.5,
                    color: overBalance ? 'var(--danger)' : 'var(--text-secondary)',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {overBalance
                    ? 'That is more than your wallet holds.'
                    : held === null
                      ? `Balance unavailable`
                      : `You hold ${formatUnits(held, asset.decimals)} ${asset.symbol}`}
                </p>

                <p style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 'var(--space-4)', lineHeight: 1.6 }}>
                  Leave this empty to deploy an empty policy and fund it later. Nothing about the
                  policy changes either way — the split is fixed by proportion, not amount.
                </p>
              </div>
            )}

            {steps && <StepList steps={steps} />}

            {failure && (
              <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
                <p style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.6 }}>{failure}</p>
              </div>
            )}

            {entry && <Backup entry={entry} />}
          </>
        )}

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
            padding: 'var(--space-4) var(--space-5)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-sunken)',
          }}
        >
          {entry ? (
            <>
              <Button onClick={onClose}>Close</Button>
              <Link
                href={`/policies/${entry.policy}`}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--text-inverse)',
                  border: '1px solid var(--accent)',
                  padding: '6px var(--space-3)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  fontWeight: 520,
                  textDecoration: 'none',
                }}
              >
                Open policy
              </Link>
            </>
          ) : (
            <>
              <Button onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void run()}
                disabled={
                  running ||
                  !contractsConfigured() ||
                  !wallet.account ||
                  !wallet.onCoston2 ||
                  amountInvalid ||
                  overBalance
                }
              >
                {running ? 'Deploying…' : failure ? 'Try again' : 'Deploy'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function StepList({ steps }: { steps: DeployStep[] }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 'var(--space-5)' }}>
      {steps.map((step) => (
        <li
          key={step.id}
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            paddingBottom: 'var(--space-4)',
          }}
        >
          <StepMarker status={step.status} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 520,
                color:
                  step.status === 'pending' ? 'var(--text-tertiary)' : 'var(--text-primary)',
              }}
            >
              {step.label}
            </div>
            {step.note && (
              <div
                style={{
                  fontSize: 12.5,
                  color: step.status === 'error' ? 'var(--danger)' : 'var(--text-secondary)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {step.note}
              </div>
            )}
            {step.txHash && (
              <div style={{ marginTop: 4 }}>
                <AddressChip value={step.txHash} href={explorerTx(step.txHash)} chars={6} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepMarker({ status }: { status: DeployStep['status'] }) {
  const size = 18
  const common = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    marginTop: 1,
  } as const

  if (status === 'done') {
    return (
      <span style={{ ...common, background: 'var(--success-subtle)', color: 'var(--success)' }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span style={{ ...common, background: 'var(--danger-subtle)', color: 'var(--danger)' }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  if (status === 'running') {
    return (
      <span
        style={{
          ...common,
          border: '2px solid var(--accent-border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 700ms linear infinite',
        }}
      />
    )
  }

  if (status === 'skipped') {
    return (
      <span style={{ ...common, background: 'var(--surface-sunken)', color: 'var(--text-tertiary)' }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  return <span style={{ ...common, border: '1.5px solid var(--border-strong)' }} />
}

/**
 * The backup prompt.
 *
 * This is the honest consequence of the privacy design: the chain holds a hash,
 * so the salt and recipient list exist in exactly one place until the enclave
 * has them. Saying that here, at the moment the user is proud of what they just
 * made, is the only time they will act on it.
 */
function Backup({ entry }: { entry: VaultEntry }) {
  return (
    <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
      <div
        style={{
          padding: 'var(--space-4)',
          background: 'var(--confidential-subtle)',
          border: '1px solid var(--confidential-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Badge tone="confidential">Keep a copy</Badge>
        </div>
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--confidential)',
            lineHeight: 1.6,
            marginTop: 'var(--space-3)',
          }}
        >
          Your recipient list is stored in this browser and nowhere else. The policy on-chain
          holds only a hash of it, which cannot be reversed — so if you clear this browser
          without a backup, the policy can never pay out.
        </p>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button onClick={() => exportEntry(entry)}>Download backup</Button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <AddressChip value={entry.policy} chars={6} />
      </div>
    </div>
  )
}

/**
 * Parses a decimal amount, returning null rather than throwing or coercing.
 *
 * `parseUnits` is happy to accept things a user did not mean -- and an amount
 * silently read as something other than what is on screen is the worst possible
 * bug in a funding flow.
 */
function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim()
  if (trimmed === '') return 0n
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null
  try {
    const value = parseUnits(trimmed, decimals)
    return value < 0n ? null : value
  } catch {
    return null
  }
}
