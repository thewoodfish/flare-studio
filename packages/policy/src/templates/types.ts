import type { PolicyIR } from '../schema.js'

export type TemplateArgs = {
  name?: string
  recipients: Array<{ address: string; shareBps: number; label?: string }>
  intervalSeconds?: number
  executeAfter?: number
  demoMode?: boolean
}

export type TemplateDefinition = {
  id: string
  title: string
  /**
   * Which gallery section this template files under. A plain string rather than
   * a union: sections are a presentation grouping, and a template that invents a
   * new one should not have to edit a type in the engine to do it. The gallery
   * orders known sections and appends unknown ones, so a typo degrades to a
   * stray heading instead of a build error.
   */
  section: string
  /** One line, shown on the gallery card. */
  summary: string
  /** Plain-language explanation shown in the builder. No blockchain vocabulary. */
  explainer: string
  live: boolean
  build: (args: TemplateArgs) => unknown
}

/** Narrowing helper for callers that want the parsed form. */
export type BuiltTemplate = PolicyIR
