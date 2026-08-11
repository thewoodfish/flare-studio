import { defineChain, type Address, type Hex } from 'viem'

/**
 * Coston2, and where the app finds its contracts.
 *
 * The addresses below are written by `forge script script/Deploy.s.sol` into
 * `packages/contracts/deployments/coston2.json`. They are duplicated here as
 * defaults rather than imported because that file is generated and gitignored --
 * a fresh clone would fail to build. Every one is overridable by environment so
 * a redeploy is a `.env.local` edit, not a code change.
 *
 * These are public testnet contract addresses. Nothing here is a secret.
 */

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
  policyFactory: envAddress(
    process.env.NEXT_PUBLIC_POLICY_FACTORY,
    '0xDC4DF7ea48D6c4B7839ff55C8D0E91F2B885326d',
  ),
  teeAttestorGate: envAddress(
    process.env.NEXT_PUBLIC_TEE_ATTESTOR_GATE,
    '0x67C5D7DA5c66954579C19A55B59273D7a97594A6',
  ),
  manualHeartbeatTrigger: envAddress(
    process.env.NEXT_PUBLIC_MANUAL_HEARTBEAT_TRIGGER,
    '0x395F139c4C8B9e1807D3Da259020BabA5E331D45',
  ),
  /**
   * Deployed alongside the others by the same script. Left as the zero address
   * when a deployment predates it, which `triggerDeployment` reports as a plain
   * "not deployed on this network yet" rather than a failed transaction.
   */
  timestampTrigger: envAddress(
    process.env.NEXT_PUBLIC_TIMESTAMP_TRIGGER,
    '0x0000000000000000000000000000000000000000',
  ),
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
    '0x0000000000000000000000000000000000000000',
  ),
} as const

/** True when the enclave hand-off can actually be attempted. */
export function enclaveHandoffConfigured(): boolean {
  return !/^0x0+$/.test(ADDRESSES.policyInstructionSender)
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
