# Flare Studio

**Your Crypto. Your Policy.**

A visual platform for building, deploying, and managing confidential,
self-executing asset policies on Flare.

You define financial intent — *if I stop checking in for a year, split my XRP
between my wife and daughter* — and it enforces itself. No lawyer, no company
holding your funds, no smart contract to write.

> **Status:** in active development for the Flare hackathon. Contracts and tests
> are working; the builder UI and confidential runtime are in progress. See
> [What's real today](#whats-real-today) — we are specific about what does and
> does not work yet.

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
packages/policy    Shared policy IR: schema, compiler, commitment
packages/contracts Solidity — the policy engine
```

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

We would rather be precise than impressive:

- ✅ **Policy engine contracts** — deploy, fund, arm, execute, cancel. 16 tests
  passing, including the attestation and commitment negative cases.
- ✅ **Genericity guard** in CI.
- 🚧 **Policy IR + compiler** — in progress.
- 🚧 **Compute Extension** — in progress.
- 🚧 **Builder UI** — in progress.
- 📋 **FDC proof-of-life trigger** — interface in place (`ITrigger`), FDC
  implementation planned. The current `ManualHeartbeatTrigger` is an on-chain
  check-in, not an attested XRPL observation.

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

**Contracts** (Node 20+, [Foundry](https://getfoundry.sh)):

```bash
cd packages/contracts
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge install foundry-rs/forge-std --no-git
forge test
```

Dependencies are vendored by Foundry but not tracked, so the history shows only
our work.

**Genericity guard:**

```bash
./scripts/lint-genericity.sh
```

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
