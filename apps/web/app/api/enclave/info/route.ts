import { NextResponse } from 'next/server'

/**
 * The enclave's `/info`, read same-origin.
 *
 * The extension proxy is Flare's, not ours, and it answers `/info` with no
 * `Access-Control-Allow-Origin` header and a 405 for the preflight `OPTIONS`.
 * Node does not care -- which is why `pnpm demo` and `pnpm handoff-check` have
 * always been able to seal -- but a browser cannot read a single byte of it.
 * The symptom is a bare `TypeError: Failed to fetch`, which the deploy dialog
 * could only report as "no enclave key available": the browser path got as far
 * as deploying a policy nothing could ever open.
 *
 * So the *public* key travels through our own origin. What deliberately does
 * not: the sealed payload. Encryption still happens in the browser and the
 * ciphertext still goes to chain straight from the user's wallet -- see
 * `lib/store-policy.ts`. This route is a read-only forward of a public document
 * and never sees policy material, which is the whole reason it is an acceptable
 * fix rather than a hole in the trust boundary.
 *
 * A substituted key here would produce ciphertext the real enclave cannot open,
 * so it fails closed and loudly at hand-off rather than leaking anything. The
 * key is also checked against the machine registered on chain before any funds
 * move, which is the check that actually carries the weight.
 */

// The machine re-registers with a new key on every relaunch, so a cached
// response is a sealed policy nobody can open.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const base = process.env.NEXT_PUBLIC_EXT_PROXY_URL
  if (!base) {
    return NextResponse.json(
      { error: 'No extension proxy is configured in this build.' },
      { status: 503 },
    )
  }

  let response: Response
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/info`, {
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        // Without this an ngrok free tunnel serves its HTML interstitial to
        // anything that looks like a browser. Any value works; the header only
        // has to be present.
        'ngrok-skip-browser-warning': 'true',
      },
    })
  } catch (e) {
    // The tunnel being down is the single most common cause, and it is worth
    // naming: the alternative is a 500 that reads like an app bug.
    return NextResponse.json(
      { error: `the extension proxy at ${base} could not be reached (${message(e)})` },
      { status: 502 },
    )
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `the extension proxy returned ${response.status}` },
      { status: 502 },
    )
  }

  // Assert the content type before parsing. A tunnel interstitial, a login page
  // or a 200-with-HTML error all fail here with something that names the cause,
  // rather than as a JSON parse error twenty lines away in the browser.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    return NextResponse.json(
      {
        error:
          `the extension proxy returned ${contentType || 'an unknown content type'} ` +
          'instead of JSON -- the tunnel is probably serving a warning or error page ' +
          'rather than the enclave',
      },
      { status: 502 },
    )
  }

  return NextResponse.json(await response.json(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message.split('\n')[0]!
  return String(e)
}
