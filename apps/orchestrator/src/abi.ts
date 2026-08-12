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
 *
 * Transcribed from the generated bindings in go-flare-common
 * (pkg/contracts/tee/instructions), and confirmed against a live Coston2 receipt:
 * topic0 0xf770e69a…, topic1 the extension id, topic2 the instruction id, topic3
 * the reward epoch.
 *
 * The earlier hand-written version had two indexed fields in the wrong order and
 * omitted seven more. Nothing complained: a mismatched ABI makes decodeEventLog
 * throw per log, the scan swallows it as "not our event", and the result is
 * "no TeeInstructionsSent in the receipt" for a transaction that plainly emitted
 * one. Do not trim this back down -- the unused fields are what make the
 * signature, and therefore topic0, correct.
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
