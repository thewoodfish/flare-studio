/**
 * The minimum ABI surface the orchestrator needs.
 *
 * Hand-written rather than generated, because the orchestrator touches exactly
 * three functions and one event. A generated binding would drag the whole
 * contract along and hide how small this trust surface actually is.
 */

export const policyInstructionSenderAbi = [
  {
    type: 'function',
    name: 'setExtensionId',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sendStorePolicy',
    inputs: [
      { name: '_policy', type: 'address' },
      { name: '_ciphertext', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sendEvaluatePolicy',
    inputs: [
      { name: '_policy', type: 'address' },
      { name: '_triggeredAt', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

/**
 * Emitted by the TEE extension registry, not by our contract -- which is why the
 * instruction id has to be read from the receipt logs rather than a return value.
 */
export const teeInstructionsSentAbi = [
  {
    type: 'event',
    name: 'TeeInstructionsSent',
    inputs: [
      { name: 'instructionId', type: 'bytes32', indexed: true },
      { name: 'extensionId', type: 'uint256', indexed: true },
      { name: 'opType', type: 'bytes32', indexed: false },
      { name: 'opCommand', type: 'bytes32', indexed: false },
    ],
  },
] as const

/** The subset of ConfidentialPolicy the orchestrator reads or calls. */
export const confidentialPolicyAbi = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'shares',
        type: 'tuple[]',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'shareBps', type: 'uint16' },
        ],
      },
      { name: 'salt', type: 'bytes32' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'arm',
    inputs: [{ name: 'proof', type: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'status',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'triggeredAt',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'commitment',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balance',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** ConfidentialPolicy.Status, mirrored for readable logs. */
export const PolicyStatus = {
  Active: 0,
  Triggered: 1,
  Executed: 2,
  Cancelled: 3,
} as const
