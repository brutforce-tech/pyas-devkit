import { describe, it, expect, vi } from 'vitest'
import {
    Pyas, NotFoundError, RateLimitError, ValidationError, ConnectionError, ApiError, PyasError,
    verifyWebhook, constructWebhookEvent, signWebhookForTest,
} from '../src'

/** A fetch that answers from a list, and remembers what it was asked. */
const fakeFetch = (...answers: Array<Response | (() => Response) | Error>) => {
    const calls: Array<{ url: string; init: RequestInit & { headers: Record<string, string> } }> = []
    const fn = vi.fn(async (url: string, init: any) => {
        calls.push({ url, init })
        // The last answer repeats (a copy each time); the others are used once.
        const next = answers.length > 1 ? answers.shift()! : answers[0] instanceof Response ? answers[0].clone() : answers[0]
        if (next instanceof Error) throw next
        return typeof next === 'function' ? next() : next
    })
    return { fn: fn as unknown as typeof fetch, calls }
}

const ok = (data: unknown, extra: { status?: number; meta?: unknown; headers?: Record<string, string> } = {}) =>
    new Response(JSON.stringify({ success: true, data, provider: 'pyas', traceId: 'trc_1', meta: extra.meta ?? {} }), {
        status: extra.status ?? 200, headers: { 'content-type': 'application/json', ...(extra.headers ?? {}) },
    })

const fail = (status: number, code: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ success: false, error: { code, message: `${code} happened`, hint: 'Do this instead.', status, traceId: 'trc_err', docs: `https://developer.pyas.io/errors/${code}` } }), {
        status, headers: { 'content-type': 'application/json', ...headers },
    })

const client = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) =>
    new Pyas({ apiKey: 'pyas_sk_test_abc', baseUrl: 'http://api.test', fetch, ...extra })

