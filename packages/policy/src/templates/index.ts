import type { TemplateDefinition } from './types.js'
import { definition as xrpInheritance } from './xrp-inheritance.js'
import { definition as scheduledDistribution } from './scheduled-distribution.js'

/**
 * The template registry.
 *
 * This file is the only place in the codebase that names individual templates.
 * Everything upstream -- the engine barrel, the compiler, the UI gallery --
 * consumes this array and never a specific template, which is what lets the
 * genericity guard stay strict on engine code.
 *
 * Adding a template: write the file, add it here. Nothing else.
 */
export const TEMPLATES: TemplateDefinition[] = [xrpInheritance, scheduledDistribution]

export function getTemplate(id: string): TemplateDefinition {
  const template = TEMPLATES.find((t) => t.id === id)
  if (!template) {
    throw new Error(
      `Unknown template "${id}". Known: ${TEMPLATES.map((t) => t.id).join(', ')}`,
    )
  }
  return template
}

export function liveTemplates(): TemplateDefinition[] {
  return TEMPLATES.filter((t) => t.live)
}
