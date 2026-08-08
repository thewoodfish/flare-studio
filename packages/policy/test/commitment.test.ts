import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeCommitment, canonicalize, type Distribution } from '../src/commitment.js'

const vectorsPath = fileURLToPath(new URL('../fixtures/commitment-vectors.json', import.meta.url))

type Vector = {
  name: string
  distributions: Array<{ recipient: string; amount: string }>
  salt: string
  expected: string
}

/**
 * These vectors are the contract between three languages. Solidity and Go read
 * this same file. If you change the encoding and only regenerate here, the other
 * two suites fail -- which is the entire point.
 */
describe('commitment vectors', () => {
  const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, 'utf8'))

  it('has vectors covering the shapes that actually break encoders', () => {
    const names = vectors.map((v) => v.name)
    expect(names).toContain('single-recipient')
    expect(names).toContain('two-recipients-uneven')
    expect(names).toContain('many-recipients')
    expect(names).toContain('zero-salt')
  })

  for (const vector of vectors) {
    it(`reproduces "${vector.name}"`, () => {
      const dists: Distribution[] = vector.distributions.map((d) => ({
        recipient: d.recipient as `0x${string}`,
        amount: BigInt(d.amount),
      }))
      expect(computeCommitment(dists, vector.salt as `0x${string}`)).toBe(vector.expected)
    })
  }
})

describe('computeCommitment', () => {
  const a = '0x1111111111111111111111111111111111111111' as const
  const b = '0x2222222222222222222222222222222222222222' as const
  const salt = `0x${'ab'.repeat(32)}` as const

  it('changes when a recipient changes', () => {
    const one = computeCommitment([{ recipient: a, amount: 10_000n }], salt)
    const two = computeCommitment([{ recipient: b, amount: 10_000n }], salt)
    expect(one).not.toBe(two)
  })

  it('changes when a share changes', () => {
    const one = computeCommitment(
      [
        { recipient: a, amount: 6000n },
        { recipient: b, amount: 4000n },
      ],
      salt,
    )
    const two = computeCommitment(
      [
        { recipient: a, amount: 5000n },
        { recipient: b, amount: 5000n },
      ],
      salt,
    )
    expect(one).not.toBe(two)
  })

  it('changes when the salt changes', () => {
    const dists = [{ recipient: a, amount: 10_000n }]
    expect(computeCommitment(dists, salt)).not.toBe(
      computeCommitment(dists, `0x${'cd'.repeat(32)}`),
    )
  })

  it('is order-sensitive, so the TEE must preserve recipient order', () => {
    const forward = computeCommitment(
      [
        { recipient: a, amount: 6000n },
        { recipient: b, amount: 4000n },
      ],
      salt,
    )
    const reversed = computeCommitment(
      [
        { recipient: b, amount: 4000n },
        { recipient: a, amount: 6000n },
      ],
      salt,
    )
    expect(forward).not.toBe(reversed)
  })
})

describe('canonicalize', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
  })

  it('sorts nested keys too', () => {
    expect(canonicalize({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}')
  })

  it('renders bigints as decimal strings rather than throwing', () => {
    expect(canonicalize({ n: 10n ** 20n })).toBe('{"n":"100000000000000000000"}')
  })

  it('preserves array order, which is semantic', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })
})
