import { describe, it, expect, vi } from 'vitest'
import { Pyas, AuthenticationError } from '../src'

/** A fetch that answers from a list, and remembers what it was asked. */
const fakeFetch = (...answers: Response[]) => {
    const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string> } }> = []
    const fn = vi.fn(async (url: string, init: any) => {
        calls.push({ url, init })
        return answers.length > 1 ? answers.shift()! : answers[0].clone()
    })
    return { fn: fn as unknown as typeof fetch, calls }
}

const ok = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: true, data, provider: null, traceId: 'trc_1', meta: {} }), { status, headers: { 'content-type': 'application/json' } })

describe('an app setup with a person access token (/v2/manage)', () => {
    it('sends the token as a bearer token, never an API key, and calls the manage paths', async () => {
        const f = fakeFetch(ok({ items: [] }), ok({ appId: 'app 1' }), ok({ key: null, value: 'pyas_sk_test_x', nextStep: '' }, 201))
        const pyas = new Pyas({ accessToken: 'tok_1', baseUrl: 'http://api.test', fetch: f.fn })
        expect(pyas.testMode).toBe(false)
        await pyas.manage.apps.list()
        await pyas.manage.apps.update({ appId: 'app 1', addAllowedOrigins: ['https://x.example.com'] })
        await pyas.manage.keys.createTest({ appId: 'app 1' })
        expect(f.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
            'GET http://api.test/v2/manage/apps',
            'PATCH http://api.test/v2/manage/apps/app%201',
            'POST http://api.test/v2/manage/apps/app%201/keys/test',
        ])
        expect(f.calls[0].init.headers.authorization).toBe('Bearer tok_1')
        expect(f.calls[0].init.headers['x-api-key']).toBeUndefined()
        expect(JSON.parse(f.calls[1].init.body as string)).toEqual({ addAllowedOrigins: ['https://x.example.com'] })
    })

    it('asks a token function before every request, so a refreshed token is used', async () => {
        const f = fakeFetch(ok({ items: [] }))
        let n = 0
        const pyas = new Pyas({ accessToken: async () => `tok_${++n}`, baseUrl: 'http://api.test', fetch: f.fn })
        await pyas.manage.apps.list()
        await pyas.manage.apps.list()
        expect(f.calls.map((c) => c.init.headers.authorization)).toEqual(['Bearer tok_1', 'Bearer tok_2'])
    })

    it('an API key wins over a token, and reads with x-api-key', async () => {
        const f = fakeFetch(ok({ appId: 'a' }))
        const pyas = new Pyas({ apiKey: 'pyas_sk_test_abc', accessToken: 'tok_1', baseUrl: 'http://api.test', fetch: f.fn })
        await pyas.manage.apps.get({ appId: 'a' })
        expect(f.calls[0].init.headers['x-api-key']).toBe('pyas_sk_test_abc')
        expect(f.calls[0].init.headers.authorization).toBeUndefined()
    })

    it('an ended sign-in is the API error, typed', async () => {
        const f = fakeFetch(new Response(JSON.stringify({ success: false, error: { code: 'AUTH_INVALID_SESSION', message: 'This tool was disconnected.', status: 401 } }), { status: 401, headers: { 'content-type': 'application/json' } }))
        const pyas = new Pyas({ accessToken: 'tok_1', baseUrl: 'http://api.test', fetch: f.fn })
        await expect(pyas.manage.apps.list()).rejects.toBeInstanceOf(AuthenticationError)
    })
})
