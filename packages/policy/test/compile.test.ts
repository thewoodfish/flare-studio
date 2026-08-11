import { describe, expect, it } from 'vitest'
import { compile, resolveDistributions, PolicyCompileError } from '../src/compile.js'
import { TEMPLATES, getTemplate } from '../src/templates/index.js'

const SALT = `0x${'ab'.repeat(32)}` as const

const alice = '0x1111111111111111111111111111111111111111'
const bob = '0x2222222222222222222222222222222222222222'

function policy(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    name: 'Test policy',
    asset: 'FXRP',
    trigger: { kind: 'manualHeartbeat', intervalSeconds: 86_400, demoMode: true },
    conditions: [],
    actions: [
      {
        kind: 'splitTransfer',
        recipients: [
          { address: alice, shareBps: 6000, label: 'Alice' },
          { address: bob, shareBps: 4000, label: 'Bob' },
        ],
      },
    ],
    ...overrides,
  }
}

describe('the public/private split', () => {
  /**
   * This is the test that protects the entire product claim. Everything in
   * publicArgs goes on-chain in the clear. If a recipient address or a label
   * ever leaks into it, confidentiality is broken while every other test still
   * passes -- so assert on the serialized form rather than on known field names,
   * because a future field could carry it too.
   */
  it('leaks no recipient address into the public half', () => {
    const { publicArgs } = compile(policy(), SALT)
    const serialized = JSON.stringify(publicArgs).toLowerCase()

    expect(serialized).not.toContain(alice.toLowerCase().slice(2))
    expect(serialized).not.toContain(bob.toLowerCase().slice(2))
  })

  it('leaks no recipient label into the public half', () => {
    const { publicArgs } = compile(policy(), SALT)
    const serialized = JSON.stringify(publicArgs)
    expect(serialized).not.toContain('Alice')
    expect(serialized).not.toContain('Bob')
  })

  it('keeps recipients in the private half', () => {
    const { privateConfig } = compile(policy(), SALT)
    expect(privateConfig.recipients).toHaveLength(2)
    expect(privateConfig.recipients[0]?.address).toBe(alice)
  })

  it('produces a commitment that binds the private half', () => {
    const original = compile(policy(), SALT)
    const altered = compile(
      policy({
        actions: [
          {
            kind: 'splitTransfer',
            recipients: [
              { address: alice, shareBps: 9000 },
              { address: bob, shareBps: 1000 },
            ],
          },
        ],
      }),
      SALT,
    )
    expect(original.publicArgs.commitment).not.toBe(altered.publicArgs.commitment)
  })
})

describe('validation', () => {
  it('rejects shares that do not total 100%', () => {
    expect(() =>
      compile(
        policy({
          actions: [
            {
              kind: 'splitTransfer',
              recipients: [
                { address: alice, shareBps: 6000 },
                { address: bob, shareBps: 3000 },
              ],
            },
          ],
        }),
        SALT,
      ),
    ).toThrow(/10000|100%/)
  })

  it('rejects a duplicated recipient rather than silently combining', () => {
    expect(() =>
      compile(
        policy({
          actions: [
            {
              kind: 'splitTransfer',
              recipients: [
                { address: alice, shareBps: 5000 },
                { address: alice, shareBps: 5000 },
              ],
            },
          ],
        }),
        SALT,
      ),
    ).toThrow(/duplicate/i)
  })

  it('names the unknown asset and lists the known ones', () => {
    expect(() => compile(policy({ asset: 'FDOGE' }), SALT)).toThrow(/FDOGE.*FXRP/s)
  })

  it('throws PolicyCompileError, not a raw zod error', () => {
    expect(() => compile({ version: 1 }, SALT)).toThrow(PolicyCompileError)
  })
})

