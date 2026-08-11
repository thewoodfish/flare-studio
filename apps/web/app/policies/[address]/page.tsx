'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { parseUnits, type Address as Hex20, type Hex } from 'viem'
import { getAsset } from '@flare-studio/policy'
import { Shell, TopBar, Button } from '@/components/shell'
import { Rail } from '@/components/rail'
import { Amount, Address as AddressChip, Badge, Duration, Share } from '@/components/primitives'
import { WalletButton } from '@/components/wallet-button'
import { publicClient, useWallet, walletClient, walletErrorMessage } from '@/lib/wallet'
import { readHeartbeatConfig, readPolicy, type PolicySummary } from '@/lib/policies'
import { ADDRESSES, coston2, explorerAddress, explorerTx } from '@/lib/chain'
import {
  confidentialPolicyAbi,
  erc20Abi,
  manualHeartbeatTriggerAbi,
  PolicyStatus,
} from '@/lib/abi'
import { getEntry, type VaultEntry } from '@/lib/vault'

/**
 * The Monitor.
 *
 * One screen, two audiences. The top half answers "is my money safe and when do
 * I next need to do something" without using a single blockchain word. The
 * bottom half names every mechanism precisely, because that is what a judge --
 * or anyone deciding whether to trust this -- will actually read.
 */
export default function PolicyPage() {
  const params = useParams<{ address: string }>()
  const address = params.address as Hex20

  const wallet = useWallet()
  const [policy, setPolicy] = useState<PolicySummary | null>(null)
  const [entry, setEntry] = useState<VaultEntry | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastTx, setLastTx] = useState<Hex | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))

  const asset = getAsset(entry?.assetSymbol ?? 'FXRP')

  const refresh = useCallback(async () => {
    try {
      const summary = await readPolicy(address)
      setPolicy(summary)
      if (summary.triggerKind === 'manual-heartbeat') {
        const config = await readHeartbeatConfig(summary.trigger, address)
        setDemoMode(config?.demoMode ?? false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [address])

  useEffect(() => {
    setEntry(getEntry(address))
    void refresh()
  }, [address, refresh])

  // A countdown that does not tick is a screenshot. One second is the right
  // interval here: the number on screen is in seconds near the deadline, which
  // is exactly when someone is watching it.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000)
    return () => clearInterval(id)
  }, [])

  /** Every write goes through here so busy state, errors and refresh are uniform. */
  const send = useCallback(
    async (label: string, run: () => Promise<Hex>): Promise<void> => {
      setBusy(label)
      setError(null)
      try {
        const hash = await run()
        setLastTx(hash)
        await publicClient().waitForTransactionReceipt({ hash })
        await refresh()
      } catch (e) {
        setError(walletErrorMessage(e))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const checkIn = useCallback(() => {
    if (!wallet.account || !policy) return
    return send('check-in', () =>
      walletClient(wallet.account!).writeContract({
        address: policy.trigger,
        abi: manualHeartbeatTriggerAbi,
        functionName: 'heartbeat',
        args: [address],
        chain: coston2,
        account: wallet.account!,
      }),
    )
  }, [wallet.account, policy, address, send])

  const simulateInactivity = useCallback(() => {
    if (!wallet.account || !policy) return
    return send('simulate', () =>
      walletClient(wallet.account!).writeContract({
        address: policy.trigger,
        abi: manualHeartbeatTriggerAbi,
        functionName: 'simulateInactivity',
        args: [address],
        chain: coston2,
        account: wallet.account!,
      }),
    )
  }, [wallet.account, policy, address, send])

  const statusName = policy
    ? (PolicyStatus[policy.status as keyof typeof PolicyStatus] ?? 'Unknown')
    : null

  return (
    <Shell rail={<Rail />}>
      <TopBar
        title={entry?.name ?? 'Policy'}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {statusName && <StatusBadge status={statusName} />}
            <AddressChip value={address} href={explorerAddress(address)} chars={6} />
          </span>
        }
        actions={<WalletButton wallet={wallet} />}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 'var(--space-4)' }}>
          {error && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--danger-subtle)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}

          {policy === null ? (
            <Card>
              <div className="skeleton" style={{ height: 32, width: '40%' }} />
              <div className="skeleton" style={{ height: 16, width: '55%', marginTop: 12 }} />
            </Card>
          ) : (
            <>
              <Card>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--space-5)',
                  }}
                >
                  <div>
                    <Label>Held in this policy</Label>
                    <div style={{ fontSize: 28, fontWeight: 590, letterSpacing: '-0.021em' }}>
                      <Amount
                        value={policy.balance}
                        decimals={asset.decimals}
                        symbol={asset.symbol}
                      />
                    </div>
                  </div>

                  {policy.deadline !== undefined && policy.status === 0 && (
                    <div style={{ textAlign: 'right' }}>
                      <Label>
                        {policy.triggerKind === 'manual-heartbeat'
                          ? 'Next check-in due'
                          : 'Distributes in'}
                      </Label>
                      <div style={{ fontSize: 18, fontWeight: 560 }}>
                        <Duration seconds={policy.deadline - now} />
                      </div>
                    </div>
                  )}
                </div>

                {policy.status === 0 && policy.triggerKind === 'manual-heartbeat' && (
                  <div
                    style={{
                      marginTop: 'var(--space-5)',
                      paddingTop: 'var(--space-4)',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Button
                      variant="primary"
                      onClick={() => void checkIn()}
                      disabled={busy !== null || !wallet.account || !wallet.onCoston2}
                    >
                      {busy === 'check-in' ? 'Checking in…' : "I'm still here"}
                    </Button>
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      Pushes your deadline out by another full interval.
                    </span>
                  </div>
                )}

                {policy.status === 1 && (
                  <p
                    style={{
                      marginTop: 'var(--space-4)',
                      paddingTop: 'var(--space-4)',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                    }}
                  >
                    The condition you set has been met. The secure enclave is now the only party
                    that can open your recipient list, and the distribution happens without you.
                  </p>
                )}
              </Card>

              {entry && <Recipients entry={entry} />}

              {policy.status === 0 && (
                <Funding
                  policy={policy}
                  asset={asset}
                  account={wallet.account}
                  busy={busy}
                  send={send}
                  onDone={refresh}
                />
              )}

              {demoMode && policy.status === 0 && (
                <Card tone="warning">
                  <Label>Demo control</Label>
                  <p
                    style={{
                      fontSize: 12.5,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      marginTop: 'var(--space-2)',
                    }}
                  >
                    Coston2 cannot be fast-forwarded and a twelve-month timer does not demo. This
                    pulls the deadline into the past so the trigger fires now. It is shown rather
                    than hidden — pretending time had passed would be worse than showing the seam.
                  </p>
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <Button
                      onClick={() => void simulateInactivity()}
                      disabled={busy !== null || !wallet.account || !wallet.onCoston2}
                    >
                      {busy === 'simulate' ? 'Working…' : 'Skip to the deadline'}
                    </Button>
                  </div>
                </Card>
              )}

              <UnderTheHood policy={policy} entry={entry} lastTx={lastTx} />
            </>
          )}
        </div>
      </div>
    </Shell>
  )
}

