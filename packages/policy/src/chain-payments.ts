import { encodePacked, keccak256, type Address, type Hex } from 'viem'

/**
 * The reference a proof-of-life payment must carry.
 *
 * Named for the general case rather than XRPL, because it is not XRPL-specific:
 * FDC's ReferencedPaymentNonexistence supports XRP, BTC and DOGE, and the
 * trigger takes the source chain as configuration. The same derivation serves
 * all of them.
 *
 * This exists in two languages and must agree exactly. The browser tells the
 * owner what to put in the payment; `FdcNonexistenceTrigger.policyReference`
 * decides whether what they sent counted. A divergence would not fail loudly --
 * it would mean an owner who has been faithfully paying every month is judged
 * to have paid nothing, and their policy fires while they are alive.
 *
 * So it gets the same treatment as the commitment: a shared vector, asserted
 * from both sides. See fixtures/policy-reference-vectors.json.
 */

/**
 * Domain tag, so a reference cannot be confused with another product's.
 *
 * Versioned because changing the derivation later would silently orphan every
 * policy already deployed -- their on-chain config holds the old reference and
 * the owner's wallet would start sending the new one.
 */
export const POLICY_REFERENCE_TAG = 'flare-studio.policy-reference.v1'

/**
 * @param policy The deployed ConfidentialPolicy clone's address. Using the
 *        policy rather than the owner is what makes a reference useless against
 *        any other policy, including another of the same owner's.
 */
export function policyReference(policy: Address): Hex {
  return keccak256(encodePacked(['string', 'address'], [POLICY_REFERENCE_TAG, policy]))
}

/**
 * XRPL carries this in a Memo, as uppercase hex without the 0x.
 *
 * Separated from the derivation because the encoding is per-chain while the
 * reference is not: BTC would use OP_RETURN and the same 32 bytes.
 */
export function xrplMemoData(reference: Hex): string {
  return reference.slice(2).toUpperCase()
}
