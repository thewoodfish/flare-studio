import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { secp256k1 } from '@noble/curves/secp256k1'
import { teePublicKeyFromInfo } from '../src/tee-info.js'
import { eciesEncrypt, normalizeTeePublicKey } from '../src/ecies.js'

/**
 * The fixture is a real /info response from a registered machine on Coston2,
 * captured on 12 Aug 2026. It is here rather than hand-written because the whole
 * point of this module is that the shape was not what we assumed.
 */
const live = JSON.parse(
  readFileSync(new URL('../fixtures/tee-info.sample.json', import.meta.url), 'utf8'),
)

describe('teePublicKeyFromInfo', () => {
  it('reads the live proxy shape', () => {
    const key = teePublicKeyFromInfo(live)
    expect(key).toMatch(/^0x04[0-9a-f]{128}$/)
  })

  /**
   * The assertion that would have caught the original bug. The key must be
   * usable by the encryption path, not merely present -- "we found something at
   * machineData.publicKey" was true of the object form too.
   */
  it('produces a key the ECIES path accepts', () => {
    const key = teePublicKeyFromInfo(live)
    expect(normalizeTeePublicKey(key)).toHaveLength(65)
    expect(() => eciesEncrypt(key, 'hello')).not.toThrow()
  })

  /** A malformed point would encrypt to nothing anyone can open. */
  it('yields a point that is actually on the curve', () => {
    const key = teePublicKeyFromInfo(live)
    expect(() => secp256k1.ProjectivePoint.fromHex(key.slice(2)).assertValidity()).not.toThrow()
  })

  it('accepts coordinates without the 0x prefix', () => {
    const key = teePublicKeyFromInfo({
      machineData: { publicKey: { x: 'aa'.repeat(32), y: 'bb'.repeat(32) } },
    })
    expect(key).toBe(`0x04${'aa'.repeat(32)}${'bb'.repeat(32)}`)
  })

  it('falls back to teeInfo when machineData has no key', () => {
    const key = teePublicKeyFromInfo({ teeInfo: { publicKey: live.teeInfo.publicKey } })
    expect(key).toMatch(/^0x04[0-9a-f]{128}$/)
  })

  /**
   * Throwing beats returning null. The bug this module exists to prevent was a
   * silent skip -- a caller that treats "no key" as "carry on without
   * encrypting" is the failure mode, so there is no quiet path out of here.
   */
  it('throws rather than returning nothing when the key is absent', () => {
    expect(() => teePublicKeyFromInfo({ machineData: {} })).toThrow(/no machineData.publicKey/)
    expect(() => teePublicKeyFromInfo(null)).toThrow()
  })

  it('rejects a hex string, which is the shape we wrongly assumed', () => {
    expect(() => teePublicKeyFromInfo({ machineData: { publicKey: '0xdeadbeef' } })).toThrow()
  })

  it('rejects coordinates of the wrong length', () => {
    expect(() =>
      teePublicKeyFromInfo({ machineData: { publicKey: { x: '0xaa', y: '0xbb' } } }),
    ).toThrow(/must be 32/)
  })
})
