'use client'

import {
  eciesEncrypt,
  policyReference,
  teePublicKeyFromInfo,
  type CompiledPolicy,
  type PolicyIR,
} from '@flare-studio/policy'
import { decodeEventLog, keccak256, toHex, type Address, type Hex } from 'viem'
import { ADDRESSES, coston2, enclaveHandoffConfigured } from './chain'
import { storePolicyOnChain } from './store-policy'
import {
  confidentialPolicyAbi,
  erc20Abi,
  fdcNonexistenceTriggerAbi,
  manualHeartbeatTriggerAbi,
  policyFactoryAbi,
  timestampTriggerAbi,
} from './abi'
import { publicClient, walletClient } from './wallet'
import { saveEntry, type VaultEntry } from './vault'

/**
 * Turning a compiled policy into a live contract.
 *
 * Four transactions, each of which the user sees and approves individually.
 * Batching them behind one button would be nicer to click and much worse to
 * recover from: when step three of four fails, a user needs to know that steps
 * one and two are already on-chain and paid for. So the flow reports progress
 * per step, keeps the policy address as soon as it exists, and is resumable in
 * the sense that nothing is repeated on retry.
 */

export type DeployStepId =
  | 'seal'
  | 'deploy'
  | 'configure'
  | 'handoff'
  | 'approve'
  | 'deposit'

export type DeployStep = {
  id: DeployStepId
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error'
  txHash?: Hex
  /** Shown under the step. Present on skips and errors, where "why" is the point. */
  note?: string
}

export class DeployError extends Error {
  constructor(message: string, readonly step: DeployStepId) {
    super(message)
    this.name = 'DeployError'
  }
}

/**
 * Which deployed contract implements a given trigger kind.
 *
 * This is the one legitimate switch on trigger kind in the app: a mapping from
 * IR to deployed bytecode has to live somewhere concrete. What matters is that
 * it is *only* this -- no template names, no policy-shaped branching, and adding
 * a trigger is one arm here, one arm below, and one contract.
 */
export function triggerAddress(trigger: PolicyIR['trigger']): Address {
  switch (trigger.kind) {
    case 'manualHeartbeat':
      return requireDeployed(ADDRESSES.manualHeartbeatTrigger, 'check-in trigger')
    case 'timestamp':
      return requireDeployed(ADDRESSES.timestampTrigger, 'scheduled-date trigger')
    case 'chainProofOfLife':
      return requireDeployed(ADDRESSES.fdcNonexistenceTrigger, 'payment proof-of-life trigger')
  }
}

/** The one-time setup call each trigger needs once its policy exists. */
export function configureRequest(
  trigger: PolicyIR['trigger'],
  owner: Address,
  policy: Address,
): { abi: readonly unknown[]; functionName: string; args: readonly unknown[] } {
  switch (trigger.kind) {
    case 'manualHeartbeat':
      return {
        abi: manualHeartbeatTriggerAbi,
        functionName: 'configure',
        args: [policy, owner, BigInt(trigger.intervalSeconds), trigger.demoMode],
      }
    case 'timestamp':
      return {
        abi: timestampTriggerAbi,
        functionName: 'configure',
        args: [policy, BigInt(trigger.executeAfter)],
      }
    case 'chainProofOfLife': {
      // The reference is derived from the policy's own address, which is why
      // this call could not be built before the policy existed -- and why a
      // proof about one policy is worthless against another.
      const reference = policyReference(policy)

      return {
        abi: fdcNonexistenceTriggerAbi,
        functionName: 'configure',
        args: [
          policy,
          {
            owner,
            sourceId: stringToBytes32(trigger.sourceId),
            // FDC hashes the destination as the UTF-8 bytes of the address
            // string, so the chain's own address format passes through
            // untouched and this stays chain-agnostic.
            destinationAddressHash: keccak256(toHex(trigger.destinationAddress)),
            paymentReference: reference,
            minimumAmount: BigInt(trigger.minimumAmount),
            interval: BigInt(trigger.intervalSeconds),
            // The clock starts when the policy is deployed, not when the user
            // opened the builder.
            start: BigInt(Math.floor(Date.now() / 1000)),
          },
        ],
      }
    }
  }
}

/** FDC source ids are left-aligned bytes32, e.g. `testXRP`. */
function stringToBytes32(value: string): Hex {
  const hex = Buffer.from(value, 'utf8').toString('hex')
  if (hex.length > 64) throw new DeployError(`source id "${value}" exceeds 32 bytes`, 'configure')
  return `0x${hex.padEnd(64, '0')}`
}

function requireDeployed(address: Address, what: string): Address {
  if (/^0x0+$/.test(address)) {
    throw new DeployError(
      `The ${what} is not deployed on ${coston2.name} yet.`,
      'configure',
    )
  }
  return address
}

export type DeployOptions = {
  compiled: CompiledPolicy
  salt: Hex
  templateId: string
  account: Address
  /** In the asset's base units. Zero funds the policy later rather than now. */
  deposit: bigint
  onProgress: (steps: DeployStep[]) => void
}

