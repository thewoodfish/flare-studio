/**
 * Regenerates fixtures/commitment-vectors.json from the TypeScript implementation.
 *
 * TypeScript is the reference implementation by convention -- someone has to be,
 * and the browser is where a commitment is first created. Solidity and Go assert
 * against the output; they never regenerate it.
 *
 *     pnpm --filter @flare-studio/policy vectors
 *
 * Expect the other two suites to fail after running this. That failure is the
 * cross-language safety net doing its job, not a problem with the fixture.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeCommitment, type Distribution } from '../src/commitment.js'

type Case = {
  name: string
  distributions: Array<{ recipient: string; amount: string }>
  salt: string
}

const cases: Case[] = [
  {
    name: 'single-recipient',
    distributions: [{ recipient: '0x1111111111111111111111111111111111111111', amount: '10000' }],
    salt: `0x${'11'.repeat(32)}`,
  },
  {
    name: 'two-recipients-uneven',
    distributions: [
      { recipient: '0x1111111111111111111111111111111111111111', amount: '6000' },
      { recipient: '0x2222222222222222222222222222222222222222', amount: '4000' },
    ],
    salt: `0x${'ab'.repeat(32)}`,
  },
  {
    // Multiple dynamic-array elements are where hand-rolled ABI encoders
    // usually get the offset header wrong.
    name: 'many-recipients',
    distributions: [
      { recipient: '0x1111111111111111111111111111111111111111', amount: '2500' },
      { recipient: '0x2222222222222222222222222222222222222222', amount: '2500' },
      { recipient: '0x3333333333333333333333333333333333333333', amount: '2500' },
      { recipient: '0x4444444444444444444444444444444444444444', amount: '2500' },
    ],
    salt: `0x${'cd'.repeat(32)}`,
  },
  {
    // A zero salt must still produce a well-defined hash. Never use one in
    // production -- it is what makes the commitment brute-forceable.
    name: 'zero-salt',
    distributions: [{ recipient: '0x1111111111111111111111111111111111111111', amount: '10000' }],
    salt: `0x${'00'.repeat(32)}`,
  },
  {
    name: 'max-address-and-share',
    distributions: [{ recipient: `0x${'ff'.repeat(20)}`, amount: '10000' }],
    salt: `0x${'ff'.repeat(32)}`,
  },
]

const vectors = cases.map((c) => {
  const dists: Distribution[] = c.distributions.map((d) => ({
    recipient: d.recipient as `0x${string}`,
    amount: BigInt(d.amount),
  }))
  return { ...c, expected: computeCommitment(dists, c.salt as `0x${string}`) }
})

const out = fileURLToPath(new URL('../fixtures/commitment-vectors.json', import.meta.url))
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`)
console.log(`wrote ${vectors.length} vectors to ${out}`)
for (const v of vectors) console.log(`  ${v.name.padEnd(24)} ${v.expected}`)
