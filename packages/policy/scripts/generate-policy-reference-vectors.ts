/**
 * Generates the shared policyReference vectors.
 *
 * Committed so the Solidity side asserts against bytes this implementation
 * produced, rather than both sides being written from the same prose and
 * agreeing only in the author's head -- which is exactly how the enclave payload
 * schema diverged.
 *
 *     pnpm --filter @flare-studio/policy reference-vectors
 */
import { writeFileSync } from 'node:fs'
import type { Address } from 'viem'
import { policyReference, POLICY_REFERENCE_TAG } from '../src/chain-payments.js'

const POLICIES: Address[] = [
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x3c9d71Cd1D500C22eD34dcE94687Cb1ef585b815',
  '0x121B80EBe51Ea8A8f352fA5Cfe70c080c9E2F854',
  '0xffffffffffffffffffffffffffffffffffffffff',
]

const vectors = {
  tag: POLICY_REFERENCE_TAG,
  cases: POLICIES.map((policy) => ({ policy, reference: policyReference(policy) })),
}

const path = new URL('../fixtures/policy-reference-vectors.json', import.meta.url)
writeFileSync(path, `${JSON.stringify(vectors, null, 2)}\n`)
console.log(`wrote ${vectors.cases.length} vectors`)
