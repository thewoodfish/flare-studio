import { ctr } from '@noble/ciphers/aes'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import type { Hex } from 'viem'

/**
 * ECIES, in the exact dialect go-ethereum speaks.
 *
 * This is the browser half of the confidentiality story: the private part of a
 * policy is encrypted here, travels on-chain as opaque bytes, and is opened only
 * inside the enclave. No server of ours ever holds it.
 *
 * The counterparty is not negotiable and not configurable. `tee-node` decrypts
 * with `pk.Decrypt(ciphertext, nil, nil)` over go-ethereum's `crypto/ecies`,
 * which selects `ECIES_AES128_SHA256` for secp256k1. Every constant below is
 * pinned to that profile:
 *
 *   - ephemeral key as an uncompressed point (65 bytes, 0x04-prefixed)
 *   - NIST SP 800-56 concatenation KDF over SHA-256
 *   - AES-128-CTR
 *   - HMAC-SHA-256 over `iv || ciphertext`, full 32-byte tag
 *
 * A tempting shortcut is `eciesjs`, which defaults to AES-256-GCM and produces
 * ciphertext the node cannot open. It is not a drop-in; do not substitute it.
 *
 * The layout on the wire:
 *
 *     R (65) || iv (16) || ciphertext (n) || tag (32)
 */

/** AES-128: the KDF yields 2 x 16 bytes, per ECIES_AES128_SHA256. */
const KEY_LEN = 16
const IV_LEN = 16
const TAG_LEN = 32
/** Uncompressed secp256k1 point: 0x04 || X(32) || Y(32). */
const PUBKEY_LEN = 65

/**
 * NIST SP 800-56 concatenation KDF (go-ethereum's `concatKDF`).
 *
 * For SHA-256 and 32 bytes of output this is a single round, but it is written
 * as a loop because that is what the specification says and what geth
 * implements -- a hardcoded single round would silently diverge if the profile
 * ever changed.
 */
function concatKDF(z: Uint8Array, outputLen: number): Uint8Array {
  const out = new Uint8Array(outputLen)
  let written = 0
  let counter = 1

  while (written < outputLen) {
    const counterBytes = new Uint8Array(4)
    new DataView(counterBytes.buffer).setUint32(0, counter, false) // big-endian

    const block = sha256(concat(counterBytes, z))
    const take = Math.min(block.length, outputLen - written)
    out.set(block.subarray(0, take), written)

    written += take
    counter += 1
  }

  return out
}

/**
 * Derives the encryption and MAC keys, mirroring geth's `deriveKeys`.
 *
 * Note the asymmetry that is easy to miss: Ke is used raw, but Km is *hashed
 * again* before it becomes the HMAC key. Skipping that second hash produces a
 * tag the node rejects, with no clue as to why.
 */
function deriveKeys(z: Uint8Array): { encryptionKey: Uint8Array; macKey: Uint8Array } {
  const derived = concatKDF(z, 2 * KEY_LEN)
  return {
    encryptionKey: derived.subarray(0, KEY_LEN),
    macKey: sha256(derived.subarray(KEY_LEN, 2 * KEY_LEN)),
  }
}

/**
 * The shared secret is the X coordinate alone, left-padded to 32 bytes.
 *
 * geth copies `x.Bytes()` into a zeroed buffer, so a shared X with leading zero
 * bytes must stay left-padded. Noble already returns a fixed-width point, so
 * slicing is enough -- but the padding is the reason this is a named function
 * rather than an inline slice.
 */
function sharedSecretX(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const point = secp256k1.getSharedSecret(privateKey, publicKey, false)
  return point.subarray(1, 1 + 32)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function toBytes(value: Hex | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value
  const hex = value.startsWith('0x') ? value.slice(2) : value
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function toHex(bytes: Uint8Array): Hex {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return `0x${hex}`
}

/**
 * Normalises a TEE public key to the uncompressed 65-byte form geth expects.
 *
 * The machine may report its key compressed (33 bytes) or uncompressed, with or
 * without the 0x04 prefix. All three appear in practice, so accept them rather
 * than making the caller guess.
 */
export function normalizeTeePublicKey(publicKey: Hex | Uint8Array): Uint8Array {
  const raw = toBytes(publicKey)

  if (raw.length === PUBKEY_LEN && raw[0] === 0x04) return raw
  if (raw.length === 64) return concat(new Uint8Array([0x04]), raw)
  if (raw.length === 33 && (raw[0] === 0x02 || raw[0] === 0x03)) {
    return secp256k1.ProjectivePoint.fromHex(raw).toRawBytes(false)
  }

  throw new Error(
    `unrecognised secp256k1 public key: ${raw.length} bytes starting 0x${raw[0]?.toString(16) ?? '??'}`,
  )
}

/**
 * Encrypts to the TEE's public key.
 *
 * @param teePublicKey The machine key from the extension proxy's `/info`
 *        response (`machineData.publicKey`). Read it live -- pinning a key in
 *        source means a re-registered machine can no longer open anything.
 */
export function eciesEncrypt(
  teePublicKey: Hex | Uint8Array,
  plaintext: Uint8Array | string,
): Hex {
  const recipient = normalizeTeePublicKey(teePublicKey)
  const message = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext

  const ephemeralPrivate = secp256k1.utils.randomPrivateKey()
  const ephemeralPublic = secp256k1.getPublicKey(ephemeralPrivate, false)

  const { encryptionKey, macKey } = deriveKeys(sharedSecretX(ephemeralPrivate, recipient))

  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ciphertext = ctr(encryptionKey, iv).encrypt(message)

  // The tag covers the IV as well as the ciphertext. Covering only the
  // ciphertext is the classic mistake here and fails on the node, not locally.
  const tag = hmac(sha256, macKey, concat(iv, ciphertext))

  return toHex(concat(ephemeralPublic, iv, ciphertext, tag))
}

/**
 * Decrypts with a raw secp256k1 private key.
 *
 * Present so the round-trip can be asserted in tests and so a user's recovery
 * blob can be opened locally. The enclave never uses this path -- it delegates
 * to the node, which alone holds the machine key.
 */
export function eciesDecrypt(privateKey: Hex | Uint8Array, ciphertext: Hex | Uint8Array): Uint8Array {
  const key = toBytes(privateKey)
  const data = toBytes(ciphertext)

  if (data.length < PUBKEY_LEN + IV_LEN + TAG_LEN) {
    throw new Error(`ciphertext too short: ${data.length} bytes`)
  }
  if (data[0] !== 0x04) {
    throw new Error('ciphertext does not begin with an uncompressed ephemeral key')
  }

  const ephemeralPublic = data.subarray(0, PUBKEY_LEN)
  const body = data.subarray(PUBKEY_LEN, data.length - TAG_LEN) // iv || ciphertext
  const tag = data.subarray(data.length - TAG_LEN)

  const { encryptionKey, macKey } = deriveKeys(sharedSecretX(key, ephemeralPublic))

  const expected = hmac(sha256, macKey, body)
  if (!constantTimeEqual(expected, tag)) {
    throw new Error('ECIES tag mismatch: wrong key or tampered ciphertext')
  }

  const iv = body.subarray(0, IV_LEN)
  return ctr(encryptionKey, iv).decrypt(body.subarray(IV_LEN))
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
