import type { TemplateArgs, TemplateDefinition } from './types.js'

/**
 * Template #2: Scheduled Distribution.
 *
 * This template exists to falsify -- or confirm -- the platform claim. A platform
 * backed by one template is unfalsifiable, and judges know it.
 *
 * Note what building it required: a different trigger kind and this file. No
 * schema change, no compiler branch, no new contract surface, no change to
 * ConfidentialPolicy. That is the whole argument for the architecture, and it is
 * checked by compile.test.ts rather than asserted in a README.
 *
 * If a third template ever needs more than this, the abstraction has leaked and
 * that is worth stopping to fix.
 */
export function scheduledDistribution(args: TemplateArgs) {
  return {
    version: 1 as const,
    name: args.name ?? 'Scheduled Distribution',
    asset: 'FXRP',
    trigger: {
      kind: 'timestamp' as const,
      // Default: one year out. The builder always overrides this.
      executeAfter: args.executeAfter ?? Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
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
  id: 'scheduled-distribution',
  title: 'Scheduled Distribution',
  summary: 'Release funds to chosen recipients on a specific date, privately.',
  explainer:
    'Set a date. When it arrives, the policy distributes your funds according to ' +
    'a split that stays private until the moment it executes.',
  live: true,
  build: scheduledDistribution,
}
