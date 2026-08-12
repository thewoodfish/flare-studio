import {
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { policyInstructionSenderAbi, teeInstructionsSentAbi } from './abi.js'

/**
 * Sending instructions and collecting the enclave's answers.
 *
 * The orchestrator is deliberately outside the trust boundary. It never holds a
 * policy's private half: it relays a ciphertext it cannot read and reads back a
 * result the contract will verify independently. Nothing here needs to be
 * trusted, which is exactly why it can run on ordinary hosting -- and why the
 * Bounty 2 claim rests on the enclave rather than on this process.
 *
 * Keep that boundary crisp. The moment this module can decrypt anything, the
 * security story collapses.
 */

/** Instruction fee in wei, matching the registry's required fee. */
export const INSTRUCTION_FEE = 1_000_000n

export type InstructionReceipt = {
  instructionId: Hex
  txHash: Hex
}

/**
 * Pulls the instruction id out of the receipt.
 *
 * `TeeInstructionsSent` is emitted by the registry, not by our contract, so
 * there is no return value to read -- the id only exists in the logs. We scan
 * every log rather than assuming index 0: our own contract may emit first, and
 * the Go tooling's `receipt.Logs[0]` assumption is a latent trap the moment a
 * send function gains an event.
 */
function extractInstructionId(logs: readonly { data: Hex; topics: readonly Hex[] }[]): Hex {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: teeInstructionsSentAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      })
      if (decoded.eventName === 'TeeInstructionsSent') {
        return decoded.args.instructionId
      }
    } catch {
      // Not our event; keep looking.
    }
  }

  throw new Error(
    'no TeeInstructionsSent event in the receipt -- the extension id is probably unset, ' +
      'or the op type/command pair was rejected before dispatch',
  )
}

async function send(
  clients: { public: PublicClient; wallet: WalletClient },
  instructionSender: Address,
  functionName: 'sendStorePolicy' | 'sendEvaluatePolicy',
  args: readonly unknown[],
): Promise<InstructionReceipt> {
  const account = clients.wallet.account
  if (!account) throw new Error('wallet client has no account')

  const { request } = await clients.public.simulateContract({
    address: instructionSender,
    abi: policyInstructionSenderAbi,
    functionName,
    args: args as never,
    value: INSTRUCTION_FEE,
    account,
  })

  const txHash = await clients.wallet.writeContract(request)
  const receipt = await clients.public.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status !== 'success') {
    throw new Error(`${functionName} reverted (tx ${txHash})`)
  }

  return { instructionId: extractInstructionId(receipt.logs), txHash }
}

/** Hands the enclave a policy's encrypted private half. */
export function sendStorePolicy(
  clients: { public: PublicClient; wallet: WalletClient },
  instructionSender: Address,
  policy: Address,
  ciphertext: Hex,
): Promise<InstructionReceipt> {
  return send(clients, instructionSender, 'sendStorePolicy', [policy, ciphertext])
}

/** Asks the enclave to sign the committed distribution for an armed policy. */
export function sendEvaluatePolicy(
  clients: { public: PublicClient; wallet: WalletClient },
  instructionSender: Address,
  policy: Address,
  triggeredAt: bigint,
): Promise<InstructionReceipt> {
  return send(clients, instructionSender, 'sendEvaluatePolicy', [policy, triggeredAt])
}

/** The envelope the extension proxy returns from /action/result/{id}. */
export type ActionResponse = {
  result: {
    status: number
    log: string
    data: string | null
    version: string
  }
}

export type PollOptions = {
  /** How long to wait before giving up. Round trips are typically 30-90s. */
  timeoutMs?: number
  intervalMs?: number
}

/**
 * Polls the extension proxy until the enclave has answered.
 *
 * A 404 is the normal "not yet" response, not an error: the result only exists
 * once a data provider has relayed the instruction and the TEE has replied. It
 * is also what you see forever when the instruction never routed at all, so the
 * timeout message names that case explicitly -- it is the single most common
 * failure and the least obvious from the symptom.
 */
export async function pollActionResult(
  extProxyUrl: string,
  instructionId: Hex,
  { timeoutMs = 180_000, intervalMs = 2_000 }: PollOptions = {},
): Promise<ActionResponse> {
  const deadline = Date.now() + timeoutMs
  const url = `${extProxyUrl.replace(/\/$/, '')}/action/result/${instructionId}`

  let lastStatus = 0
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null)

    if (response?.ok) {
      return (await response.json()) as ActionResponse
    }
    lastStatus = response?.status ?? 0

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `no result for instruction ${instructionId} after ${timeoutMs}ms (last HTTP ${lastStatus}). ` +
      'A persistent 404 means the instruction never reached the TEE: check that the URL ' +
      'registered on-chain matches the one being served, and that tee-node and tee-proxy ' +
      'versions have not drifted apart.',
  )
}

/**
 * Decodes the enclave's payload.
 *
 * The result arrives as 0x-prefixed hex, not base64. That was worth learning the
 * hard way: base64 decoding hex bytes yields plausible-looking binary, so the
 * failure surfaces as `JSON.parse` choking on a replacement character rather
 * than as anything that names the real problem. Base64 is still accepted, since
 * an older proxy may send it and tolerating both costs one branch.
 *
 * A non-1 status is surfaced with the enclave's own log line, because that text
 * is usually the only diagnostic available -- the extension deliberately reports
 * failures without echoing any of the material that caused them. "policy has no
 * shares" arriving that way is what identified a schema mismatch that no local
 * test could see.
 */
export function decodeActionData<T>(response: ActionResponse): T {
  const { result } = response

  if (result.status !== 1) {
    throw new Error(`enclave returned status ${result.status}: ${result.log}`)
  }
  if (!result.data || result.data === '0x') {
    throw new Error('enclave returned a successful result with no data')
  }

  const json = /^0x[0-9a-fA-F]*$/.test(result.data)
    ? Buffer.from(result.data.slice(2), 'hex').toString('utf8')
    : Buffer.from(result.data, 'base64').toString('utf8')

  try {
    return JSON.parse(json) as T
  } catch {
    throw new Error(
      `enclave payload was not JSON after decoding (${json.slice(0, 60)}…) -- ` +
        'check whether the proxy changed its encoding',
    )
  }
}
