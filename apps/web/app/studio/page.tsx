'use client'

import Link from 'next/link'
import { templatesBySection, type TemplateDefinition } from '@flare-studio/policy'
import { Shell, TopBar } from '@/components/shell'
import { Rail } from '@/components/rail'
import { Badge } from '@/components/primitives'

/**
 * The template gallery -- the front door of Flare Studio.
 *
 * The product claim is that inheritance is template #1, not the product. A
 * builder that opened straight onto an inheritance canvas contradicted that
 * claim on the first screen, whatever the README said. Choosing from a shelf of
 * policies, grouped by what they are for, states the architecture as the first
 * thing a user sees.
 *
 * Sections and their order come from the registry. This page never names a
 * template.
 */
export default function GalleryPage() {
  const sections = templatesBySection()

  return (
    <Shell rail={<Rail />}>
      <TopBar title="Flare Studio" subtitle="Choose a policy template to start from" />

      <div style={{ overflowY: 'auto', padding: 'var(--space-8)' }}>
        <div style={{ maxWidth: 940, margin: '0 auto' }}>
          {sections.map((section) => (
            <section key={section.name} style={{ marginBottom: 'var(--space-10)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                <h2
                  style={{
                    fontSize: 11,
                    fontWeight: 560,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {section.name}
                </h2>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'var(--space-4)',
                }}
              >
                {section.templates.map((template) => (
                  <TemplateCard key={template.id} template={template} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function TemplateCard({ template }: { template: TemplateDefinition }) {
  // A template that is not live has nothing to build yet, so the card is inert
  // rather than a link that lands on a broken canvas.
  const body = (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 560, color: 'var(--text-primary)' }}>
          {template.title}
        </h3>
        {template.live ? (
          <Badge tone="success">Live</Badge>
        ) : (
          <Badge tone="neutral">Soon</Badge>
        )}
      </div>

      <p
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
          margin: 0,
        }}
      >
        {template.summary}
      </p>
    </>
  )

  const style = {
    display: 'block',
    padding: 'var(--space-5)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    textDecoration: 'none',
    transition: `border-color var(--duration-fast) var(--ease), box-shadow var(--duration-fast) var(--ease)`,
  } as const

  if (!template.live) {
    return <div style={{ ...style, opacity: 0.55 }}>{body}</div>
  }

  return (
    <Link
      href={`/studio/${template.id}`}
      style={style}
      className="template-card"
      aria-label={`Open ${template.title}`}
    >
      {body}
    </Link>
  )
}
