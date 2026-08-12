import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { confidentialPolicyAbi } from './abi.js'
import {
  decodeActionData,
  pollActionResult,
  sendEvaluatePolicy,
  type PollOptions,
} from './instructions.js'

/**
 * The evaluate-then-execute round trip, which is where the design earns its keep.
 *
 * Everything the enclave returns is checked again on-chain: the shares must hash
 * to the commitment fixed at deploy time, and the signer must be a PRODUCTION
 * machine. So this function can be wrong, or hostile, without being dangerous --
 * the worst it can do is submit something the contract rejects.
 */

/** Mirrors the enclave's EvaluatePolicyResponse. */
export type EvaluationResult = {
  policy: Address
  shares: { recipient: Address; shareBps: number }[]
  salt: Hex
  signature: Hex
}

/**
 * Asks the enclave to evaluate an armed policy and returns its signed answer.
 *
 * `triggeredAt` is read from the policy rather than taken as a parameter: it is
 * what binds the signature to this specific arming, and a caller-supplied value
 * that drifted from on-chain state would produce a signature that silently fails
 * to recover.
 */
export async function evaluatePolicy(
  clients: { public: PublicClient; wallet: WalletClient },
  { instructionSender, policy, extProxyUrl }: {
    instructionSender: Address
    policy: Address
    /** The extension proxy's public URL -- the same value registered on-chain. */
    extProxyUrl: string
  },
  options: PollOptions = {},
): Promise<EvaluationResult> {
  const triggeredAt = await clients.public.readContract({
    address: policy,
    abi: confidentialPolicyAbi,
    functionName: 'triggeredAt',
  })

  if (triggeredAt === 0n) {
    throw new Error(`policy ${policy} is not armed; call arm() before evaluating`)
  }

  const { instructionId } = await sendEvaluatePolicy(
    clients,
    instructionSender,
    policy,
    triggeredAt,
  )

  const response = await pollActionResult(extProxyUrl, instructionId, options)
  const evaluation = decodeActionData<EvaluationResult>(response)

  // Go's encoding/json renders []byte as base64, so the enclave's `signature`
  // arrives base64 while `salt` and every address arrive as hex -- common.Hash
  // and common.Address have their own MarshalText, []byte does not. Handing the
  // base64 straight to viem produces "cannot unmarshal invalid hex string",
  // several layers from anything that names the cause.
  return { ...evaluation, signature: asHexBytes(evaluation.signature) }
}

/**
 * Normalises a byte field that may arrive as hex or as Go's base64.
 *
 * Tolerating both is deliberate: the encoding is decided by whichever Go type
 * the enclave happens to use for a field, which is not a detail this side should
 * have to track per field.
 */
function asHexBytes(value: string): Hex {
  if (/^0x[0-9a-fA-F]*$/.test(value)) return value as Hex

  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0) throw new Error(`could not decode signature: ${value.slice(0, 24)}…`)
  return `0x${bytes.toString('hex')}`
}

/**
 * Submits the enclave's distribution to the policy.
 *
 * Simulating before sending is what turns a bare "execution reverted" into the
 * actual custom error -- CommitmentMismatch, SignerNotAttested, WrongStatus --
 * which is the difference between a five-minute fix and an afternoon. viem's
 * simulate also hands back the prepared request, so this costs nothing extra.
 */
export async function executePolicy(
  clients: { public: PublicClient; wallet: WalletClient },
  policy: Address,
  evaluation: EvaluationResult,
): Promise<Hex> {
  const account = clients.wallet.account
  if (!account) throw new Error('wallet client has no account')

  const args = [
    evaluation.shares.map((s) => ({ recipient: s.recipient, shareBps: s.shareBps })),
    evaluation.salt,
    evaluation.signature,
  ] as const

  const { request } = await clients.public.simulateContract({
    address: policy,
    abi: confidentialPolicyAbi,
    functionName: 'execute',
    args: args as never,
    account,
  })

  const txHash = await clients.wallet.writeContract(request)
  const receipt = await clients.public.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status !== 'success') {
    throw new Error(`execute reverted (tx ${txHash})`)
  }

  return txHash
}
