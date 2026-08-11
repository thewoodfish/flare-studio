/**
 * FDC endpoints and constants for Coston2.
 *
 * Day 7 work -- the `ReferencedPaymentNonexistence` pipeline that turns a missed
 * proof-of-life payment into an on-chain trigger. Recorded here now because the
 * values were verified live and are easy to get wrong later:
 *
 *   - the verifier returns 401 with no key and 400 with one (400 being a
 *     complaint about the body, which is how you know the key was accepted)
 *   - the public key below is the documented one and is shared across every
 *     testnet verifier: EVM, BTC, XRP, DOGE, Web2Json
 *
 * Verified 9 Aug 2026 against dev.flare.network/network/overview#api-resources.
 */

/** Public, rate-limited verifier key. Fine for the hackathon; not for production. */
export const VERIFIER_API_KEY = '00000000-0000-0000-0000-000000000000'

export const VERIFIER_BASE_URL = 'https://fdc-verifiers-testnet.flare.network'

/**
 * The attestation type that makes the dead-man's switch real rather than
 * simulated: it proves an expected payment did *not* arrive by a deadline.
 */
export const NONEXISTENCE_PREPARE_REQUEST_URL =
  `${VERIFIER_BASE_URL}/verifier/xrp/ReferencedPaymentNonexistence/prepareRequest`

/**
 * Data Availability layer, where the Merkle proof is collected once the round
 * finalises. NB: the exact proof path still needs confirming against
 * `/api-doc` -- `/api/v0/fdc/status` returned 404, so do not assume the path
 * quoted in older guides is current.
 */
export const DA_LAYER_BASE_URL = 'https://ctn2-data-availability.flare.network'

/**
 * Coston2 system contracts, from config/coston2/deployed-addresses.json.
 * Resolved from that file rather than copied from chat -- Coston2 FCC has been
 * redeployed once already, and stale addresses are the single most common
 * failure on this stack.
 */
export const COSTON2_ADDRESSES = {
  fdcHub: '0x48aC463d7975828989331F4De43341627b9c5f1D',
  fdcVerification: '0x906507E0B64bcD494Db73bd0459d1C667e14B933',
  relay: '0xa10B672D1c62e5457b17af63d4302add6A99d7dE',
  flareTeeManager: '0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE',
} as const

/** Relay protocol id for FDC; used when watching for round finalisation. */
export const FDC_PROTOCOL_ID = 200