export async function deployPolicy(options: DeployOptions): Promise<VaultEntry> {
  const { compiled, salt, templateId, account, deposit, onProgress } = options

  const steps: DeployStep[] = [
    { id: 'seal', label: 'Encrypt your confidential inputs', status: 'pending' },
    { id: 'deploy', label: 'Create the policy contract', status: 'pending' },
    { id: 'configure', label: 'Set the trigger', status: 'pending' },
    { id: 'handoff', label: 'Hand the sealed policy to the enclave', status: 'pending' },
    { id: 'approve', label: `Approve ${compiled.ir.asset}`, status: 'pending' },
    { id: 'deposit', label: `Deposit ${compiled.ir.asset}`, status: 'pending' },
  ]

  const update = (id: DeployStepId, patch: Partial<DeployStep>) => {
    const step = steps.find((s) => s.id === id)!
    Object.assign(step, patch)
    onProgress([...steps])
  }

  const pub = publicClient()
  const wallet = walletClient(account)

  // Resolved before anything is signed. An undeployed trigger is a configuration
  // problem, and finding it out after paying for the factory call would be a
  // needlessly expensive way to learn it.
  const trigger = triggerAddress(compiled.ir.trigger)

  // --- 1. seal the private half ------------------------------------------

  update('seal', { status: 'running' })
  let ciphertext: Hex | undefined
  try {
    const teeKey = await fetchTeePublicKey()
    if (teeKey) {
      ciphertext = eciesEncrypt(teeKey, compiled.plaintext)
      update('seal', { status: 'done', note: `${compiled.plaintext.length} bytes sealed` })
    } else {
      // Not fatal, and not hidden either. The policy is still correct -- the
      // commitment is already fixed -- but the enclave cannot open it until
      // the sealed payload reaches it, so saying so beats a silent success.
      update('seal', {
        status: 'skipped',
        note: 'No enclave key available. Kept in this browser only.',
      })
    }
  } catch (e) {
    update('seal', { status: 'skipped', note: `Kept in this browser only (${message(e)})` })
  }

  // --- 2. create the policy ----------------------------------------------

  update('deploy', { status: 'running' })
  let policy: Address
  let deployTx: Hex
  try {
    deployTx = await wallet.writeContract({
      address: ADDRESSES.policyFactory,
      abi: policyFactoryAbi,
      functionName: 'deploy',
      args: [
        ADDRESSES.fxrp,
        compiled.publicArgs.commitment,
        ADDRESSES.teeAttestorGate,
        trigger,
        [],
      ],
      chain: coston2,
      account,
    })
    update('deploy', { txHash: deployTx })

    const receipt = await pub.waitForTransactionReceipt({ hash: deployTx })
    if (receipt.status !== 'success') throw new Error('the transaction reverted')

    policy = policyAddressFromReceipt(receipt.logs)
    update('deploy', { status: 'done', note: policy })
  } catch (e) {
    update('deploy', { status: 'error', note: message(e) })
    throw new DeployError(message(e), 'deploy')
  }

  // --- 3. configure the trigger ------------------------------------------

  update('configure', { status: 'running' })
  try {
    const request = configureRequest(compiled.ir.trigger, account, policy)
    const hash = await wallet.writeContract({
      address: trigger,
      abi: request.abi as never,
      functionName: request.functionName as never,
      args: request.args as never,
      chain: coston2,
      account,
    })
    update('configure', { txHash: hash })

    const receipt = await pub.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('the transaction reverted')
    update('configure', { status: 'done' })
  } catch (e) {
    update('configure', { status: 'error', note: message(e) })
    throw new DeployError(message(e), 'configure')
  }

  // Persist before the hand-off. The policy exists and is configured at this
  // point, and the salt is unrecoverable -- losing it because a later step
  // failed would be an unforced error.
  const entry: VaultEntry = {
    policy,
    chainId: coston2.id,
    name: compiled.ir.name,
    templateId,
    assetSymbol: compiled.ir.asset,
    salt,
    privateConfig: compiled.privateConfig,
    ...(ciphertext ? { ciphertext } : {}),
    triggerKind: compiled.ir.trigger.kind,
    triggerAddress: trigger,
    deployTx,
    deployedAt: Date.now(),
  }
  saveEntry(entry)

  // --- 4. hand the sealed payload to the enclave --------------------------

  // Deliberately non-fatal. A policy whose ciphertext has not reached the
  // enclave is still a correct, funded, armed-when-due policy -- it simply
  // cannot be evaluated yet, and the Monitor offers the hand-off again. Aborting
  // the deploy here would throw away four successful transactions over a step
  // that is retryable at any time.
  update('handoff', { status: 'running' })
  if (!ciphertext) {
    update('handoff', {
      status: 'skipped',
      note: 'Nothing sealed to send. Configure an enclave key, then retry from the policy screen.',
    })
  } else if (!enclaveHandoffConfigured()) {
    update('handoff', {
      status: 'skipped',
      note: 'No instruction sender configured in this build.',
    })
  } else {
    try {
      const handoff = await storePolicyOnChain({ policy, ciphertext, account })
      entry.handoff = { ...handoff, at: Date.now() }
      saveEntry(entry)
      update('handoff', { status: 'done', txHash: handoff.txHash })
    } catch (e) {
      update('handoff', { status: 'skipped', note: `${message(e)} You can retry from the policy screen.` })
    }
  }

  // --- 5. fund it ---------------------------------------------------------

  if (deposit === 0n) {
    const note = 'You can deposit any time from the policy screen.'
    update('approve', { status: 'skipped', note })
    update('deposit', { status: 'skipped' })
    return entry
  }

  update('approve', { status: 'running' })
  try {
    const hash = await wallet.writeContract({
      address: ADDRESSES.fxrp,
      abi: erc20Abi,
      functionName: 'approve',
      args: [policy, deposit],
      chain: coston2,
      account,
    })
    update('approve', { txHash: hash })
    await pub.waitForTransactionReceipt({ hash })
    update('approve', { status: 'done' })
  } catch (e) {
    update('approve', { status: 'error', note: message(e) })
    throw new DeployError(message(e), 'approve')
  }

  update('deposit', { status: 'running' })
  try {
    const hash = await wallet.writeContract({
      address: policy,
      abi: confidentialPolicyAbi,
      functionName: 'deposit',
      args: [deposit],
      chain: coston2,
      account,
    })
    update('deposit', { txHash: hash })

    const receipt = await pub.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('the transaction reverted')
    update('deposit', { status: 'done' })
  } catch (e) {
    update('deposit', { status: 'error', note: message(e) })
    throw new DeployError(message(e), 'deposit')
  }

  return entry
}