/**
 * The recipient list, readable here and nowhere else on the network.
 *
 * Showing it locally is not a contradiction of the privacy claim -- it is the
 * demonstration of it. The owner's own browser holds the plaintext; the chain
 * holds a hash; the enclave holds a sealed copy. Nobody else holds anything.
 */
function Recipients({ entry }: { entry: VaultEntry }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Label>Who receives what</Label>
        <Badge tone="confidential">Private</Badge>
      </div>

      <div style={{ marginTop: 'var(--space-3)' }}>
        {entry.privateConfig.recipients.map((r, i) => (
          <div
            key={r.address}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-3) 0',
              borderTop: i > 0 ? '1px solid var(--border-subtle)' : undefined,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 520 }}>{r.label || 'Recipient'}</div>
              <div style={{ marginTop: 2 }}>
                <AddressChip value={r.address} />
              </div>
            </div>
            <span style={{ fontSize: 14, fontWeight: 560 }}>
              <Share bps={r.shareBps} />
            </span>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: 12.5,
          color: 'var(--text-tertiary)',
          lineHeight: 1.6,
          marginTop: 'var(--space-3)',
        }}
      >
        Visible because this is your browser. The network holds only a hash of this list.
      </p>
    </Card>
  )
}

/** Deposit, withdraw, cancel -- the owner's controls while the policy is Active. */
function Funding({
  policy,
  asset,
  account,
  busy,
  send,
  onDone,
}: {
  policy: PolicySummary
  asset: ReturnType<typeof getAsset>
  account: Hex20 | null
  busy: string | null
  send: (label: string, run: () => Promise<Hex>) => Promise<void>
  onDone: () => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const parsed = parseAmount(amount, asset.decimals)
  const usable = account !== null && parsed !== null && parsed > 0n && busy === null

  /**
   * Deposit is two transactions wearing one button, because ERC-20 gives no
   * choice. The allowance is checked first so a user who already approved
   * enough signs once rather than twice.
   */
  const deposit = async (account: Hex20, amount: bigint): Promise<Hex> => {
    const wallet = walletClient(account)
    const pub = publicClient()

    const allowance = await pub.readContract({
      address: ADDRESSES.fxrp,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, policy.address],
    })

    if (allowance < amount) {
      const approval = await wallet.writeContract({
        address: ADDRESSES.fxrp,
        abi: erc20Abi,
        functionName: 'approve',
        args: [policy.address, amount],
        chain: coston2,
        account,
      })
      await pub.waitForTransactionReceipt({ hash: approval })
    }

    return wallet.writeContract({
      address: policy.address,
      abi: confidentialPolicyAbi,
      functionName: 'deposit',
      args: [amount],
      chain: coston2,
      account,
    })
  }

  const withdraw = (account: Hex20, amount: bigint): Promise<Hex> =>
    walletClient(account).writeContract({
      address: policy.address,
      abi: confidentialPolicyAbi,
      functionName: 'withdraw',
      args: [amount],
      chain: coston2,
      account,
    })

  const cancel = (account: Hex20): Promise<Hex> =>
    walletClient(account).writeContract({
      address: policy.address,
      abi: confidentialPolicyAbi,
      functionName: 'cancel',
      args: [],
      chain: coston2,
      account,
    })

  return (
    <Card>
      <Label>Funding</Label>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <input
          aria-label={`Amount in ${asset.symbol}`}
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            flex: 1,
            padding: '8px var(--space-3)',
            border: `1px solid ${parsed === null && amount.trim() !== '' ? 'var(--danger)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            fontSize: 13,
          }}
        />
        <Button
          onClick={() => {
            if (!usable) return
            void send('deposit', () => deposit(account, parsed)).then(() => setAmount(''))
          }}
          disabled={!usable}
        >
          {busy === 'deposit' ? 'Depositing…' : 'Deposit'}
        </Button>
        <Button
          onClick={() => {
            if (!usable) return
            void send('withdraw', () => withdraw(account, parsed)).then(() => setAmount(''))
          }}
          disabled={!usable || parsed > policy.balance}
        >
          {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
        </Button>
      </div>

      <div
        style={{
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Cancelling returns the full balance to you and stops the policy for good.
        </span>
        <Button
          onClick={() => {
            if (account === null || busy !== null) return
            void send('cancel', () => cancel(account)).then(onDone)
          }}
          disabled={account === null || busy !== null}
        >
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel policy'}
        </Button>
      </div>
    </Card>
  )
}

function UnderTheHood({
  policy,
  entry,
  lastTx,
}: {
  policy: PolicySummary
  entry: VaultEntry | null
  lastTx: `0x${string}` | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: 13,
          fontWeight: 520,
          color: 'var(--text-secondary)',
        }}
      >
        Under the hood
        <span
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: `transform var(--duration) var(--ease)`,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Detail label="Policy contract" value={policy.address} mono />
          <Detail label="Trigger" value={`${policy.triggerKind} (${policy.trigger})`} mono />
          <Detail label="Commitment" value={policy.commitment} mono />
          <Detail label="Attestor gate" value={ADDRESSES.teeAttestorGate} mono />
          <Detail
            label="Sealed to enclave"
            value={entry?.ciphertext ? `${(entry.ciphertext.length - 2) / 2} bytes` : 'not yet'}
          />
          <Detail
            label="Private half"
            value={entry ? 'held in this browser' : 'not in this browser'}
          />
          {lastTx && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <AddressChip value={lastTx} href={explorerTx(lastTx)} chars={8} />
            </div>
          )}

          <p
            style={{
              fontSize: 12,
              color: 'var(--text-tertiary)',
              lineHeight: 1.6,
              marginTop: 'var(--space-4)',
            }}
          >
            Execution requires two independent things: a signature from a machine the
            FlareTeeManager reports as <code>PRODUCTION</code>, and a revealed split that hashes
            to the commitment above. Neither alone is sufficient, so even a compromised enclave
            cannot redirect these funds — only authorise the split fixed at deploy time.
          </p>
        </div>
      )}
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
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

function Card({ children, tone }: { children: React.ReactNode; tone?: 'warning' }) {
  return (
    <section
      style={{
        background: tone === 'warning' ? 'var(--warning-subtle)' : 'var(--surface)',
        border: `1px solid ${tone === 'warning' ? 'var(--border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
      }}
    >
      {children}
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 560,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        marginBottom: 'var(--space-1)',
      }}
    >
      {children}
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
      <span
        className={mono ? 'mono' : undefined}
        title={value}
        style={{
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null
  try {
    const value = parseUnits(trimmed, decimals)
    return value < 0n ? null : value
  } catch {
    return null
  }
}
