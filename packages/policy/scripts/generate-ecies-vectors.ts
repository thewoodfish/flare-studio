import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secp256k1 } from '@noble/curves/secp256k1'
import { eciesEncrypt } from '../src/ecies'

/**
 * Emits ciphertexts for the Go suite in apps/extension to decrypt.
 *
 * The direction is deliberate and one-way. ECIES is randomised, so a fixed
 * ciphertext cannot be re-derived and compared the way the commitment vectors
 * are; what can be asserted is that the *other* implementation opens ours and
 * recovers the exact plaintext. That is also the direction that matters in
 * production -- the browser seals, the enclave opens.
 *
 * Regenerate with: pnpm --filter @flare-studio/policy ecies-vectors
 */

type Vector = {
  name: string
  privateKey: string
  plaintext: string
  ciphertext: string
}

// Fixed test keys. These are published in a fixture on purpose and must never
// be used for anything real.
const KEYS = {
  primary: '0xfad9c8855b740a0b7ed4c221dbad0f33a83a49cad6b3fe8d5817ac83d38b6a19',
  secondary: '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
}

const PAYLOADS: Array<{ name: string; key: keyof typeof KEYS; plaintext: string }> = [
  {
    name: 'single-share',
    key: 'primary',
    plaintext: JSON.stringify({
      salt: '0x1111111111111111111111111111111111111111111111111111111111111111',
      shares: [{ recipient: '0x1111111111111111111111111111111111111111', shareBps: 10000 }],
    }),
  },
  {
    name: 'two-shares',
    key: 'primary',
    plaintext: JSON.stringify({
      salt: '0xabababababababababababababababababababababababababababababababab',
      shares: [
        { recipient: '0x1111111111111111111111111111111111111111', shareBps: 6000 },
        { recipient: '0x2222222222222222222222222222222222222222', shareBps: 4000 },
      ],
    }),
  },
  {
    name: 'other-key',
    key: 'secondary',
    plaintext: JSON.stringify({
      salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      shares: [{ recipient: '0x3333333333333333333333333333333333333333', shareBps: 10000 }],
    }),
  },
  {
    // Multi-block, to exercise CTR across a block boundary rather than only the
    // short payloads a policy usually produces.
    name: 'long-payload',
    key: 'primary',
    plaintext: JSON.stringify({
      salt: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      shares: Array.from({ length: 20 }, (_, i) => ({
        recipient: `0x${String(i + 1).padStart(2, '0').repeat(20)}`,
        shareBps: i === 19 ? 10000 - 19 * 500 : 500,
      })),
    }),
  },
]

const vectors: Vector[] = PAYLOADS.map(({ name, key, plaintext }) => {
  const privateKey = KEYS[key]
  const publicKey = secp256k1.getPublicKey(privateKey.slice(2), false)

  return {
    name,
    privateKey,
    plaintext,
    ciphertext: eciesEncrypt(publicKey, plaintext),
  }
})

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'ecies-vectors.json',
)

writeFileSync(outputPath, `${JSON.stringify(vectors, null, 2)}\n`)
console.log(`wrote ${vectors.length} ECIES vectors to ${outputPath}`)
