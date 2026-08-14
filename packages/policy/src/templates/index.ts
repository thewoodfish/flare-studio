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

/**
 * The order sections appear in the gallery.
 *
 * Presentation order only. A section absent from this list still renders -- it
 * is appended after the known ones, alphabetically -- so adding a template with
 * a new section never requires editing this array. Forgetting to is a cosmetic
 * ordering bug, not a missing template.
 */
export const SECTION_ORDER = ['Succession', 'Treasury', 'Escrow'] as const

export type TemplateSection = {
  name: string
  templates: TemplateDefinition[]
}

/**
 * Templates grouped for the gallery, in display order.
 *
 * Grouping lives here rather than in the UI for the same reason the registry
 * does: this file is the only place that knows which templates exist, so it is
 * the only place that can group them without naming one.
 */
export function templatesBySection(): TemplateSection[] {
  const groups = new Map<string, TemplateDefinition[]>()
  for (const template of TEMPLATES) {
    const existing = groups.get(template.section)
    if (existing) existing.push(template)
    else groups.set(template.section, [template])
  }

  const rank = (name: string) => {
    const i = SECTION_ORDER.indexOf(name as (typeof SECTION_ORDER)[number])
    return i === -1 ? SECTION_ORDER.length : i
  }

  return [...groups.entries()]
    .map(([name, templates]) => ({ name, templates }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}
