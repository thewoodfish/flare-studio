/**
 * The slice of each contract's ABI the browser actually calls.
 *
 * Hand-written rather than generated from artifacts, and deliberately partial:
 * `forge build` output is gitignored, so importing it would make the web app
 * unbuildable without a Foundry toolchain. The cost is that these must stay in
 * step with the contracts -- which is why each entry is one the deploy or
 * monitor flow exercises on every run, so drift shows up immediately rather
 * than sitting dormant in an unused entry.
 *
 * `apps/orchestrator/src/abi.ts` holds the runtime's half (arm, execute, the
 * instruction sender). There is deliberately no shared ABI package: the two
 * consumers overlap on three view functions and nothing else, and a package
 * whose entire content is three view functions costs more than it saves.
 */

export const policyFactoryAbi = [
  {
    type: 'function',
    name: 'deploy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'commitment', type: 'bytes32' },
      { name: 'attestorGate', type: 'address' },
      { name: 'trigger', type: 'address' },
      { name: 'conditions', type: 'address[]' },
    ],
    outputs: [{ name: 'policy', type: 'address' }],
  },
  {
    type: 'event',
    name: 'PolicyDeployed',
    inputs: [
      { name: 'policy', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'commitment', type: 'bytes32', indexed: false },
      { name: 'trigger', type: 'address', indexed: false },
    ],
  },
] as const

export const confidentialPolicyAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'status',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'commitment',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'trigger',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'triggeredAt',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const manualHeartbeatTriggerAbi = [
  {
    type: 'function',
    name: 'configure',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'policy', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'interval', type: 'uint64' },
      { name: 'demoMode', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'heartbeat',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'policy', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'simulateInactivity',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'policy', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deadlineOf',
    stateMutability: 'view',
    inputs: [{ name: 'policy', type: 'address' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'configs',
    stateMutability: 'view',
    inputs: [{ name: 'policy', type: 'address' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'interval', type: 'uint64' },
      { name: 'deadline', type: 'uint64' },
      { name: 'demoMode', type: 'bool' },
    ],
  },
] as const

export const timestampTriggerAbi = [
  {
    type: 'function',
    name: 'configure',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'policy', type: 'address' },
      { name: 'executeAfter', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeAfter',
    stateMutability: 'view',
    inputs: [{ name: 'policy', type: 'address' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
] as const

export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * The browser's half of the enclave hand-off.
 *
 * `sendStorePolicy` puts the ECIES ciphertext on-chain, where data providers
 * relay it to the enclave as opaque bytes. Submitting it from the browser rather
 * than through a server of ours is the whole point: the sealed payload never
 * passes through anything we run.
 */
export const policyInstructionSenderAbi = [
  {
    type: 'function',
    name: 'sendStorePolicy',
    stateMutability: 'payable',
    inputs: [
      { name: '_policy', type: 'address' },
      { name: '_ciphertext', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

/**
 * Emitted by the TEE extension registry, not by our contract -- so the
 * instruction id exists only in the logs, never as a return value.
 *
 * Transcribed from go-flare-common's generated bindings and confirmed against a
 * live Coston2 receipt. Every field matters: they determine the signature, and
 * therefore topic0. A wrong ABI here does not error -- decodeEventLog throws,
 * the scan treats it as somebody else's event, and a successful transaction
 * looks like it emitted nothing.
 */
export const teeInstructionsSentAbi = [
  {
    type: 'event',
    name: 'TeeInstructionsSent',
    inputs: [
      { name: 'extensionId', type: 'uint256', indexed: true },
      { name: 'instructionId', type: 'bytes32', indexed: true },
      { name: 'rewardEpochId', type: 'uint32', indexed: true },
      {
        name: 'teeMachines',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'teeId', type: 'address' },
          { name: 'teeProxyId', type: 'address' },
          { name: 'url', type: 'string' },
        ],
      },
      { name: 'opType', type: 'bytes32', indexed: false },
      { name: 'opCommand', type: 'bytes32', indexed: false },
      { name: 'message', type: 'bytes', indexed: false },
      { name: 'cosigners', type: 'address[]', indexed: false },
      { name: 'cosignersThreshold', type: 'uint64', indexed: false },
      { name: 'claimBackAddress', type: 'address', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * Instruction fee in wei, matching the registry's required fee.
 *
 * Kept in step with `INSTRUCTION_FEE` in apps/orchestrator/src/instructions.ts.
 * Duplicated rather than shared because the web app does not otherwise depend on
 * the orchestrator, and one number is a smaller price than that dependency.
 */
export const INSTRUCTION_FEE = 1_000_000n

/** Mirrors ConfidentialPolicy.Status. */
export const PolicyStatus = {
  0: 'Active',
  1: 'Triggered',
  2: 'Executed',
  3: 'Cancelled',
} as const

export type PolicyStatusName = (typeof PolicyStatus)[keyof typeof PolicyStatus]
