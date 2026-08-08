import type { TemplateArgs, TemplateDefinition } from './types.js'

/**
 * Template #1: XRP Inheritance.
 *
 * This is seed data, not a variant of the engine. It produces an ordinary
 * PolicyIR and the compiler cannot tell it apart from any other -- which is what
 * makes "inheritance is template #1, not the product" a structural fact rather
 * than a slogan.
 *
 * Template vocabulary ("beneficiary", "estate") is allowed in this directory and
 * nowhere else. The genericity guard excludes templates/ for exactly this reason.
 */
export function xrpInheritance(args: TemplateArgs) {
  return {
    version: 1 as const,
    name: args.name ?? 'XRP Inheritance',
    asset: 'FXRP',
    trigger: {
      kind: 'manualHeartbeat' as const,
      intervalSeconds: args.intervalSeconds ?? 365 * 24 * 60 * 60,
      demoMode: args.demoMode ?? false,
    },
    conditions: [],
    actions: [
      {
        kind: 'splitTransfer' as const,
        recipients: args.recipients,
      },
    ],
  }
}

export const definition: TemplateDefinition = {
  id: 'xrp-inheritance',
  title: 'XRP Inheritance',
  summary:
    'If you stop checking in, your XRP is distributed privately to the people you choose.',
  // Shown to the user in the builder. Deliberately plain language: the product
  // principle is that users think about intent, not about attestation.
  explainer:
    'You check in periodically to show you are still here. If you stop for longer ' +
    'than your chosen interval, the policy releases your funds according to a ' +
    'split that only you and the secure enclave can read.',
  live: true,
  build: xrpInheritance,
}
