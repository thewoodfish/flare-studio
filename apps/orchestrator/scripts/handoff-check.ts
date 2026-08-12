/**
 * Does a sealed policy actually reach the enclave, and can it open it?
 *
 * This is the narrowest possible test of the confidentiality mechanism, and it
 * is carved out of `pnpm demo` for one reason: it needs no FXRP. The full demo
 * cannot run until the deployer holds the asset, but the part most likely to be
 * subtly wrong -- ECIES between a TypeScript sender and a Go enclave, custom op
 * routing, and the STORE handler -- does not involve the asset at all.
 *
 *     pnpm handoff-check
 *
 * It deploys a policy with no funds, seals its private half, submits the
 * ciphertext on-chain, and waits for the enclave to answer. A success proves the
 * three things the product's privacy claim rests on: the browser can seal to the
 * machine's real key, opaque bytes route to the right extension, and the enclave
 * can decrypt and reproduce the commitment.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { compile, eciesEncrypt, teePublicKeyFromInfo } from '@flare-studio/policy'
import { sendStorePolicy, pollActionResult, decodeActionData } from '../src/instructions.js'

const coston2 = defineChain({
  id: 114,
  name: 'Flare Testnet Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CHAIN_URL ?? 'https://coston2-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Coston2 Explorer', url: 'https://coston2-explorer.flare.network' },
  },
  testnet: true,
})

const factoryAbi = [
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

const heartbeatAbi = [
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
] as const

function ok(claim: string): void {
  console.log(`   \x1b[32m✓\x1b[0m ${claim}`)
}

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(need('DEPLOYER_PRIVATE_KEY') as Hex)
  const extProxyUrl = need('EXT_PROXY_URL')
  const instructionSender = need('INSTRUCTION_SENDER') as Address

  const pub = createPublicClient({ chain: coston2, transport: http() })
  const wallet = createWalletClient({ account, chain: coston2, transport: http() })

  console.log('\x1b[1mEnclave hand-off check\x1b[0m')
  console.log(`   deployer  ${account.address}`)

  console.log('\n\x1b[1m1. Seal a policy to the machine key\x1b[0m')
  const info = await (await fetch(`${extProxyUrl.replace(/\/$/, '')}/info`)).json()
  const teeKey = teePublicKeyFromInfo(info)
  ok(`machine key read as an uncompressed point (${(teeKey.length - 2) / 2} bytes)`)

  const salt = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as Hex
  const compiled = compile(
    {
      version: 1,
      name: 'Hand-off check',
      asset: 'FXRP',
      trigger: { kind: 'manualHeartbeat', intervalSeconds: 3600, demoMode: true },
      conditions: [],
      actions: [
        {
          kind: 'splitTransfer',
          recipients: [
            { address: '0x1111111111111111111111111111111111111111', shareBps: 6000 },
            { address: '0x2222222222222222222222222222222222222222', shareBps: 4000 },
          ],
        },
      ],
    },
    salt,
  )
  const ciphertext = eciesEncrypt(teeKey, compiled.plaintext)
  ok(`sealed ${compiled.plaintext.length} bytes into ${(ciphertext.length - 2) / 2}`)

  console.log('\n\x1b[1m2. Deploy an empty policy\x1b[0m')
  const hash = await wallet.writeContract({
    address: need('POLICY_FACTORY') as Address,
    abi: factoryAbi,
    functionName: 'deploy',
    args: [
      need('FXRP') as Address,
      compiled.publicArgs.commitment,
      need('TEE_ATTESTOR_GATE') as Address,
      need('HEARTBEAT_TRIGGER') as Address,
      [],
    ],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })

  let policy: Address | null = null
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'PolicyDeployed') policy = decoded.args.policy
    } catch {
      /* not ours */
    }
  }
  if (!policy) throw new Error('no PolicyDeployed in the receipt')
  ok(`policy at ${policy}`)

  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: need('HEARTBEAT_TRIGGER') as Address,
      abi: heartbeatAbi,
      functionName: 'configure',
      args: [policy, account.address, 3600n, true],
    }),
  })
  ok('trigger configured')

  console.log('\n\x1b[1m3. Submit the ciphertext on-chain\x1b[0m')
  const sent = await sendStorePolicy({ public: pub, wallet }, instructionSender, policy, ciphertext)
  ok(`STORE instruction ${sent.instructionId}`)
  console.log(`     ${coston2.blockExplorers.default.url}/tx/${sent.txHash}`)

  console.log('\n\x1b[1m4. Wait for the enclave to answer\x1b[0m')
  console.log('     (a data provider has to relay this; 30-90s is normal)')
  const response = await pollActionResult(extProxyUrl, sent.instructionId, { timeoutMs: 240_000 })

  // Throws with the enclave's own log line if the status is not success, which
  // is usually the only diagnostic available -- the extension deliberately
  // reports failures without echoing any of the material that caused them.
  const data = decodeActionData<Record<string, unknown>>(response)
  ok('the enclave opened the sealed policy and answered')
  console.log(`\n${JSON.stringify(data, null, 2)}\n`)

  console.log('\x1b[32m\x1b[1mThe confidential path works end to end.\x1b[0m\n')
}

main().catch((error: unknown) => {
  console.error(`\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`)
  process.exit(1)
})
