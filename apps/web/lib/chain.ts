import { defineChain, type Address, type Hex } from 'viem'

/**
 * Coston2, and where the app finds its contracts.
 *
 * Our own contracts have NO fallback address, deliberately. An earlier version
 * of this file carried the addresses from
 * `packages/contracts/deployments/coston2.json` as defaults -- and that file had
 * been written by a `forge script` run without `--broadcast`, so it recorded
 * addresses that were never deployed. `cast code` on all three returned `0x`.
 *
 * Baking those in made the app look configured while pointing at empty
 * addresses, which fails as an unexplained revert at deploy time rather than as
 * a clear message up front. So an unset address is now zero, `contractsConfigured`
 * reports it, and the UI refuses to start a deploy it knows cannot work.
 *
 * FXRP keeps its default because it is Flare's, not ours, and is verified live
 * on Coston2 -- it is the one address here that is not ours to deploy.
 *
 * These are public testnet contract addresses. Nothing here is a secret.
 */

const UNSET = '0x0000000000000000000000000000000000000000' as const

export const coston2 = defineChain({
  id: 114,
  name: 'Flare Testnet Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://coston2-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Coston2 Explorer', url: 'https://coston2-explorer.flare.network' },
  },
  testnet: true,
})

function envAddress(value: string | undefined, fallback: Address): Address {
  return (value as Address | undefined) ?? fallback
}

export const ADDRESSES = {
  policyFactory: envAddress(process.env.NEXT_PUBLIC_POLICY_FACTORY, UNSET),
  teeAttestorGate: envAddress(process.env.NEXT_PUBLIC_TEE_ATTESTOR_GATE, UNSET),
  manualHeartbeatTrigger: envAddress(process.env.NEXT_PUBLIC_MANUAL_HEARTBEAT_TRIGGER, UNSET),
  timestampTrigger: envAddress(process.env.NEXT_PUBLIC_TIMESTAMP_TRIGGER, UNSET),
  fxrp: envAddress(
    process.env.NEXT_PUBLIC_FXRP,
    '0x0b6A3645c240605887a5532109323A3E12273dc7',
  ),
  /**
   * PolicyInstructionSender, deployed by the extension scaffold's `pre-build`
   * step, which records it as INSTRUCTION_SENDER in config/extension.env.
   *
   * No default is possible: unlike the contracts above, this address comes from
   * a deployment that is per-machine and not checked in. Zero means "the enclave
   * hand-off is not configured here", which the UI reports as a skipped step
   * rather than a failure -- a policy without it is still correct, just not yet
   * openable by the enclave.
   */
  policyInstructionSender: envAddress(
    process.env.NEXT_PUBLIC_POLICY_INSTRUCTION_SENDER,
    UNSET,
  ),
} as const

export function isSet(address: Address): boolean {
  return !/^0x0+$/.test(address)
}

/** True when the enclave hand-off can actually be attempted. */
export function enclaveHandoffConfigured(): boolean {
  return isSet(ADDRESSES.policyInstructionSender)
}

/**
 * True when the policy engine is deployed and pointed at.
 *
 * Checked before the deploy dialog will do anything, so a build with no
 * deployment says so in a sentence instead of sending a transaction to an
 * address with no code and surfacing whatever the RPC makes of that.
 */
export function contractsConfigured(): boolean {
  return (
    isSet(ADDRESSES.policyFactory) &&
    isSet(ADDRESSES.teeAttestorGate) &&
    isSet(ADDRESSES.manualHeartbeatTrigger)
  )
}

/**
 * Where to start scanning for PolicyDeployed logs.
 *
 * Coston2's RPC caps `eth_getLogs` ranges, and scanning from genesis is both
 * slow and liable to be rejected outright. The deploy script records the block
 * the factory landed in; nothing older can possibly contain one of its events.
 */
export const FACTORY_DEPLOY_BLOCK = BigInt(
  process.env.NEXT_PUBLIC_FACTORY_DEPLOY_BLOCK ?? '0',
)

export function explorerTx(hash: Hex): string {
  return `${coston2.blockExplorers.default.url}/tx/${hash}`
}

export function explorerAddress(address: string): string {
  return `${coston2.blockExplorers.default.url}/address/${address}`
}