/**
 * The policy address, taken from the event rather than the return value.
 *
 * `deploy` returns the address, but a transaction's return data is not
 * available from a receipt -- only logs are. Re-simulating to recover it would
 * be a second round trip that can disagree with what actually happened.
 */
function policyAddressFromReceipt(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[]): Address {
  for (const log of logs) {
    if (log.address.toLowerCase() !== ADDRESSES.policyFactory.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: policyFactoryAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName === 'PolicyDeployed') return decoded.args.policy
    } catch {
      // Another event from the same address. Not an error; keep looking.
    }
  }
  throw new Error('the policy was created but its address could not be read from the receipt')
}

/**
 * The enclave's current public key, read live from the extension proxy.
 *
 * Deliberately not pinned in configuration: a machine that re-registers gets a
 * new key, and a stale pinned one produces ciphertext nothing can open --
 * which would surface as a failed execution weeks later rather than a failed
 * deploy now.
 */
/**
 * Can the enclave be sealed to right now?
 *
 * Exported so the deploy dialog can ask *before* the user spends gas. A policy
 * deployed without a sealed payload is correct, funded and armable, and can
 * never be evaluated -- which is a bad thing to discover on the monitor screen
 * afterwards. Reported as a warning rather than a block, because deploying now
 * and handing off later is legitimate.
 */
export async function probeEnclaveKey(): Promise<{ ok: boolean; reason?: string }> {
  if (!process.env.NEXT_PUBLIC_EXT_PROXY_URL) {
    return { ok: false, reason: 'No extension proxy is configured in this build.' }
  }
  try {
    const key = await fetchTeePublicKey()
    return key ? { ok: true } : { ok: false, reason: 'The proxy returned no machine key.' }
  } catch (e) {
    return { ok: false, reason: message(e) }
  }
}

async function fetchTeePublicKey(): Promise<Hex | null> {
  const base = process.env.NEXT_PUBLIC_EXT_PROXY_URL
  if (!base) return null

  const response = await fetch(`${base.replace(/\/$/, '')}/info`, {
    signal: AbortSignal.timeout(5_000),
    headers: {
      Accept: 'application/json',
      // Without this, an ngrok free tunnel serves its HTML interstitial to
      // anything that looks like a browser and proxies only for everything
      // else. The headless demo runs under Node and never sees it; the browser
      // gets a warning page where it expected JSON, and the deploy quietly
      // records "no enclave key available". Any value works; the header only
      // has to be present.
      'ngrok-skip-browser-warning': 'true',
    },
  })
  if (!response.ok) throw new Error(`proxy returned ${response.status}`)

  // Assert the content type before parsing. A tunnel interstitial, a login
  // page or a 200-with-HTML error all fail here with something that names the
  // cause, rather than as a JSON parse error twenty lines away.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new Error(
      `proxy returned ${contentType || 'an unknown content type'} instead of JSON -- ` +
        'the tunnel is probably serving a warning or error page rather than the enclave',
    )
  }

  // The key arrives as {x, y} coordinates, not a hex string. Parsing it here by
  // hand is how this silently returned an object that eciesEncrypt rejected,
  // turning "encrypt the confidential half" into a skipped step.
  return teePublicKeyFromInfo(await response.json())
}

function message(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const err = e as { code?: number; shortMessage?: string; message?: string }
    if (err.code === 4001) return 'You rejected the request in your wallet.'
    if (err.shortMessage) return err.shortMessage
    if (err.message) return err.message.split('\n')[0]!
  }
  return String(e)
}