describe('the client', () => {
    it('sends the key, the path, the query and the body where each belongs', async () => {
        const f = fakeFetch(ok({ id: 'evt_1', title: 'Standup' }, { status: 201 }))
        const pyas = client(f.fn)
        const event = await pyas.events.create({ accountId: 'acc 1', calendarRef: 'primary', title: 'Standup', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T09:15:00Z' })
        expect(event).toEqual({ id: 'evt_1', title: 'Standup' })
        const { url, init } = f.calls[0]
        expect(url).toBe('http://api.test/v2/events?accountId=acc+1&calendarRef=primary')
        expect(init.method).toBe('POST')
        expect(init.headers['x-api-key']).toBe('pyas_sk_test_abc')
        expect(init.headers['user-agent']).toMatch(/^pyas-sdk-node\//)
        expect(JSON.parse(init.body as string)).toEqual({ title: 'Standup', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T09:15:00Z' })
        // How it was answered rides along, without serializing.
        expect((event as any).lastResponse).toMatchObject({ status: 201, traceId: 'trc_1', provider: 'pyas' })
        expect(JSON.stringify(event)).not.toContain('lastResponse')
        expect(pyas.testMode).toBe(true)
    })

    it('puts path parameters in the path, encoded; lists joined with commas; metadata filters as metadata.<key>', async () => {
        const f = fakeFetch(ok({ id: 'evt/1' }), ok([], { meta: { nextCursor: null } }))
        const pyas = client(f.fn)
        await pyas.events.get({ eventId: 'evt/1', accountId: 'a' })
        expect(f.calls[0].url).toBe('http://api.test/v2/events/evt%2F1?accountId=a')
        await pyas.events.list({ accountIds: ['a', 'b'], from: '2026-10-19T00:00:00Z', expand: true, metadata: { orderId: 'X-1' } })
        const u = new URL(f.calls[1].url)
        expect(u.searchParams.get('accountIds')).toBe('a,b')
        expect(u.searchParams.get('expand')).toBe('true')
        expect(u.searchParams.get('metadata.orderId')).toBe('X-1')
    })

    it('refuses what it cannot send: a missing path parameter, an unknown one, ifMatch where it does not apply, no key', async () => {
        const pyas = client(fakeFetch(ok({})).fn)
        // An async call rejects, never throws where it is called.
        await expect(pyas.events.get({ accountId: 'a' } as any)).rejects.toThrow('events.get needs eventId')
        await expect(pyas.accounts.list({ nope: 1 } as any)).rejects.toThrow('Unknown parameter for accounts.list: nope')
        await expect(pyas.accounts.list({}, { ifMatch: '3' })).rejects.toThrow('accounts.list does not take ifMatch')
        const saved = process.env.PYAS_API_KEY
        delete process.env.PYAS_API_KEY
        expect(() => new Pyas({ fetch: fakeFetch(ok({})).fn })).toThrow(PyasError)
        process.env.PYAS_API_KEY = saved
    })

    it('sends an idempotency key on every write, the same one on every retry, and yours when you give one', async () => {
        const f = fakeFetch(fail(503, 'PROVIDER_UNAVAILABLE', { 'retry-after': '0.01' }), ok({ id: 'evt_1' }, { status: 201 }))
        const pyas = client(f.fn)
        await pyas.events.create({ accountId: 'a', title: 'T', startsAt: 's', endsAt: 'e' } as any)
        expect(f.calls).toHaveLength(2)
        const [k1, k2] = f.calls.map((c) => c.init.headers['idempotency-key'])
        expect(k1).toMatch(/^[0-9a-f-]{36}$/)
        expect(k2).toBe(k1)
        const g = fakeFetch(ok({ id: 'evt_2' }, { status: 201 }))
        await client(g.fn).events.create({ accountId: 'a' } as any, { idempotencyKey: 'mine-1' })
        expect(g.calls[0].init.headers['idempotency-key']).toBe('mine-1')
        // An update with If-Match, and its own key; a delete has one too, and a read never.
        const h = fakeFetch(ok({ id: 'evt_1' }))
        await client(h.fn).events.update({ eventId: 'evt_1', accountId: 'a', title: 'New' } as any, { ifMatch: '7' })
        expect(h.calls[0].init.headers['if-match']).toBe('7')
        expect(h.calls[0].init.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
        const d = fakeFetch(ok({}))
        await client(d.fn).webhooks.delete({ webhookId: 'w' } as any)
        expect(d.calls[0].init.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
        const r = fakeFetch(ok([]))
        await client(r.fn).accounts.list()
        expect(r.calls[0].init.headers['idempotency-key']).toBeUndefined()
    })

    it('retries what is safe: reads and writes (each with its key) on 5xx and network errors, anything on 429, honoring Retry-After', async () => {
        const read = fakeFetch(fail(503, 'PROVIDER_UNAVAILABLE', { 'retry-after': '0.01' }), new TypeError('socket hang up'), ok([]))
        await client(read.fn).accounts.list()
        expect(read.calls).toHaveLength(3)

        // A write is repeated on a 503 with the same key, so the API does it once at most...
        const respond = fakeFetch(fail(503, 'PROVIDER_UNAVAILABLE', { 'retry-after': '0.01' }), ok({ id: 'e' }))
        await client(respond.fn).events.respond({ eventId: 'e', accountId: 'a', response: 'accepted' } as any)
        expect(respond.calls).toHaveLength(2)
        expect(respond.calls[1].init.headers['idempotency-key']).toBe(respond.calls[0].init.headers['idempotency-key'])
        // ...and on a 429, which means it was not done.
        const limited = fakeFetch(fail(429, 'RATE_LIMITED', { 'retry-after': '0.01' }), ok({ id: 'e' }))
        await client(limited.fn).events.respond({ eventId: 'e', accountId: 'a', response: 'accepted' } as any)
        expect(limited.calls).toHaveLength(2)

        // Out of retries: the API's error, with how long to wait.
        const busy = fakeFetch(fail(429, 'RATE_LIMITED', { 'retry-after': '0.01' }))
        const error = await client(busy.fn, { maxRetries: 1 }).accounts.list().catch((e) => e)
        expect(error).toBeInstanceOf(RateLimitError)
        expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfter: 0.01 })
        expect(busy.calls).toHaveLength(2)
    })

    it('turns the API\'s errors into typed exceptions with the code, hint, docs and trace id', async () => {
        const error = await client(fakeFetch(fail(404, 'CONNECTION_NOT_FOUND')).fn).accounts.get({ accountId: 'nope' }).catch((e) => e)
        expect(error).toBeInstanceOf(NotFoundError)
        expect(error).toBeInstanceOf(PyasError)
        expect(error).toMatchObject({
            code: 'CONNECTION_NOT_FOUND', status: 404, message: 'CONNECTION_NOT_FOUND happened', hint: 'Do this instead.',
            traceId: 'trc_err', docs: 'https://developer.pyas.io/errors/CONNECTION_NOT_FOUND',
        })
        const invalid = await client(fakeFetch(fail(400, 'VALIDATION_INVALID_BODY')).fn).events.create({ accountId: 'a' } as any).catch((e) => e)
        expect(invalid).toBeInstanceOf(ValidationError)
    })

    it('times out with a ConnectionError, and stops at once when you cancel', async () => {
        const slow = vi.fn((_url: string, init: any) => new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))))
        const error = await client(slow as any, { timeoutMs: 20, maxRetries: 0 }).accounts.list().catch((e) => e)
        expect(error).toBeInstanceOf(ConnectionError)
        expect(error.code).toBe('CONNECTION_TIMEOUT')
        const controller = new AbortController()
        const pending = client(slow as any, { timeoutMs: 10_000 }).accounts.list({}, { signal: controller.signal })
        controller.abort(new Error('stop'))
        await expect(pending).rejects.toThrow('stop')
    })

    it('pages: await gives one page, for await gives every item', async () => {
        const f = fakeFetch(
            ok([{ id: 'e1' }, { id: 'e2' }], { meta: { nextCursor: 'c2' } }),
            ok([{ id: 'e3' }], { meta: { nextCursor: null } }),
        )
        const pyas = client(f.fn)
        const page = await pyas.events.list({ accountId: 'a' })
        expect(page.data.map((e: any) => e.id)).toEqual(['e1', 'e2'])
        expect(page).toMatchObject({ nextCursor: 'c2', hasMore: true })
        const second = await page.next()
        expect(second!.data.map((e: any) => e.id)).toEqual(['e3'])
        expect(await second!.next()).toBeNull()
        expect(new URL(f.calls[1].url).searchParams.get('cursor')).toBe('c2')

        const g = fakeFetch(ok([{ id: 'a' }], { meta: { nextCursor: 'n' } }), ok([{ id: 'b' }, { id: 'c' }], { meta: { nextCursor: null } }))
        const all: string[] = []
        for await (const e of client(g.fn).events.list({ accountId: 'a' })) all.push((e as any).id)
        expect(all).toEqual(['a', 'b', 'c'])
    })

    it('downloads bytes; never follows a redirect (the API key stays with Pyas), handing back where the file is', async () => {
        const bytes = new Uint8Array([1, 2, 3])
        const f = fakeFetch(new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="agenda.pdf"' } }))
        const file = await client(f.fn).events.attachments.content({ eventId: 'e', attachmentId: 'att', accountId: 'a' })
        expect(new Uint8Array(file.data)).toEqual(bytes)
        expect(file).toMatchObject({ contentType: 'application/pdf', fileName: 'agenda.pdf' })
        expect(f.calls[0].init.redirect).toBe('manual')

        const moved = fakeFetch(new Response(null, { status: 303, headers: { location: 'https://drive.google.test/file/1' } }))
        const elsewhere = await client(moved.fn).events.attachments.content({ eventId: 'e', attachmentId: 'att', accountId: 'a' })
        expect((elsewhere as any).location).toBe('https://drive.google.test/file/1')
        expect(moved.calls).toHaveLength(1)
    })

    it('uploads a file as the body, with its type and length', async () => {
        const f = fakeFetch(ok({ id: 'att_1' }, { status: 201 }))
        await client(f.fn).events.attachments.upload({ eventId: 'e', accountId: 'a', name: 'notes.txt' }, new Blob(['hello'], { type: 'text/plain' }))
        const { url, init } = f.calls[0]
        expect(url).toBe('http://api.test/v2/events/e/attachments/file?accountId=a&name=notes.txt')
        expect(init.headers['content-type']).toBe('text/plain')
        expect(init.headers['content-length']).toBe('5')
    })

    it('listens to server-sent events until closed', async () => {
        const text = ': connected\n\nevent: webhook\nid: 1\ndata: {"type":"event.created"}\n\nevent: webhook\ndata: {"type":"event.updated"}\n\n'
        const f = fakeFetch(new Response(new Blob([text]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
        const stream = client(f.fn).webhooks.listen()
        const seen: string[] = []
        for await (const e of stream) seen.push(`${e.event}:${e.json<{ type: string }>().type}`)
        expect(seen).toEqual(['webhook:event.created', 'webhook:event.updated'])
        expect(f.calls[0].init.headers.accept).toBe('text/event-stream')
    })

    it('calls any operation by its id', async () => {
        const f = fakeFetch(ok({ testMode: true }))
        await client(f.fn).request('sandbox.get')
        expect(f.calls[0].url).toBe('http://api.test/v2/sandbox')
    })
})

describe('webhooks', () => {
    const secret = 'whsec_test'
    const body = JSON.stringify({ id: 'evt_1', type: 'event.created', data: { object: { id: 'e1' } } })

    it('verifies a delivery signed as Pyas signs it, and refuses anything else', async () => {
        const header = await signWebhookForTest(body, secret)
        expect(await verifyWebhook(header, body, secret)).toBe(true)
        expect(await verifyWebhook(header, `${body} `, secret)).toBe(false)
        expect(await verifyWebhook(header, body, 'whsec_other')).toBe(false)
        expect(await verifyWebhook(undefined, body, secret)).toBe(false)
        // Too old to trust.
        const old = await signWebhookForTest(body, secret, Math.floor(Date.now() / 1000) - 600)
        expect(await verifyWebhook(old, body, secret)).toBe(false)
        // A rotated secret: a v1 for each, and either verifies.
        const t = Math.floor(Date.now() / 1000)
        const both = `${await signWebhookForTest(body, 'whsec_new', t)},v1=${(await signWebhookForTest(body, secret, t)).split('v1=')[1]}`
        expect(await verifyWebhook(both, body, secret)).toBe(true)
        expect(await verifyWebhook(both, new TextEncoder().encode(body), 'whsec_new')).toBe(true)
    })

    it('constructs the event after checking it, from the client too', async () => {
        const pyas = client(fakeFetch(ok({})).fn)
        const header = await signWebhookForTest(body, secret)
        const event = await pyas.webhooks.constructEvent<{ object: { id: string } }>(body, header, secret)
        expect(event.data.object.id).toBe('e1')
        await expect(constructWebhookEvent(body, 't=1,v1=00', secret)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' })
    })
})

describe('connect.sessionHandler', () => {
    const made = (token = 'pcs_abc') => ok({ id: 'cs_1', status: 'pending', token, url: null }, { status: 201 })
    /** An Express-like response that records what it was told. */
    const expressRes = () => {
        const out: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} }
        const res = { setHeader: (k: string, v: string) => { out.headers[k] = v }, status: (code: number) => { out.status = code; return { json: (b: unknown) => { out.body = b } } } }
        return { res, out }
    }

    it('Express: makes a session for the signed-in user and answers its token, never cached', async () => {
        const f = fakeFetch(made())
        const handler = client(f.fn).connect.sessionHandler((req: { user?: { id: string } }) => req.user?.id)
        const { res, out } = expressRes()
        expect(await handler({ user: { id: 'user_42' } }, res)).toBeUndefined()
        expect(out).toEqual({ status: 200, body: { token: 'pcs_abc' }, headers: { 'cache-control': 'no-store' } })
        expect(f.calls[0].url).toBe('http://api.test/v2/connect/sessions')
        expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ subjectId: 'user_42' })
    })

    it('a Response when there is no res (Next.js, Hono, Bun), and the options a resolver returns go to the session', async () => {
        const f = fakeFetch(made('pcs_next'))
        const handler = client(f.fn).connect.sessionHandler(async () => ({ subjectId: 'user_7', providers: ['google'] as any }))
        const response = (await handler(new Request('http://app.test/pyas/session', { method: 'POST' })))!
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({ token: 'pcs_next' })
        expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ subjectId: 'user_7', providers: ['google'] })
    })

    it("Node's own http server", async () => {
        const f = fakeFetch(made())
        const written: { code?: number; headers?: Record<string, string>; body?: string } = {}
        const res = { writeHead: (code: number, headers: Record<string, string>) => { written.code = code; written.headers = headers }, end: (b: string) => { written.body = b } }
        await client(f.fn).connect.sessionHandler(() => 'user_1')({}, res)
        expect(written).toEqual({ code: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: '{"token":"pcs_abc"}' })
    })

    it('no function, or one that returns nothing: a session without a subjectId (a test page with no login works)', async () => {
        for (const handler of [client(fakeFetch(made()).fn).connect.sessionHandler(), client(fakeFetch(made()).fn).connect.sessionHandler(() => null)]) {
            const response = (await handler({}))!
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ token: 'pcs_abc' })
        }
        const fake = fakeFetch(made())
        await client(fake.fn).connect.sessionHandler()({})
        expect(JSON.parse(fake.calls[0].init.body as string)).toEqual({})
    })

    it("a resolver that throws: 500 without its details; Pyas's own error: its code and status, nothing more", async () => {
        const thrown = (await client(fakeFetch(made()).fn).connect.sessionHandler(() => { throw new Error('db password is hunter2') })({}))!
        expect(thrown.status).toBe(500)
        expect(await thrown.text()).not.toContain('hunter2')
        const refused = (await client(fakeFetch(fail(403, 'AUTH_SANDBOX_MISMATCH')).fn).connect.sessionHandler(() => 'u')({}))!
        expect(refused.status).toBe(403)
        expect(await refused.json()).toEqual({ error: { code: 'AUTH_SANDBOX_MISMATCH', message: 'AUTH_SANDBOX_MISMATCH happened' } })
        const down = (await client(fakeFetch(fail(503, 'PROVIDER_UNAVAILABLE')).fn, { maxRetries: 0 }).connect.sessionHandler(() => 'u')({}))!
        expect(down.status).toBe(502)
    })

    it('the sessions themselves are still there', () => {
        const pyas = client(fakeFetch(made()).fn)
        expect(typeof pyas.connect.sessions.create).toBe('function')
    })
})

