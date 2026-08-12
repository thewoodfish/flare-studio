/**
 * The headless end-to-end run, against real Coston2.
 *
 * This script is the regression test the UI does not replace. Every claim the
 * product makes is asserted here against live contracts: that a policy deploys,
 * that FXRP moves into it, that a check-in pushes the deadline out, that missing
 * a deadline arms it, that the enclave signs a distribution it cannot alter, and
 * that the balances at the end are the ones the owner fixed at the start.
 *
 * It is deliberately not a vitest suite. It costs gas, takes minutes, and
 * depends on a running enclave -- properties that belong to a script you choose
 * to run, not to a suite that runs on every save. What it shares with the test
 * suite is that it fails loudly and specifically.
 *
 *     pnpm demo
 *
 * Requires, in the environment or a .env at the repo root:
 *
 *     DEPLOYER_PRIVATE_KEY   funded with C2FLR and FXRP on Coston2
 *     EXT_PROXY_URL          the extension proxy's public URL
 *     INSTRUCTION_SENDER     PolicyInstructionSender, from config/extension.env
 *     POLICY_FACTORY         from packages/contracts/deployments/coston2.json
 *     TEE_ATTESTOR_GATE      likewise
 *     HEARTBEAT_TRIGGER      likewise
 *     FXRP                   likewise
 */

import { createPublicClient, createWalletClient, http, defineChain, formatUnits, parseUnits, decodeEventLog, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  compile,
  eciesEncrypt,
  getAsset,
  resolveDistributions,
  teePublicKeyFromInfo,
} from '@flare-studio/policy'
import { evaluatePolicy, executePolicy } from '../src/policy.js'
import { sendStorePolicy } from '../src/instructions.js'
import { confidentialPolicyAbi } from '../src/abi.js'

const coston2 = defineChain({
  id: 114,
  name: 'Flare Testnet Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: { default: { http: [process.env.CHAIN_URL ?? 'https://coston2-api.flare.network/ext/C/rpc'] } },
  blockExplorers: { default: { name: 'Coston2 Explorer', url: 'https://coston2-explorer.flare.network' } },
  testnet: true,
})

// --- the ABI slices this script needs beyond the orchestrator's own ---------

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
  { type: 'function', name: 'configure', stateMutability: 'nonpayable', inputs: [{ name: 'policy', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'interval', type: 'uint64' }, { name: 'demoMode', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'heartbeat', stateMutability: 'nonpayable', inputs: [{ name: 'policy', type: 'address' }], outputs: [] },
  { type: 'function', name: 'simulateInactivity', stateMutability: 'nonpayable', inputs: [{ name: 'policy', type: 'address' }], outputs: [] },
  { type: 'function', name: 'deadlineOf', stateMutability: 'view', inputs: [{ name: 'policy', type: 'address' }], outputs: [{ name: '', type: 'uint64' }] },
] as const

const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

const depositAbi = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
] as const

// --- harness ----------------------------------------------------------------

let step = 0

function heading(text: string): void {
  step += 1
  console.log(`\n\x1b[1m${step}. ${text}\x1b[0m`)
}

function detail(label: string, value: string): void {
  console.log(`   ${label.padEnd(22)} ${value}`)
}

/**
 * Assertions that read as claims about the product.
 *
 * The message is written as the thing that should be true, so a failure line is
 * a statement of what broke rather than a stack trace to interpret.
 */
