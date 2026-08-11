'use client'

import type { Address, Hex } from 'viem'
import type { PrivateConfig } from '@flare-studio/policy'
import { coston2 } from './chain'

/**
 * The browser's copy of everything the chain deliberately does not know.
 *
 * A deployed policy stores only `keccak256(shares ‖ salt)`. That is the privacy
 * guarantee working as designed, and it has a direct consequence: lose the salt
 * and the recipient set, and the policy can never be executed by anyone. The
 * commitment cannot be reversed -- that is the point of it.
 *
 * So this is not a cache. Until the enclave hand-off lands, it is the only copy,
 * which is why `exportEntry` exists and why the Monitor screen says so plainly
 * rather than letting a user discover it later.
 *
 * Where this goes next: the same payload, ECIES-sealed to the enclave's public
 * key, submitted on-chain via `sendStorePolicy`. At that point the enclave holds
 * the authoritative copy, this becomes a genuine cache, and losing it stops
 * mattering. `ciphertext` below is already populated when a TEE key is
 * configured, so that step is a submission rather than a redesign.
 */

const KEY = 'flare-studio.vault.v1'

export type VaultEntry = {
  policy: Address
  chainId: number
  /** The policy's display name, so the manager can render before any RPC call. */
  name: string
  templateId: string
  assetSymbol: string
  /** Without this the commitment can never be opened. */
  salt: Hex
  privateConfig: PrivateConfig
  /** ECIES-sealed `privateConfig`, present once a TEE public key is configured. */
  ciphertext?: Hex
  /**
   * The hand-off, once the sealed payload has reached the enclave on-chain.
   *
   * Its presence is what turns this file from the only copy into a cache: after
   * this, the enclave can open the policy without the browser, and losing the
   * vault stops being fatal.
   */
  handoff?: { instructionId: Hex; txHash: Hex; at: number }
  triggerKind: string
  triggerAddress: Address
  deployTx: Hex
  deployedAt: number
}

function read(): VaultEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as VaultEntry[]) : []
  } catch {
    // A corrupt vault must not take the whole app down with it. The policies
    // themselves are still on-chain and still listed; only the private halves
    // are lost, and that is already the worst case this file guards against.
    return []
  }
}

function write(entries: VaultEntry[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(entries))
}

export function allEntries(chainId: number = coston2.id): VaultEntry[] {
  return read()
    .filter((e) => e.chainId === chainId)
    .sort((a, b) => b.deployedAt - a.deployedAt)
}

export function getEntry(policy: Address): VaultEntry | null {
  const wanted = policy.toLowerCase()
  return read().find((e) => e.policy.toLowerCase() === wanted) ?? null
}

export function saveEntry(entry: VaultEntry): void {
  const wanted = entry.policy.toLowerCase()
  write([...read().filter((e) => e.policy.toLowerCase() !== wanted), entry])
}

/**
 * A downloadable backup of the one thing that cannot be recovered.
 *
 * Offered at the end of the deploy flow rather than buried in a settings screen,
 * because the moment a user has just created something is the only moment they
 * are motivated to back it up.
 */
export function exportEntry(entry: VaultEntry): void {
  const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flare-studio-policy-${entry.policy.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
