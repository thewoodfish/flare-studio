import type { Hex } from 'viem'

/**
 * Reading the enclave's public key out of the extension proxy's `/info`.
 *
 * This exists because the obvious guess is wrong, and wrong in a way that fails
 * silently. `machineData.publicKey` is not a hex string -- it is an object of two
 * 32-byte coordinates:
 *
 *     "publicKey": { "x": "0x5507…2163", "y": "0xef09…7763" }
 *
 * Passing that object straight to `eciesEncrypt` throws inside the encoder. In
 * the browser deploy flow that throw was caught and reported as "sealing
 * skipped", which is the worst possible failure: the policy still deploys, still
 * funds, still arms, and the confidential half is simply never encrypted to
 * anyone. Nothing about the UI would have told you.
 *
 * So the shape is parsed explicitly, it fails loudly, and the real response from
 * a live Coston2 machine is pinned in fixtures/tee-info.sample.json rather than
 * described in a comment.
 */

/** secp256k1 uncompressed point prefix. */
const UNCOMPRESSED = '04'

export type TeePublicKeyPoint = { x: string; y: string }

/**
 * @returns The key as `0x04 || X || Y`, the uncompressed form geth's ECIES wants.
 * @throws  If the shape is not what a live proxy returns -- deliberately, rather
 *          than returning null, because every caller's only sane response to a
 *          missing key is to stop.
 */
export function teePublicKeyFromInfo(info: unknown): Hex {
  const point = findPublicKey(info)

  if (!point) {
    throw new Error(
      'extension proxy /info has no machineData.publicKey -- the machine is probably ' +
        'not registered yet, or the proxy is serving a different extension',
    )
  }

  const x = stripHex(point.x)
  const y = stripHex(point.y)

  if (x.length !== 64 || y.length !== 64) {
    throw new Error(
      `unexpected public key coordinates: x is ${x.length / 2} bytes, y is ${y.length / 2} ` +
        'bytes; both must be 32',
    )
  }

  return `0x${UNCOMPRESSED}${x}${y}`
}

/**
 * `machineData` first, `teeInfo` as the fallback.
 *
 * A live proxy currently reports the same key in both. Preferring machineData is
 * deliberate: that is the registered machine's identity, which is what the chain
 * attests, whereas teeInfo describes the node answering right now.
 */
function findPublicKey(info: unknown): TeePublicKeyPoint | null {
  if (typeof info !== 'object' || info === null) return null

  const root = info as Record<string, unknown>
  for (const key of ['machineData', 'teeInfo']) {
    const section = root[key]
    if (typeof section !== 'object' || section === null) continue

    const candidate = (section as Record<string, unknown>).publicKey
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as TeePublicKeyPoint).x === 'string' &&
      typeof (candidate as TeePublicKeyPoint).y === 'string'
    ) {
      return candidate as TeePublicKeyPoint
    }
  }

  return null
}

function stripHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
}
