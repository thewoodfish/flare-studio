import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'

/**
 * The commitment binds a policy to its private contents without revealing them.
 *
 * This is the single most dangerous function in the codebase -- not because it is
 * complex, but because the same value must be produced by three independent
 * implementations:
 *
 *   1. TypeScript, in the browser, when the user deploys a policy.
 *   2. Solidity, in ConfidentialPolicy.execute, when verifying the revealed set.
 *   3. Go, inside the TEE, when it decrypts and re-derives before signing.
 *
 * A mismatch between any two surfaces as an unexplainable revert at the worst
 * possible moment, with no useful error. So `fixtures/commitment-vectors.json`
 * is generated from THIS file and asserted by all three test suites. If you
 * change the encoding, regenerate the vectors and watch the other two languages
 * fail -- that failure is the safety net working.
 */

/** A single payout. `recipient`, never `beneficiary` -- see the genericity guard. */
export type Distribution = {
  recipient: Address
  amount: bigint
}

/**
 * ABI-encodes exactly as Solidity's `abi.encode(Distribution[], bytes32)` does,
 * then hashes.
 *
 * Solidity side (ConfidentialPolicy.execute):
 *     keccak256(abi.encode(dists, salt)) == commitment
 *
 * The tuple array plus trailing bytes32 must match that call verbatim, including
 * the dynamic-array offset header that `abi.encode` emits. This is why we use
 * viem's encoder rather than hand-rolling the layout: getting the offsets subtly
 * wrong is easy and the failure is silent until execution.
 */
export function computeCommitment(distributions: readonly Distribution[], salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'recipient', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
        },
        { type: 'bytes32' },
      ],
      [distributions.map((d) => ({ recipient: d.recipient, amount: d.amount })), salt],
    ),
  )
}

/**
 * Canonical JSON for the encrypted payload.
 *
 * Distinct from the commitment: this is what gets encrypted to the TEE, and it
 * carries labels and notes the chain never sees. Key order is fixed and bigints
 * become decimal strings so that a round-trip through JSON is byte-identical in
 * every language. `JSON.stringify` on a bigint throws, which is a useful
 * reminder rather than a limitation.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}
