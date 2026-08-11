import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import type { Hex } from 'viem'
import { eciesDecrypt, eciesEncrypt, normalizeTeePublicKey } from '../src/ecies'

/**
 * Local round-trip and shape checks.
 *
 * These prove the implementation is self-consistent, which is necessary but not
 * sufficient: two matching bugs round-trip perfectly. The claim that actually
 * matters -- that `tee-node` can open what this produces -- is asserted on the
 * Go side, in apps/extension, against fixtures/ecies-vectors.json.
 */

const PRIVATE_KEY = '0xfad9c8855b740a0b7ed4c221dbad0f33a83a49cad6b3fe8d5817ac83d38b6a19'

function publicKeyOf(privateKey: string): Uint8Array {
  return secp256k1.getPublicKey(privateKey.slice(2), false)
}

describe('ecies', () => {
  it('round-trips a policy-shaped payload', () => {
    const plaintext = JSON.stringify({
      salt: '0x2222222222222222222222222222222222222222222222222222222222222222',
      shares: [
        { recipient: '0x1111111111111111111111111111111111111111', shareBps: 6000 },
        { recipient: '0x2222222222222222222222222222222222222222', shareBps: 4000 },
      ],
    })

    const ciphertext = eciesEncrypt(publicKeyOf(PRIVATE_KEY), plaintext)
    const recovered = new TextDecoder().decode(eciesDecrypt(PRIVATE_KEY, ciphertext))

    expect(recovered).toBe(plaintext)
  })

  it('lays out the ciphertext as go-ethereum expects', () => {
    const message = new TextEncoder().encode('hello')
    const ciphertext = eciesEncrypt(publicKeyOf(PRIVATE_KEY), message)
    const bytes = Buffer.from(ciphertext.slice(2), 'hex')

    // R (65) || iv (16) || ciphertext || tag (32)
    expect(bytes.length).toBe(65 + 16 + message.length + 32)
    expect(bytes[0]).toBe(0x04)
  })

  it('is non-deterministic across calls', () => {
    const key = publicKeyOf(PRIVATE_KEY)
    // A fresh ephemeral key and IV per message; identical ciphertexts would mean
    // the ephemeral key was being reused, which leaks plaintext equality.
    expect(eciesEncrypt(key, 'same')).not.toBe(eciesEncrypt(key, 'same'))
  })

  it('rejects a tampered ciphertext', () => {
    const ciphertext = eciesEncrypt(publicKeyOf(PRIVATE_KEY), 'sensitive')
    const bytes = Buffer.from(ciphertext.slice(2), 'hex')
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff // flip a bit in the tag

    const tampered: Hex = `0x${bytes.toString('hex')}`
    expect(() => eciesDecrypt(PRIVATE_KEY, tampered)).toThrow(/tag mismatch/)
  })

  it('rejects the wrong key', () => {
    const ciphertext = eciesEncrypt(publicKeyOf(PRIVATE_KEY), 'sensitive')
    const other: Hex = `0x${'11'.repeat(32)}`

    expect(() => eciesDecrypt(other, ciphertext)).toThrow(/tag mismatch/)
  })

  it('accepts compressed, uncompressed and bare public keys alike', () => {
    const uncompressed = publicKeyOf(PRIVATE_KEY)
    const compressed = secp256k1.getPublicKey(PRIVATE_KEY.slice(2), true)
    const bare = uncompressed.subarray(1)

    const normalized = [uncompressed, compressed, bare].map((k) =>
      Buffer.from(normalizeTeePublicKey(k)).toString('hex'),
    )

    expect(new Set(normalized).size).toBe(1)
    expect(normalized[0]).toBe(Buffer.from(uncompressed).toString('hex'))
  })
})
