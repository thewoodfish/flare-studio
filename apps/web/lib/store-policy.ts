'use client'

import { decodeEventLog, type Address, type Hex } from 'viem'
import { ADDRESSES, coston2, enclaveHandoffConfigured } from './chain'
import { INSTRUCTION_FEE, policyInstructionSenderAbi, teeInstructionsSentAbi } from './abi'
import { publicClient, walletClient } from './wallet'

/**
 * Handing the enclave a policy's private half.
 *
 * This is the step that completes the confidentiality story. Up to here the
 * sealed payload has existed only in the user's browser: the chain holds a
 * commitment, and nothing can open it. `sendStorePolicy` puts the ciphertext
 * on-chain, where data providers relay it to the enclave as bytes none of them
 * can read.
 *
 * The submission comes from the browser rather than from a server of ours, and
 * that is a deliberate architectural choice rather than a convenience. If the
 * orchestrator relayed it, the orchestrator would -- however briefly -- be
 * handling material it must never be able to read, and every claim about the
 * trust boundary would need an asterisk. There is no asterisk: the plaintext
 * exists in the user's browser and inside the enclave, and nowhere between.
 */

export class EnclaveHandoffError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnclaveHandoffError'
  }
}

export type HandoffResult = {
  instructionId: Hex
  txHash: Hex
}

export async function storePolicyOnChain({
  policy,
  ciphertext,
  account,
}: {
  policy: Address
  ciphertext: Hex
  account: Address
}): Promise<HandoffResult> {
  if (!enclaveHandoffConfigured()) {
    throw new EnclaveHandoffError(
      'No instruction sender is configured, so the enclave cannot be reached from this build.',
    )
  }

  const pub = publicClient()
  const wallet = walletClient(account)

  // Simulate first. The common failures here -- the extension id was never set,
  // or the fee is wrong -- revert with a require string that simulation surfaces
  // and a bare send would reduce to "execution reverted".
  const { request } = await pub.simulateContract({
    address: ADDRESSES.policyInstructionSender,
    abi: policyInstructionSenderAbi,
    functionName: 'sendStorePolicy',
    args: [policy, ciphertext],
    value: INSTRUCTION_FEE,
    account,
    chain: coston2,
  })

  const txHash = await wallet.writeContract(request)
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status !== 'success') {
    throw new EnclaveHandoffError(`the hand-off transaction reverted (${txHash})`)
  }

  return { instructionId: extractInstructionId(receipt.logs), txHash }
}

/**
 * Pulls the instruction id out of the receipt.
 *
 * Every log is scanned rather than assuming index 0. The registry's event is not
 * necessarily first, and an index assumption is the kind of thing that works
 * until the day some contract in the path gains an event.
 */
function extractInstructionId(
  logs: readonly { data: Hex; topics: readonly Hex[] }[],
): Hex {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: teeInstructionsSentAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName === 'TeeInstructionsSent') return decoded.args.instructionId
    } catch {
      // Not our event; keep looking.
    }
  }

  throw new EnclaveHandoffError(
    'the transaction succeeded but emitted no TeeInstructionsSent event -- the extension id ' +
      'is probably unset, or the op type and command pair was rejected before dispatch',
  )
}