describe('connecting an account without PyasConnect, from your server', () => {
    it('connect.oauth asks for the sign-in URL with the provider in the query; connect.accounts.create sends the code', async () => {
        const fake = fakeFetch(
            ok({ provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=app_id%3Dapp-1_rest%3Duser_42' }),
            ok({ accountId: 'acc_1', provider: 'google', email: 'a@b.test', name: 'A', subjectId: 'user_42', existing: false, grantedScopes: null }),
        )
        const pyas = client(fake.fn)
        const signIn = await pyas.connect.oauth({ provider: 'google', state: 'user_42' })
        expect(signIn.url).toContain('accounts.google.com')
        const askedFor = new URL(fake.calls[0].url)
        expect(askedFor.pathname).toBe('/v2/connect/oauth')
        expect(askedFor.searchParams.get('provider')).toBe('google')
        expect(askedFor.searchParams.get('state')).toBe('user_42')
        expect(fake.calls[0].init.method).toBe('GET')
        const account = await pyas.connect.accounts.create({ provider: 'google', code: 'c0de', subjectId: 'user_42' })
        expect(account.accountId).toBe('acc_1')
        expect(fake.calls[1].url).toBe('http://api.test/v2/connect/accounts')
        expect(JSON.parse(fake.calls[1].init.body as string)).toEqual({ provider: 'google', code: 'c0de', subjectId: 'user_42' })
        expect(fake.calls[1].init.headers['x-api-key']).toBe('pyas_sk_test_abc')
    })

    it("PyasConnect's own endpoints are not in the SDK", () => {
        const pyas = client(fakeFetch(ok({})).fn) as any
        expect(pyas.connect.authorize).toBeUndefined()
        expect(pyas.connect.complete).toBeUndefined()
    })
})
