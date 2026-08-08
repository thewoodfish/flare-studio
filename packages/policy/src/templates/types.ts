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
  /** One line, shown on the gallery card. */
  summary: string
  /** Plain-language explanation shown in the builder. No blockchain vocabulary. */
  explainer: string
  live: boolean
  build: (args: TemplateArgs) => unknown
}

/** Narrowing helper for callers that want the parsed form. */
export type BuiltTemplate = PolicyIR
