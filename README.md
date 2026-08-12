# Flare Studio

**Your Crypto. Your Policy.**

A visual platform for building, deploying, and managing confidential,
self-executing asset policies on Flare.

You define financial intent — *if I stop checking in for a year, split my XRP
between my wife and daughter* — and it enforces itself. No lawyer, no company
holding your funds, no smart contract to write.

> **Status:** the full lifecycle runs end to end on live Coston2 — a real policy,
> real FXRP, a real TEE at `PRODUCTION`, and recipients paid the exact split they
> were promised. The FDC proof-of-life trigger is the one planned feature that
> did not land. See [What's real today](#whats-real-today) — we are specific
> about what does and does not work.

---

## The problem

If you hold crypto and you die, or lose your keys, it is gone. There is no bank
to call and no branch to visit with a death certificate. A will does not help:
your family cannot reach the assets without your seed phrase, and writing that
phrase somewhere a lawyer can read it means handing someone your money.

## How it works

1. **Build a policy by dragging boxes on a canvas.** Asset → trigger → who
   receives what. You never see a contract.
2. **The private part stays private.** Recipients and amounts are encrypted to a
   Trusted Execution Environment. Only a *fingerprint* — a hash — goes on-chain:
   enough to prove later that nobody swapped in a different recipient, not enough
   for anyone to read who they are.
3. **You check in by sending a tiny payment.** That is your proof of life. If you
   stop, Flare's Data Connector can *prove* you stopped, and the policy fires.

## Why Flare

Three protocols, each load-bearing rather than decorative:

| | |
|---|---|
| **FAssets** | Holds real XRP inside a smart contract as FXRP — a live FAsset on Coston2, not a mock token. |
| **FDC** | `ReferencedPaymentNonexistence` proves an expected payment *did not arrive* by a deadline. Proving an absence is normally impossible for a smart contract; this is what makes the trigger real rather than simulated. |
| **FCC** | The policy is decrypted and evaluated inside a TEE registered with Flare's `FlareTeeManager`, validated by data-provider consensus. The contract accepts results only from an attested machine. |

## Architecture

```
apps/web           Next.js — policy builder, deployment manager, monitor
apps/extension     Go — the Flare Compute Extension (evaluates policies in the TEE)
apps/orchestrator  TypeScript — non-confidential work: FDC pipeline, instruction sending
packages/policy    Shared policy IR: schema, compiler, commitment, ECIES
packages/contracts Solidity — the policy engine
```

The path a policy takes, and where the plaintext is allowed to exist:

```mermaid
flowchart TD
    A["Builder canvas<br/><i>apps/web</i>"] --> B["Compiler<br/><i>packages/policy</i>"]
    B --> C["publicArgs<br/>commitment, trigger, asset"]
    B --> D["privateConfig<br/>recipients and shares"]

    C --> E["PolicyFactory.deploy<br/><i>on-chain, in the clear</i>"]
    D --> F["ECIES seal to the<br/>enclave's public key"]
    F --> G["sendStorePolicy<br/><i>on-chain, opaque bytes</i>"]

    E --> H["ConfidentialPolicy<br/>holds only the commitment"]
    G --> I["TEE extension<br/><i>apps/extension, Go</i>"]

    J["Trigger fires<br/>ITrigger.check"] --> K["arm()<br/><i>permissionless</i>"]
    K --> L["EVALUATE instruction"]
    L --> I
    I --> M["Signed distribution<br/>EIP-712, enclave key"]
    M --> N["execute()"]
    H --> N
    N --> O["Recipients paid"]

    style D fill:#f5f1fe,stroke:#6134c4
    style F fill:#f5f1fe,stroke:#6134c4
    style I fill:#f5f1fe,stroke:#6134c4
```

The shaded path is the only place the recipient list exists in plaintext: the
user's browser, and inside the enclave. It is sealed before it leaves the
browser and submitted to the chain directly, so no server of ours ever holds it
— which is why the orchestrator can run on ordinary hosting without weakening
the claim.

### The security model

`execute()` requires two independent things, and neither alone is sufficient:

1. **An attested signer** — the recovered EIP-712 signer must be a `PRODUCTION`
   TEE machine according to Flare's registry. This stops anyone else signing.
2. **A matching commitment** — the revealed distribution must hash to the
   commitment fixed at deploy time. This stops *even an attested machine* from
   substituting a different payout.

Both are covered by tests, including one where the attested machine itself tries
to redirect the funds.

### Inheritance is not the product

It is template #1. The engine is deliberately ignorant of it: `ConfidentialPolicy`
holds no heartbeat interval, no deadline, no price threshold, no notion of an
estate. Trigger state lives behind `ITrigger`, condition state behind
`ICondition`. A scheduled-distribution policy reuses the entire stack with a
different trigger and no schema change.

This is enforced mechanically — `scripts/lint-genericity.sh` fails CI if template
vocabulary reaches engine code. The engine's word is `recipient`.

Assets are configuration too. Adding FBTC the day it goes live should be one
registry entry and nothing else.

---

## What's real today

We would rather be precise than impressive. "Built" below means tested; where
something is written but has not been run against the live network, it says so.

- ✅ **Policy engine contracts** — deploy, fund, arm, execute, cancel. 34 tests,
  including both attestation negative cases, the commitment negative cases, and
  one where an attested machine itself tries to redirect the funds.
- ✅ **Attestor gate, fork-tested** against the live `FlareTeeManager` on Coston2,
  not only against a mock. That test found a real bug on its first run: the
  deployed manager reverts for an unregistered address rather than returning a
  status, so `SignerNotAttested` could never have fired in production. The gate
  now fails closed.
- ✅ **Policy IR + compiler** — 54 tests. Both templates compile through one code
  path with no branch on template name, and a policy compiles against a second
  asset with no change outside `assets.ts`.
- ✅ **Cross-language commitment** — computed in TypeScript, checked in Solidity,
  re-derived in Go, with all three asserted against one shared fixture.
- ✅ **Go TEE extension** — custom `POLICY` op type, `STORE` and `EVALUATE`
  handlers, ECIES decrypt, EIP-712 signing.
- ✅ **Builder, Deployment Manager, Monitor** — the full browser flow: compile,
  seal, deploy, configure the trigger, hand off to the enclave, fund, check in,
  and the demo control.
- ✅ **Proven end to end on live Coston2.** `pnpm demo` compiles a policy, seals
  it, deploys it, funds it with real FXRP, hands the sealed half to the enclave,
  checks in, misses the next deadline, arms, has the enclave evaluate and sign,
  and executes — then asserts the recipients received exactly the split fixed at
  deploy time, that no dust was stranded, and that the policy can never fire
  again. Last run: recipients paid 0.6001 and 0.3999 FXRP against a 60.01/39.99
  split, [execute tx](https://coston2-explorer.flare.network/tx/0x23969dd293a5add553e202fff28f5db9608ea79b70ef1485b23322838503f15a).
- ✅ **The enclave hand-off works.** A registered machine at `PRODUCTION` opens
  the sealed policy and answers `{"stored":true,"shareCount":2}` — a count, never
  a recipient. `pnpm handoff-check` is that path on its own, and needs no FXRP.
- ✅ **The attestation gate is load-bearing, not decorative.** `execute()`
  succeeded only because the recovered EIP-712 signer is a machine Flare's
  registry reports as `PRODUCTION`. That is the Bounty 2 claim, demonstrated.
- 📋 **FDC proof-of-life trigger** — not implemented. `ITrigger` is in place and
  the verifier endpoints are pinned in `apps/orchestrator/src/fdc.ts`, but
  `FdcNonexistenceTrigger` does not exist yet. The current
  `ManualHeartbeatTrigger` is an on-chain check-in, not an attested XRPL
  observation. This was the planned overflow item and it is the one that
  slipped.

### Honest scope notes

- **Proof-of-life, not passive monitoring.** The owner actively sends a small
  payment before each deadline. `ReferencedPaymentNonexistence` proves a
  *specific expected payment* is missing; it cannot prove a wallet did nothing.
- **The TEE decrypts policy contents to evaluate them.** That is what a TEE is
  for. The operator cannot read that memory and the contract accepts results only
  from an attested image — it does not mean nobody ever decrypts.
- **We run `SIMULATED_TEE=true` on Coston2.** The attestation path is real end to
  end — registration, governance, data-provider consensus, `PRODUCTION` status,
  signed results. Simulation replaces the hardware measurement with a fixed code
  hash; the same code runs unchanged against a real Confidential VM.
- **`simulateInactivity()`** exists so the demo is deterministic — you cannot
  fast-forward a testnet, and a twelve-month timer does not demo. It is inert
  unless `demoMode` was set at deploy, and the UI labels it as a demo control.

---

## Running it

Requires Node 20+, pnpm, [Foundry](https://getfoundry.sh), and Go 1.22+ for the
extension.

```bash
git clone --recurse-submodules <this repo>
pnpm install
```

The `--recurse-submodules` matters: `forge-std` and `openzeppelin-contracts` are
pinned submodules. If you already cloned without it, `git submodule update
--init --recursive`.

**Everything that runs offline** — this is what CI runs, and it needs no keys,
no funds and no network beyond a package install:

```bash
pnpm test                                    # policy, orchestrator, contracts
./scripts/lint-genericity.sh                 # the engine may not learn what an inheritance is
pnpm -r typecheck
cd packages/contracts && forge test          # 34 tests, incl. the Coston2 fork test
cd apps/extension/go && go test ./...
```

The fork test skips itself if the Coston2 RPC is unreachable, so a working tree
without network access still goes green.

**Is this machine ready?**

```bash
pnpm preflight
```

Checks the toolchain, the enclave stack, the deployer's funding and the deployed
contracts — including that each recorded address actually has code on Coston2 —
and prints the specific command to fix whatever is missing. Run it before
anything that costs gas. It never prints a key.

**The app:**

```bash
cp apps/web/.env.example apps/web/.env.local   # then fill in the deployed addresses
pnpm --filter @flare-studio/web dev            # http://localhost:3000/studio
```

The builder and the review step work without any of that. Deploying needs a
deployed engine to point at, and the app will tell you so rather than sending a
transaction to an empty address.

**The end-to-end run** — the real regression test. This one costs gas and needs
a live enclave:

```bash
pnpm demo
```

It compiles a policy, seals it, deploys, funds it with real FXRP, hands the
sealed half to the enclave, checks in, misses the next deadline, arms, has the
enclave sign, executes, and then asserts that each recipient received exactly
the share fixed at deploy time and that no dust was stranded. The script prints
what it needs if the environment is incomplete.

---

## Roadmap

**Protocol Managed Wallets.** Today a user holds wrapped FXRP, so inheritance
operates on a wrapped token. FCC lists PMW — programmable assembly and signing of
transactions on external chains — as a system application. With it, a policy could
custody **native XRP on the XRPL** and have the TEE sign the real payments to
recipients. No minting, no wrapper: you bequeath your actual XRP.

Then: more templates (family trust, escrow, vesting, treasury controls), more
assets as FAssets go live, and published templates from third-party developers.

## License

MIT
