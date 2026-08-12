import type { Address, Hex } from 'viem'
import { computeCommitment, canonicalize, type Distribution } from './commitment.js'
import { getAsset } from './assets.js'
import { policyIrSchema, type PolicyIR } from './schema.js'

/**
 * Splits a policy into the half the world may see and the half only the TEE may.
 *
 * This split is the product. Everything in `publicArgs` goes on-chain in the
 * clear; everything in `privateConfig` is encrypted to the enclave and never
 * appears in call data before execution. Getting a field on the wrong side is
 * the one bug that would quietly break the confidentiality claim while every
 * test still passed -- hence `test/split.test.ts`, which asserts that no
 * recipient address appears anywhere in the public half.
 *
 * Note there is no branch on template name anywhere in this file. If one appears,
 * this has become a renderer wearing a compiler's name.
 */

export type PublicArgs = {
  assetSymbol: string
  commitment: Hex
  trigger: PolicyIR['trigger']
  conditions: PolicyIR['conditions']
}

export type PrivateConfig = {
  version: 1
  name: string
  recipients: Array<{ address: Address; shareBps: number; label?: string }>
}

/**
 * The payload the enclave actually receives, and the only schema it accepts.
 *
 * Deliberately not `privateConfig`. The Go extension unmarshals into
 * `types.PrivateConfig{Shares, Salt}` and recomputes the commitment from exactly
 * those two fields; it has no use for a policy name or a recipient label, and
 * every byte it does not need is a byte of confidential data with no reason to
 * leave the browser.
 *
 * This split exists because they were once the same thing and silently diverged.
 * `compile()` emitted `{version, name, recipients}` with no salt at all, the
 * enclave rejected it with "policy has no shares", and nothing caught it --
 * because the cross-language ECIES vectors were hand-written in the correct
 * shape rather than generated from the compiler. The vectors proved the crypto
 * and never checked the contract.
 */
export type EnclaveConfig = {
  salt: Hex
  shares: Array<{ recipient: Address; shareBps: number }>
}

export type CompiledPolicy = {
  ir: PolicyIR
  publicArgs: PublicArgs
  /** The rich half, for the owner's own browser: names, labels, ordering. */
  privateConfig: PrivateConfig
  /** What the enclave is given, and all it is given. */
  enclaveConfig: EnclaveConfig
  /** Canonical JSON of enclaveConfig -- exactly the bytes that get encrypted. */
  plaintext: string
}

export class PolicyCompileError extends Error {
  constructor(
    message: string,
    /** Node id when the source was a canvas graph, so the UI can highlight it. */
    readonly nodeId?: string,
  ) {
    super(message)
    this.name = 'PolicyCompileError'
  }
}

/**
 * @param salt Random 32 bytes. Without it the commitment is brute-forceable:
 *        the recipient set is low-entropy and an attacker who guesses it could
 *        confirm the guess against the on-chain hash.
 */
export function compile(input: unknown, salt: Hex): CompiledPolicy {
  const parsed = policyIrSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new PolicyCompileError(
      `${first?.path.join('.') ?? 'policy'}: ${first?.message ?? 'invalid policy'}`,
    )
  }
  const ir = parsed.data

  // Throws with the list of known symbols if unknown -- assets are configuration.
  getAsset(ir.asset)

  const transfer = ir.actions.find((a) => a.kind === 'splitTransfer')
  if (!transfer) {
    throw new PolicyCompileError('policy has no distribution action')
  }

  const privateConfig: PrivateConfig = {
    version: 1,
    name: ir.name,
    recipients: transfer.recipients.map((r) => ({
      address: r.address as Address,
      shareBps: r.shareBps,
      ...(r.label !== undefined ? { label: r.label } : {}),
    })),
  }

  // The commitment covers shares, not amounts: the balance at execution time is
  // unknown when the policy is written. The TEE resolves shares against the
  // actual balance and the contract re-checks the resulting set against this
  // same commitment -- see resolveDistributions.
  const commitment = computeCommitment(shareCommitmentSet(privateConfig), salt)

  // Same recipients, same order, so the commitment the enclave recomputes from
  // this is byte-identical to the one fixed on-chain above.
  const enclaveConfig: EnclaveConfig = {
    salt,
    shares: privateConfig.recipients.map((r) => ({
      recipient: r.address,
      shareBps: r.shareBps,
    })),
  }

  return {
    ir,
    publicArgs: {
      assetSymbol: ir.asset,
      commitment,
      trigger: ir.trigger,
      conditions: ir.conditions,
    },
    privateConfig,
    enclaveConfig,
    plaintext: canonicalize(enclaveConfig),
  }
}

/**
 * The distribution set that the commitment is taken over.
 *
 * Amounts here are basis points, not token amounts. The TEE reproduces exactly
 * this set to re-derive the commitment, then separately computes real amounts.
 */
export function shareCommitmentSet(config: PrivateConfig): Distribution[] {
  return config.recipients.map((r) => ({
    recipient: r.address,
    amount: BigInt(r.shareBps),
  }))
}

/**
 * Turn shares into amounts against a concrete balance.
 *
 * The remainder from integer division is given to the last recipient so the
 * total always equals the balance exactly. Leaving dust in the contract would
 * strand it forever -- the policy is Executed and can never fire again.
 */
export function resolveDistributions(
  config: PrivateConfig,
  balance: bigint,
): Distribution[] {
  const out: Distribution[] = []
  let allocated = 0n

  config.recipients.forEach((r, i) => {
    const isLast = i === config.recipients.length - 1
    const amount = isLast
      ? balance - allocated
      : (balance * BigInt(r.shareBps)) / 10_000n
    allocated += amount
    out.push({ recipient: r.address, amount })
  })

  return out
}
