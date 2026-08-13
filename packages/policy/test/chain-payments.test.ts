import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Address } from 'viem'
import { policyReference, xrplMemoData, POLICY_REFERENCE_TAG } from '../src/chain-payments.js'

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/policy-reference-vectors.json', import.meta.url), 'utf8'),
) as { tag: string; cases: Array<{ policy: Address; reference: string }> }

/**
 * Both languages read this same file. Solidity's half is
 * PolicyReferenceVectors.t.sol -- if either implementation moves, one of the two
 * suites fails, which is the entire point of generating the file rather than
 * writing the expected values by hand in each.
 */
describe('policyReference', () => {
  it('reproduces every committed vector', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(5)
    for (const { policy, reference } of vectors.cases) {
      expect(policyReference(policy)).toBe(reference)
    }
  })

  it('pins the domain tag, which is part of the derivation', () => {
    expect(POLICY_REFERENCE_TAG).toBe(vectors.tag)
  })

  /** Two policies sharing a reference would let a proof about one arm the other. */
  it('gives different policies different references', () => {
    const a = policyReference('0x0000000000000000000000000000000000000001')
    const b = policyReference('0x0000000000000000000000000000000000000002')
    expect(a).not.toBe(b)
  })

  /** Checksummed and lowercase spellings are the same address. */
  it('is insensitive to address casing', () => {
    expect(policyReference('0x3c9d71Cd1D500C22eD34dcE94687Cb1ef585b815')).toBe(
      policyReference('0x3c9d71cd1d500c22ed34dce94687cb1ef585b815' as Address),
    )
  })

  it('produces a 32-byte value', () => {
    expect(policyReference('0x0000000000000000000000000000000000000001')).toMatch(
      /^0x[0-9a-f]{64}$/,
    )
  })
})

describe('xrplMemoData', () => {
  /**
   * XRPL memos are hex without the 0x, and the ledger upper-cases them. Handing
   * a user a string with the prefix still attached is a memo that will not match.
   */
  it('strips the prefix and upper-cases, as the ledger stores it', () => {
    const memo = xrplMemoData('0xabcdef0000000000000000000000000000000000000000000000000000000000')
    expect(memo).toBe('ABCDEF0000000000000000000000000000000000000000000000000000000000')
    expect(memo).toHaveLength(64)
    expect(memo).not.toContain('0x')
  })
})