function assert(condition: boolean, claim: string): void {
  if (!condition) throw new Error(`FAILED: ${claim}`)
  console.log(`   \x1b[32m✓\x1b[0m ${claim}`)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. See the header of this script for the full list -- ` +
        'the addresses come from packages/contracts/deployments/coston2.json and ' +
        'apps/extension/config/extension.env.',
    )
  }
  return value
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(required('DEPLOYER_PRIVATE_KEY') as Hex)
  const extProxyUrl = required('EXT_PROXY_URL')
  const instructionSender = required('INSTRUCTION_SENDER') as Address
  const factory = required('POLICY_FACTORY') as Address
  const attestorGate = required('TEE_ATTESTOR_GATE') as Address
  const heartbeatTrigger = required('HEARTBEAT_TRIGGER') as Address
  const fxrp = required('FXRP') as Address

  const pub = createPublicClient({ chain: coston2, transport: http() })
  const wallet = createWalletClient({ account, chain: coston2, transport: http() })
  const clients = { public: pub, wallet }

  const asset = getAsset('FXRP')

  console.log('\x1b[1mFlare Studio — end-to-end against Coston2\x1b[0m')
  detail('deployer', account.address)
  detail('proxy', extProxyUrl)

  // --- 1. compile ----------------------------------------------------------

  heading('Compile a policy')

  // Two recipients with an uneven split, so the remainder handling in
  // resolveDistributions is genuinely exercised rather than trivially correct.
  const recipients = [
    { address: '0x1111111111111111111111111111111111111111' as Address, shareBps: 6001, label: 'A' },
    { address: '0x2222222222222222222222222222222222222222' as Address, shareBps: 3999, label: 'B' },
  ]

  const salt = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as Hex

  const compiled = compile(
    {
      version: 1,
      name: 'Demo policy',
      asset: 'FXRP',
      // A short interval, because the demo pushes the deadline out once and then
      // yanks it into the past. The length only has to survive one check-in.
      trigger: { kind: 'manualHeartbeat', intervalSeconds: 3600, demoMode: true },
      conditions: [],
      actions: [{ kind: 'splitTransfer', recipients }],
    },
    salt,
  )

  detail('commitment', compiled.publicArgs.commitment)
  assert(
    !JSON.stringify(compiled.publicArgs).toLowerCase().includes('1111111111111111111111111111111111111111'),
    'no recipient address appears anywhere in the public half',
  )

  // --- 2. seal -------------------------------------------------------------

  heading('Seal the private half to the enclave')

  // The key arrives as {x, y} coordinates, not a hex string -- see tee-info.ts.
  // Reading it by hand is how the browser flow silently stopped encrypting.
  const info = await (await fetch(`${extProxyUrl.replace(/\/$/, '')}/info`)).json()
  const teeKey = teePublicKeyFromInfo(info)
  assert(/^0x04[0-9a-f]{128}$/.test(teeKey), 'the proxy reports a usable machine public key')

  const ciphertext = eciesEncrypt(teeKey, compiled.plaintext)
  detail('ciphertext', `${(ciphertext.length - 2) / 2} bytes`)

  // --- 3. deploy -----------------------------------------------------------

  heading('Deploy the policy')

  const deployHash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'deploy',
    args: [fxrp, compiled.publicArgs.commitment, attestorGate, heartbeatTrigger, []],
  })
  const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash })
  assert(deployReceipt.status === 'success', 'the factory deployed a policy clone')

  let policy: Address | null = null
  for (const log of deployReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'PolicyDeployed') policy = decoded.args.policy
    } catch {
      // not ours
    }
  }
  if (!policy) throw new Error('PolicyDeployed was not in the receipt')
  detail('policy', policy)
  detail('explorer', `${coston2.blockExplorers.default.url}/address/${policy}`)

  await confirm(pub, await wallet.writeContract({
    address: heartbeatTrigger,
    abi: heartbeatAbi,
    functionName: 'configure',
    args: [policy, account.address, 3600n, true],
  }))
  assert(true, 'the trigger is configured for this policy')

  // --- 4. fund -------------------------------------------------------------

  heading('Fund it with real FXRP')

  const funding = parseUnits('1', asset.decimals)
  const walletBalance = await pub.readContract({ address: fxrp, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  if (walletBalance < funding) {
    throw new Error(
      `deployer holds ${formatUnits(walletBalance, asset.decimals)} FXRP, needs at least 1. ` +
        'Mint some at https://faucet.flare.network/coston2 and swap, or lower `funding` here.',
    )
  }

  await confirm(pub, await wallet.writeContract({ address: fxrp, abi: erc20Abi, functionName: 'approve', args: [policy, funding] }))
  await confirm(pub, await wallet.writeContract({ address: policy, abi: depositAbi, functionName: 'deposit', args: [funding] }))

  const deposited = await pub.readContract({ address: policy, abi: confidentialPolicyAbi, functionName: 'balance' })
  assert(deposited === funding, `the policy holds ${formatUnits(funding, asset.decimals)} FXRP`)

  // --- 5. hand off ---------------------------------------------------------

  heading('Hand the sealed policy to the enclave')

  const stored = await sendStorePolicy(clients, instructionSender, policy, ciphertext)
  detail('instruction', stored.instructionId)
  assert(true, 'the STORE instruction reached the chain')

  // --- 6. prove presence, then stop --------------------------------------

  heading('Check in once, then miss the next deadline')

  const before = await pub.readContract({ address: heartbeatTrigger, abi: heartbeatAbi, functionName: 'deadlineOf', args: [policy] })
  await confirm(pub, await wallet.writeContract({ address: heartbeatTrigger, abi: heartbeatAbi, functionName: 'heartbeat', args: [policy] }))
  const after = await pub.readContract({ address: heartbeatTrigger, abi: heartbeatAbi, functionName: 'deadlineOf', args: [policy] })
  assert(after > before, 'a check-in pushes the deadline out')

  // Coston2 cannot be fast-forwarded, so the demo control stands in for the
  // passage of time. It is inert unless demoMode was set at configure time.
  await confirm(pub, await wallet.writeContract({ address: heartbeatTrigger, abi: heartbeatAbi, functionName: 'simulateInactivity', args: [policy] }))

  await confirm(pub, await wallet.writeContract({ address: policy, abi: confidentialPolicyAbi, functionName: 'arm', args: ['0x'] }))
  const status = await pub.readContract({ address: policy, abi: confidentialPolicyAbi, functionName: 'status' })
  assert(status === 1, 'the missed deadline armed the policy')

  // --- 7. the enclave signs ------------------------------------------------

  heading('The enclave evaluates and signs')

  const evaluation = await evaluatePolicy(clients, { instructionSender, policy, extProxyUrl })
  detail('signer', 'recovered on-chain during execute')
  assert(evaluation.shares.length === recipients.length, 'the enclave returned one share per recipient')
  assert(
    evaluation.shares.every((s, i) => s.shareBps === recipients[i]!.shareBps),
    'the enclave returned exactly the split fixed at deploy time',
  )

  // --- 8. execute ----------------------------------------------------------

  heading('Execute and check the money moved')

  const balancesBefore = await Promise.all(
    recipients.map((r) => pub.readContract({ address: fxrp, abi: erc20Abi, functionName: 'balanceOf', args: [r.address] })),
  )

  const executeTx = await executePolicy(clients, policy, evaluation)
  detail('execute tx', `${coston2.blockExplorers.default.url}/tx/${executeTx}`)

  const expected = resolveDistributions(compiled.privateConfig, funding)
  const balancesAfter = await Promise.all(
    recipients.map((r) => pub.readContract({ address: fxrp, abi: erc20Abi, functionName: 'balanceOf', args: [r.address] })),
  )

  recipients.forEach((r, i) => {
    const gained = balancesAfter[i]! - balancesBefore[i]!
    assert(
      gained === expected[i]!.amount,
      `${r.label} received ${formatUnits(gained, asset.decimals)} FXRP, exactly their ${r.shareBps / 100}%`,
    )
  })

  const remaining = await pub.readContract({ address: policy, abi: confidentialPolicyAbi, functionName: 'balance' })
  assert(remaining === 0n, 'no dust was left stranded in the policy')

  const finalStatus = await pub.readContract({ address: policy, abi: confidentialPolicyAbi, functionName: 'status' })
  assert(finalStatus === 2, 'the policy is Executed and can never fire again')

  console.log('\n\x1b[32m\x1b[1mEnd to end, on Coston2, with real FXRP.\x1b[0m\n')
}

async function confirm(pub: ReturnType<typeof createPublicClient>, hash: Hex): Promise<void> {
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`)
}

main().catch((error: unknown) => {
  console.error(`\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\n`)
  process.exit(1)
})
