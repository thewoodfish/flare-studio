import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeActionData, pollActionResult, type ActionResponse } from '../src/instructions'

/**
 * Covers the decode and poll logic, which is where the orchestrator's own bugs
 * would live. The on-chain paths are exercised by the headless demo against a
 * real network rather than mocked here -- a mocked chain would mostly assert
 * that viem was called, which proves nothing about the integration.
 */

function response(overrides: Partial<ActionResponse['result']>): ActionResponse {
  return {
    result: { status: 1, log: 'ok', data: null, version: '0.1.0', ...overrides },
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

describe('decodeActionData', () => {
  it('decodes a base64 JSON payload', () => {
    const evaluation = {
      policy: '0xAAAA000000000000000000000000000000000001',
      shares: [{ recipient: '0x1111111111111111111111111111111111111111', shareBps: 10000 }],
      salt: '0x22',
      signature: '0xdeadbeef',
    }

    expect(decodeActionData(response({ data: encode(evaluation) }))).toEqual(evaluation)
  })

  it('surfaces the enclave log when the status is not success', () => {
    expect(() =>
      decodeActionData(
        response({ status: 0, log: 'error: no stored policy for 0xabc; send STORE first' }),
      ),
    ).toThrow(/no stored policy/)
  })

  it('rejects a success with no data', () => {
    expect(() => decodeActionData(response({ status: 1, data: null }))).toThrow(/no data/)
  })
})

  /**
   * The live proxy returns 0x-hex. Base64-decoding hex produces plausible binary,
   * so the original assumption failed as a JSON parse error on a replacement
   * character rather than as anything naming the encoding.
   */
  it('decodes the 0x-hex a live proxy actually returns', () => {
    const payload = '{"policy":"0xabc","stored":true,"shareCount":2}'
    const hex = `0x${Buffer.from(payload, 'utf8').toString('hex')}`
    expect(decodeActionData({ result: { status: 1, log: 'ok', data: hex, version: '0.1.0' } }))
      .toEqual({ policy: '0xabc', stored: true, shareCount: 2 })
  })

  it('still accepts base64, for an older proxy', () => {
    const payload = '{"stored":true}'
    const b64 = Buffer.from(payload, 'utf8').toString('base64')
    expect(decodeActionData({ result: { status: 1, log: 'ok', data: b64, version: '0.1.0' } }))
      .toEqual({ stored: true })
  })

  it('treats an empty 0x as no data', () => {
    expect(() =>
      decodeActionData({ result: { status: 1, log: 'ok', data: '0x', version: '0.1.0' } }),
    ).toThrow(/no data/)
  })

describe('pollActionResult', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the result once the enclave answers', async () => {
    const payload = response({ data: encode({ ok: true }) })
    let calls = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        // 404 is the normal "not yet", not a failure.
        if (calls < 3) return new Response('not found', { status: 404 })
        return new Response(JSON.stringify(payload), { status: 200 })
      }),
    )

    const result = await pollActionResult('https://proxy.example', '0xabc', { intervalMs: 1 })

    expect(result).toEqual(payload)
    expect(calls).toBe(3)
  })

  it('explains a persistent 404 rather than just timing out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))

    await expect(
      pollActionResult('https://proxy.example', '0xabc', { timeoutMs: 20, intervalMs: 5 }),
    ).rejects.toThrow(/never reached the TEE/)
  })

  it('survives a proxy that is temporarily unreachable', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) throw new Error('ECONNREFUSED')
        return new Response(JSON.stringify(response({ data: encode({ ok: true }) })), {
          status: 200,
        })
      }),
    )

    await expect(
      pollActionResult('https://proxy.example', '0xabc', { intervalMs: 1 }),
    ).resolves.toBeDefined()
  })

  it('tolerates a trailing slash on the proxy url', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(response({ data: encode({ ok: true }) })), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await pollActionResult('https://proxy.example/', '0xabc', { intervalMs: 1 })

    expect(fetchMock).toHaveBeenCalledWith('https://proxy.example/action/result/0xabc')
  })
})
