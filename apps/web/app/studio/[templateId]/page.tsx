'use client'

import { useMemo, useState } from 'react'
import { notFound, useParams, useRouter } from 'next/navigation'
import { TEMPLATES, type CompiledPolicy } from '@flare-studio/policy'
import { PolicyForm } from '@/components/policy-form'
import { Shell, TopBar, Button } from '@/components/shell'
import { Rail } from '@/components/rail'
import { Badge } from '@/components/primitives'
import type { Recipient } from '@/components/recipients-editor'
import { ReviewDrawer } from '@/components/review-drawer'
import { DeployDialog } from '@/components/deploy-dialog'
import { WalletButton } from '@/components/wallet-button'
import { useWallet } from '@/lib/wallet'
import { graphFromIr } from '@/lib/canvas'

/**
 * The policy builder.
 *
 * The template arrives in the route, chosen from the gallery, so this screen has
 * one job: render whatever IR that template produced.
 *
 * The form's steps are the policy's own primitives, derived from the IR (see
 * lib/canvas.ts and lib/inspector.ts), so a template with two actions or a
 * condition grows a step without a change here.
 */
export default function BuilderPage() {
  const params = useParams<{ templateId: string }>()
  const router = useRouter()
  const template = TEMPLATES.find((t) => t.id === params.templateId)

  const [recipients, setRecipients] = useState<Recipient[]>([
    { address: '0x1111111111111111111111111111111111111111', shareBps: 6000, label: 'Partner' },
    { address: '0x2222222222222222222222222222222222222222', shareBps: 4000, label: 'Child' },
  ])
  const [reviewing, setReviewing] = useState(false)
  const [deploying, setDeploying] = useState<CompiledPolicy | null>(null)
  const [deployed, setDeployed] = useState(false)

  const wallet = useWallet()

  // Stable for the session. In the real deploy path this is fresh randomness
  // per policy -- it is what stops the commitment being brute-forceable over a
  // small recipient space.
  const salt = useMemo(
    () =>
      `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as `0x${string}`,
    [],
  )

  // Every hook below runs unconditionally, including for an unknown template --
  // the 404 is raised after them. Bailing out earlier would make the hook order
  // depend on the URL, which React forbids.
  // The template seeds the draft; the draft is then authoritative. Keeping the
  // trigger in state rather than re-deriving it is what makes the template seed
  // data rather than the source of truth for the life of the session -- edit the
  // trigger and it stays edited, including across recipient changes.
  const seeded = useMemo(
    () => (template ? (template.build({ recipients, demoMode: true }) as Record<string, any>) : null),
    [template, recipients],
  )

  const [trigger, setTrigger] = useState<Record<string, any> | null>(null)

  const ir = useMemo<Record<string, any> | null>(
    () => (seeded ? { ...seeded, trigger: trigger ?? seeded.trigger } : null),
    [seeded, trigger],
  )

  const graph = useMemo(
    () => (ir ? graphFromIr(ir) : { nodes: [], edges: [] }),
    [ir],
  )

  // The step is the primitive being edited. Defaulting to the trigger rather
  // than the asset puts the user on the first thing they can actually change --
  // the asset is fixed while FXRP is the only live one.
  const [step, setStep] = useState<string>('trigger')

  // A URL naming a template that does not exist is a 404, not a silent fallback
  // to the first one -- a fallback would quietly build the wrong policy.
  if (!template || !ir) notFound()

  return (
    <Shell
      rail={<Rail />}
    >
      <TopBar
        title={ir.name}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {deployed ? <Badge tone="success">Deployed</Badge> : 'Draft'}
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            {template.section}
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            {template.title}
          </span>
        }
        actions={
          <>
            <WalletButton wallet={wallet} />
            <Button onClick={() => router.push('/studio')}>Templates</Button>
            <Button variant="primary" onClick={() => setReviewing(true)}>
              Review and deploy
            </Button>
          </>
        }
      />

      <PolicyForm
        graph={graph}
        ir={ir}
        step={step}
        onStep={setStep}
        recipients={recipients}
        onRecipientsChange={setRecipients}
        onTriggerChange={setTrigger}
        onReview={() => setReviewing(true)}
      />

      {reviewing && (
        <ReviewDrawer
          ir={ir}
          salt={salt}
          onClose={() => setReviewing(false)}
          onDeploy={(compiled) => {
            // The review already compiled for real, so what the user just read
            // is exactly what is handed to the deploy flow -- no recompile, no
            // opportunity for the two to disagree.
            setDeploying(compiled)
            setReviewing(false)
          }}
        />
      )}

      {deploying && (
        <DeployDialog
          compiled={deploying}
          salt={salt}
          templateId={template.id}
          onClose={() => setDeploying(null)}
          onDeployed={() => setDeployed(true)}
        />
      )}
    </Shell>
  )
}

/**
 * Renders whatever panel the inspector module produced. It knows about rows and
 * named editors, and nothing about assets, triggers or actions.
 */
const helpText = {
  fontSize: 12.5,
  color: 'var(--text-secondary)',
  marginTop: 'var(--space-4)',
  lineHeight: 1.55,
} as const

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: 'var(--space-2) 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontWeight: 520,
          marginLeft: 'var(--space-4)',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
