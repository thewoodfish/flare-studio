# Claude.md

# Flare Studio

**Tagline:** Your Crypto. Your Policy.

## Vision

Flare Studio is a visual platform for building, deploying, and managing confidential, self-executing asset policies on Flare.

Instead of writing Solidity or manually composing smart contracts, users define financial intent through reusable policy templates and visual workflows. Flare Studio compiles those policies into secure, confidential execution powered by Flare's interoperability stack.

The long-term goal is to become the standard policy layer for interoperable digital assets.

---

# Philosophy

Most blockchain applications are built as one-off smart contracts.

Flare Studio is different.

We are building the infrastructure that allows many financial products to be expressed using the same policy model.

Think:

- GitHub Actions for digital assets
- Terraform for asset governance
- Figma for financial policies

The first application happens to be XRP inheritance.

Inheritance is **not** the product.

It is the first policy template.

---

# Product Definition

Flare Studio is a visual policy builder.

Users create policies instead of contracts.

Examples:

- Digital inheritance
- Conditional asset allocation
- Family trusts
- Treasury controls
- Escrow
- Time locks
- Scheduled distributions
- Multi-party approvals
- Price-triggered execution
- Oracle-triggered execution

Every policy is composed from reusable primitives.

---

# Core Design Principle

Users never think about:

- smart contracts
- confidential execution
- Flare Data Connector
- FTSO
- FAssets

Users think about intent.

Example:

> If I become inactive for twelve months,
> transfer my XRP equally to my wife and daughter.

Flare Studio handles everything else.

---

# Why Flare

Flare uniquely provides the primitives required to build programmable asset policies.

## FAssets

Allows assets such as XRP and Bitcoin to participate inside smart contract execution.

These become programmable assets.

FXRP is the furthest along — already live, and available on testnet without a minting flow.
That is why XRP is the launch asset.

---

## Confidential Compute

Sensitive policy information should never become public.

Examples:

- beneficiaries
- wallet mappings
- inheritance rules
- family information
- approval policies
- recovery mechanisms

Policies execute privately.

Only execution proofs become public.

---

## Flare Data Connector (FDC)

Provides trusted external events.

Examples:

- wallet heartbeat
- wallet activity
- external attestations
- proof-based conditions

These become policy triggers.

FDC's `ReferencedPaymentNonexistence` type proves an expected payment did *not* arrive by a
deadline. That is a dead-man's switch as a cryptographic primitive, and it is what makes the
inheritance trigger real rather than simulated.

---

## Flare Time Series Oracle (FTSO)

Provides market information.

Examples:

- XRP price
- BTC price
- volatility
- future oracle integrations

Policies can react automatically to market conditions.

---

# Core Product

Flare Studio consists of five major systems.

## 1. Policy Builder

Visual editor.

Drag-and-drop policy construction.

No coding required.

---

## 2. Policy Compiler

Transforms visual workflows into executable Flare programs.

Responsible for:

- contract generation
- confidential execution configuration
- oracle subscriptions
- deployment artifacts

---

## 3. Confidential Runtime

Executes private policy logic.

Maintains encrypted state.

Evaluates confidential conditions.

Produces verifiable execution proofs.

---

## 4. Deployment Manager

Deploys policies.

Monitors status.

Version management.

Updates.

Rollback.

Execution history.

---

## 5. Policy Library

Reusable templates.

Examples:

- XRP Inheritance
- Family Trust
- Escrow
- Treasury Policy
- Vesting
- Conditional Allocation

---

# Policy Model

Every policy is built from a small number of primitives.

## Asset

What is governed?

Examples:

- XRP
- Bitcoin
- FLR
- Stablecoins

---

## Trigger

What starts evaluation?

Examples:

- Time
- Wallet heartbeat
- Oracle update
- Manual approval
- External proof

---

## Conditions

Additional logic.

Examples:

- inactivity > 12 months
- XRP > $5
- guardian approval
- milestone reached

---

## Confidential Inputs

Private information.

Examples:

- beneficiary addresses
- identity mappings
- recovery contacts
- personal rules

---

## Actions

What happens?

Examples:

- transfer
- split assets
- release funds
- lock vault
- require approval
- notify

---

# Initial Policy Templates

The platform launches with one production-quality template.

## XRP Inheritance

Purpose:

Secure digital inheritance using confidential execution.

Example:

If the owner fails to provide a heartbeat for twelve months:

- execute confidential verification
- distribute XRP according to private inheritance policy

This serves as the showcase application for the platform.

The heartbeat is a proof-of-life payment: a small XRPL transaction carrying the policy's own
reference. Its absence past the deadline is what FDC attests to. The owner proves presence;
the protocol proves absence.

---

Future templates:

Bitcoin Inheritance

Family Trust

Treasury Governance

Conditional Payments

Escrow

Scheduled Distributions

Charitable Giving

Education Trust

Founder Vesting

DAO Treasury Controls

Multi-signature Governance

---

# User Experience

Users should feel like they are creating documents, not programming.

Workflow:

Create Policy

↓

Choose Template

↓

Configure Rules

↓

Review Summary

↓

Deploy

↓

Monitor

---

Never expose unnecessary blockchain complexity.

---

# MVP

The hackathon focuses on one vertical slice.

Template:

XRP Inheritance

Demo Flow:

1. Create inheritance policy.

2. Deposit FXRP.

3. Configure beneficiary.

4. Send a proof-of-life payment, then miss the next deadline.

5. Confidential runtime evaluates policy and proves the absence via FDC.

6. Assets automatically transfer.

FXRP is the real FAsset on Coston2, not a mock token.

The demo should communicate the platform vision while remaining achievable.

---

# Architecture

UI

↓

Policy Builder

↓

Policy Compiler

↓

Confidential Runtime

↓

Flare Smart Contracts

↓

FAssets

↓

FDC / FTSO

↓

Execution

---

# Future Vision

Flare Studio becomes the operating system for programmable financial policies.

Developers publish policy templates.

Users deploy policies without writing code.

Institutions create reusable governance standards.

Applications build on top of the policy engine instead of reinventing governance logic.

Eventually, Flare Studio becomes the standard way applications express financial intent on Flare.

---

# Design Principles

- Product first.
- Infrastructure second.
- Hide blockchain complexity.
- Privacy by default.
- Templates over code.
- Visual before technical.
- Modular architecture.
- Everything should feel approachable.

---

# Success Metric

A user with no blockchain development experience should be able to deploy a confidential XRP inheritance policy in under five minutes.

---

# What We Are Building

We are **not** building:

- another wallet
- another vault
- another bridge
- another DeFi protocol

We are building a visual platform for creating confidential, programmable asset policies.

XRP inheritance is simply the first demonstration of what that platform makes possible.