describe('resolveDistributions', () => {
  const config = {
    version: 1 as const,
    name: 'x',
    recipients: [
      { address: alice as `0x${string}`, shareBps: 6000 },
      { address: bob as `0x${string}`, shareBps: 4000 },
    ],
  }

  it('splits an even balance exactly', () => {
    const out = resolveDistributions(config, 1000n)
    expect(out.map((d) => d.amount)).toEqual([600n, 400n])
  })

  /**
   * Once a policy is Executed it can never fire again, so any remainder left in
   * the contract is stranded forever. The last recipient absorbs it.
   */
  it('leaves no dust on an indivisible balance', () => {
    const balance = 1_000_000_007n
    const out = resolveDistributions(config, balance)
    expect(out.reduce((sum, d) => sum + d.amount, 0n)).toBe(balance)
  })

  it('handles a balance smaller than the number of recipients', () => {
    const out = resolveDistributions(config, 1n)
    expect(out.reduce((sum, d) => sum + d.amount, 0n)).toBe(1n)
  })

  it('handles a zero balance without throwing', () => {
    const out = resolveDistributions(config, 0n)
    expect(out.reduce((sum, d) => sum + d.amount, 0n)).toBe(0n)
  })
})

/**
 * The genericity claim, tested rather than asserted. A second template must cost
 * a template file and nothing else -- no schema change, no compiler branch. If
 * this test ever needs the compiler to know which template it is handling, the
 * abstraction has leaked.
 */
describe('genericity', () => {
  it('compiles both templates through the identical code path', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(2)
    for (const template of TEMPLATES) {
      const compiled = compile(
        template.build({ recipients: [{ address: alice, shareBps: 10_000 }] }),
        SALT,
      )
      expect(compiled.publicArgs.commitment).toMatch(/^0x[0-9a-f]{64}$/)
      expect(compiled.privateConfig.recipients).toHaveLength(1)
    }
  })

  /**
   * The asset-swap drill, as a test rather than a claim.
   *
   * The README says adding FBTC the day it goes live is one entry in assets.ts
   * and no other change. That is easy to assert and easy to be wrong about, so
   * here it is exercised: a policy compiles against a second asset through the
   * same compiler, producing the same shape, with nothing asset-specific
   * anywhere in the path.
   *
   * Note what is *not* needed to make this pass -- no contract change, no new
   * trigger, no compiler branch, no schema field. If a third asset ever needs
   * one of those, the genericity claim has stopped being true and this test is
   * where it should start failing.
   */
  it('compiles against a second asset with no other change', () => {
    const inXrp = compile(policy({ asset: 'FXRP' }), SALT)
    const inBtc = compile(policy({ asset: 'FBTC' }), SALT)

    expect(inBtc.publicArgs.assetSymbol).toBe('FBTC')
    expect(inBtc.publicArgs.commitment).toMatch(/^0x[0-9a-f]{64}$/)

    // The commitment covers the distribution, which did not change -- so swapping
    // the asset must not move it. If it did, something asset-specific had leaked
    // into the confidential half.
    expect(inBtc.publicArgs.commitment).toBe(inXrp.publicArgs.commitment)
    expect(inBtc.privateConfig).toEqual(inXrp.privateConfig)
  })

  /**
   * The decimals difference is real -- FXRP has 6, FBTC has 8 -- and the engine
   * must not care. Shares are proportions; the token's own arithmetic is the
   * token's business.
   */
  it('resolves the same proportions regardless of the asset decimals', () => {
    const { privateConfig } = compile(policy({ asset: 'FBTC' }), SALT)
    const distributions = resolveDistributions(privateConfig, 100_000_000n)

    expect(distributions.map((d) => d.amount)).toEqual([60_000_000n, 40_000_000n])
  })

  it('gives the two templates different triggers, same everything else', () => {
    const args = { recipients: [{ address: alice, shareBps: 10_000 }] }
    const a = compile(getTemplate('xrp-inheritance').build(args), SALT)
    const b = compile(getTemplate('scheduled-distribution').build(args), SALT)

    expect(a.publicArgs.trigger.kind).not.toBe(b.publicArgs.trigger.kind)
    // Same recipients and salt, so the confidential half is byte-identical --
    // proof that the trigger is genuinely orthogonal to the distribution.
    expect(a.publicArgs.commitment).toBe(b.publicArgs.commitment)
  })
})
