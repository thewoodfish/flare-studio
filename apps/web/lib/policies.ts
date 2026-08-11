'use client'

import type { Address, Hex } from 'viem'
import { ADDRESSES, FACTORY_DEPLOY_BLOCK, coston2 } from './chain'
import {
  confidentialPolicyAbi,
  manualHeartbeatTriggerAbi,
  policyFactoryAbi,
  timestampTriggerAbi,
} from './abi'
import { publicClient } from './wallet'
import { allEntries, getEntry } from './vault'

/**
 * Reading the Deployment Manager's world.
 *
 * The chain is the source of truth for what exists: every policy a user owns is
 * a `PolicyDeployed` event, so there is no backend and no indexer to keep in
 * sync. The browser vault supplies only what the chain deliberately withholds --
 * the policy's name and its private half.
 *
 * The two are merged rather than one being preferred. A policy deployed from
 * another browser still lists (without a name); a policy whose logs the RPC
 * declines to serve still lists (from the vault). Neither failure produces an
 * empty screen, which for a demo is the failure that matters.
 */

/** The generic slice of ITrigger. Anything trigger-specific is asked for after. */
const triggerKindAbi = [
  {
    type: 'function',
    name: 'kind',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

export type PolicySummary = {
  address: Address
  /** From the vault when this browser deployed it; otherwise undefined. */
  name?: string
  status: number
  balance: bigint
  trigger: Address
  triggerKind: string
  /**
   * Unix seconds by which the owner must act, for triggers that have such a
   * notion. Absent for triggers that do not -- the UI must not assume one.
   */
  deadline?: number
  commitment: Hex
  /** True when this browser holds the salt, and so can still open the policy. */
  hasPrivateHalf: boolean
}

export async function listPolicies(owner: Address): Promise<PolicySummary[]> {
  const addresses = new Set<Address>()

  for (const entry of allEntries(coston2.id)) addresses.add(entry.policy)

  try {
    const pub = publicClient()
    const logs = await pub.getLogs({
      address: ADDRESSES.policyFactory,
      event: policyFactoryAbi[1],
      args: { owner },
      fromBlock: FACTORY_DEPLOY_BLOCK,
      toBlock: 'latest',
    })
    for (const log of logs) {
      if (log.args.policy) addresses.add(log.args.policy)
    }
  } catch (e) {
    // Range limits and rate limits are both routine on public testnet RPC. The
    // vault still covers everything this browser deployed, which is every
    // policy in a demo, so this degrades rather than fails.
    console.warn('[flare-studio] could not read PolicyDeployed logs', e)
  }

  const summaries = await Promise.all(
    [...addresses].map((address) => readPolicy(address).catch(() => null)),
  )

  // Newest first. Policies the vault knows about carry a deploy time; ones
  // discovered only from logs sort after them, which is the right default
  // given they are by definition not from this browser.
  return summaries
    .filter((s): s is PolicySummary => s !== null)
    .sort((a, b) => deployedAt(b.address) - deployedAt(a.address))
}

function deployedAt(policy: Address): number {
  return getEntry(policy)?.deployedAt ?? 0
}

export async function readPolicy(address: Address): Promise<PolicySummary> {
  const pub = publicClient()
  const base = { address, abi: confidentialPolicyAbi } as const

  const [status, balance, commitment, trigger] = await Promise.all([
    pub.readContract({ ...base, functionName: 'status' }),
    pub.readContract({ ...base, functionName: 'balance' }),
    pub.readContract({ ...base, functionName: 'commitment' }),
    pub.readContract({ ...base, functionName: 'trigger' }),
  ])

  const triggerKind = await pub
    .readContract({ address: trigger, abi: triggerKindAbi, functionName: 'kind' })
    .catch(() => 'unknown')

  const entry = getEntry(address)

  return {
    address,
    ...(entry?.name ? { name: entry.name } : {}),
    status: Number(status),
    balance,
    trigger,
    triggerKind,
    ...(await readDeadline(trigger, triggerKind, address)),
    commitment,
    hasPrivateHalf: entry !== null,
  }
}

/**
 * A deadline, where the trigger has one.
 *
 * Asked of the trigger by the kind *it* reports, not by what the vault thinks
 * was deployed -- the contract is authoritative about itself. Triggers with no
 * deadline return nothing rather than a sentinel, so the UI cannot accidentally
 * render a zero as a date.
 */
async function readDeadline(
  trigger: Address,
  kind: string,
  policy: Address,
): Promise<{ deadline?: number }> {
  const pub = publicClient()
  try {
    if (kind === 'manual-heartbeat') {
      const deadline = await pub.readContract({
        address: trigger,
        abi: manualHeartbeatTriggerAbi,
        functionName: 'deadlineOf',
        args: [policy],
      })
      return { deadline: Number(deadline) }
    }
    if (kind === 'timestamp') {
      const target = await pub.readContract({
        address: trigger,
        abi: timestampTriggerAbi,
        functionName: 'executeAfter',
        args: [policy],
      })
      return { deadline: Number(target) }
    }
  } catch {
    // An unconfigured trigger reverts. That is a real state -- deploy succeeded,
    // configure did not -- and the screen should show the policy without a
    // deadline rather than refuse to load.
  }
  return {}
}

/** Whether the demo control is available, which only the trigger knows. */
export async function readHeartbeatConfig(
  trigger: Address,
  policy: Address,
): Promise<{ owner: Address; interval: number; deadline: number; demoMode: boolean } | null> {
  try {
    const pub = publicClient()
    const [owner, interval, deadline, demoMode] = await pub.readContract({
      address: trigger,
      abi: manualHeartbeatTriggerAbi,
      functionName: 'configs',
      args: [policy],
    })
    return { owner, interval: Number(interval), deadline: Number(deadline), demoMode }
  } catch {
    return null
  }
}
