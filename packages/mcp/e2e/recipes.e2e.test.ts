import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join, relative } from 'node:path'
import express from 'express'
import { signWebhookForTest } from '@pyas/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_URL, keys } from '../../sdk/e2e/target'

/**
 * The recipes' own files (recipes/), run against the real API as each platform runs them:
 * Supabase Edge Functions through Deno.serve (with Deno's two calls and Supabase's sign-in
 * stood in for), Next.js route handlers called with a Request, Express routes over HTTP.
 *
 * With a test key: the events and booking work on the sandbox's sample person, and a connect
 * session is made for the sandbox. With a live key: nobody signed in is told to sign in,
 * and a signed-in person gets a session. Webhooks: Pyas's signature is accepted, anything else
 * refused.
 */
const state = keys()
const RECIPES = join(__dirname, '..', 'recipes')
const WORK = join(__dirname, '.recipes-work')
const WEBHOOK_SECRET = 'whsec_recipes_e2e_0123456789abcdef'

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
})

/** A runtime's files copied to their own folder, with each file's text changed as a test needs it. */
const copyRecipe = (runtime: string, name: string, change: (path: string, text: string) => string = (_p, t) => t) => {
    const dir = join(WORK, name)
    cpSync(join(RECIPES, runtime), dir, { recursive: true, filter: (source) => !source.endsWith('tsconfig.json') })
    for (const path of walk(dir)) {
        if (!/\.(ts|tsx)$/.test(path)) continue
        writeFileSync(path, change(relative(dir, path).split('\\').join('/'), readFileSync(path, 'utf8').replace(/\r\n/g, '\n')))
    }
    return dir
}

const body = async (res: Response) => ({ status: res.status, json: await res.json() as any })

beforeAll(() => {
    rmSync(WORK, { recursive: true, force: true })
    mkdirSync(WORK, { recursive: true })
})
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

/* --------------------------- Supabase (Lovable, Bolt) --------------------------- */

const denoEnv: Record<string, string | undefined> = {}
const served: Record<string, (req: Request) => Promise<Response>> = {}
let serving = ''

describe('the Supabase recipe (Lovable, Bolt)', () => {
    beforeAll(() => {
        ;(globalThis as any).Deno = {
            env: { get: (name: string) => denoEnv[name] },
            serve: (handler: (req: Request) => Promise<Response>) => { served[serving] = handler },
        }
    })
    afterAll(() => { delete (globalThis as any).Deno })

    /** The functions of a copy, as Supabase starts them: each file once, its Deno.serve handler kept. */
    const functionsOf = async (copy: string, prefix: string) => {
        for (const fn of ['pyas-connect-session', 'pyas-events', 'pyas-book', 'pyas-webhooks']) {
            serving = `${prefix}/${fn}`
            await import(join(copy, 'supabase', 'functions', fn, 'index.ts'))
        }
        return (fn: string, init?: RequestInit) => served[`${prefix}/${fn}`](new Request(`https://ref.supabase.co/functions/v1/${fn}`, { method: 'POST', ...init }))
    }

    // npm: specifiers are Deno's; here the same packages from this repo, and Supabase's sign-in stood in for.
    const forNode = (path: string, text: string) => {
        const fake = relative(join(WORK, 'x', path, '..'), join(WORK, 'fake-supabase.ts')).split('\\').join('/')
        return text.replace(/npm:@pyas\/sdk@[^']+/g, '@pyas/sdk').replace('npm:@supabase/supabase-js@2', fake.startsWith('.') ? fake : `./${fake}`)
    }

    it('with a test key: events and booking on the sample person, a connect session for the sandbox', async () => {
        writeFileSync(join(WORK, 'fake-supabase.ts'), 'export const createClient = (_url: string, _key: string, opts: any) => ({ auth: { getUser: async () => ({ data: { user: opts.global.headers.Authorization === \'Bearer signed-in\' ? { id: \'recipe_user_1\' } : null } }) } })\n')
        Object.assign(denoEnv, { PYAS_API_KEY: state.testKey, PYAS_API_URL: API_URL, PYAS_WEBHOOK_SECRET: WEBHOOK_SECRET, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_ANON_KEY: 'anon' })
        const call = await functionsOf(copyRecipe('supabase', 'supabase-test', forNode), 'test')

        const preflight = await call('pyas-events', { method: 'OPTIONS' })
        expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')

        const events = await body(await call('pyas-events'))
        expect(events.status).toBe(200)
        expect(events.json.events.length).toBeGreaterThan(0)
        expect(Object.keys(events.json.events[0]).sort()).toEqual(['endsAt', 'id', 'isAllDay', 'provider', 'startsAt', 'title'])

        const booked = await body(await call('pyas-book', { body: JSON.stringify({ title: 'Recipe check (Supabase)' }) }))
        expect([201, 409]).toContain(booked.status)
        if (booked.status === 201) expect(booked.json.event.title).toBe('Recipe check (Supabase)')
        else expect(booked.json.error.code).toBe('NO_FREE_TIME')

        const session = await body(await call('pyas-connect-session'))
        expect(session.status).toBe(200)
        expect(session.json.token).toMatch(/^pcs_/)
    })

    it('with a live key: signed out is told to sign in; the signed-in Supabase user gets a session', async () => {
        Object.assign(denoEnv, { PYAS_API_KEY: state.apiKey })
        const call = await functionsOf(copyRecipe('supabase', 'supabase-live', forNode), 'live')
        const signedOut = await body(await call('pyas-connect-session'))
        expect(signedOut).toMatchObject({ status: 401, json: { error: { code: 'SIGN_IN_REQUIRED' } } })
        expect((await body(await call('pyas-connect-session', { headers: { Authorization: 'Bearer someone-else' } }))).status).toBe(401)
        const session = await body(await call('pyas-connect-session', { headers: { Authorization: 'Bearer signed-in' } }))
        expect(session.status).toBe(200)
        expect(session.json.token).toMatch(/^pcs_/)
    })

    it('webhooks: Pyas\'s signature is accepted; another body, another secret or none is refused', async () => {
        const call = (await functionsOf(copyRecipe('supabase', 'supabase-hooks', forNode), 'hooks'))
        const payload = JSON.stringify({ id: 'evt_recipe_1', type: 'event.created', data: {} })
        const ok = await body(await call('pyas-webhooks', { body: payload, headers: { 'pyas-signature': await signWebhookForTest(payload, WEBHOOK_SECRET) } }))
        expect(ok).toEqual({ status: 200, json: { received: true } })
        const tampered = await body(await call('pyas-webhooks', { body: payload.replace('created', 'deleted'), headers: { 'pyas-signature': await signWebhookForTest(payload, WEBHOOK_SECRET) } }))
        expect(tampered.json.error.code).toBe('WEBHOOK_SIGNATURE_INVALID')
        expect((await call('pyas-webhooks', { body: payload, headers: { 'pyas-signature': await signWebhookForTest(payload, 'whsec_other') } })).status).toBe(400)
        expect((await call('pyas-webhooks', { body: payload })).status).toBe(400)
    })
})

/* ------------------------------ Next.js (v0) ------------------------------ */

describe('the Next.js recipe (v0)', () => {
    const routesOf = async (copy: string) => {
        const route = (name: string) => import(join(copy, 'app', 'api', 'pyas', name, 'route.ts'))
        return { session: await route('connect-session'), events: await route('events'), book: await route('book'), webhooks: await route('webhooks') }
    }
    // The @/ alias is the project's; here, the copy's own lib/pyas.ts.
    const forNode = (signedIn: string | null) => (path: string, text: string) => {
        let out = text.replace("from '@/lib/pyas'", `from '${relative(join(WORK, 'x', path, '..'), join(WORK, 'x', 'lib', 'pyas')).split('\\').join('/')}'`)
        if (signedIn && path === 'lib/pyas.ts') out = out.replace('async function currentUserId(): Promise<string | null> {\n    return null', `async function currentUserId(): Promise<string | null> {\n    return '${signedIn}'`)
        return out
    }

    it('with a test key: events and booking on the sample person, a connect session for the sandbox', async () => {
        process.env.PYAS_API_KEY = state.testKey
        process.env.PYAS_API_URL = API_URL
        const routes = await routesOf(copyRecipe('nextjs', 'nextjs-test', forNode(null)))
        const events = await body(await routes.events.GET())
        expect(events.status).toBe(200)
        expect(events.json.events.length).toBeGreaterThan(0)
        const booked = await body(await routes.book.POST(new Request('http://app/api/pyas/book', { method: 'POST', body: JSON.stringify({ title: 'Recipe check (Next.js)' }) })))
        expect([201, 409]).toContain(booked.status)
        const session = await body(await routes.session.POST())
        expect(session).toMatchObject({ status: 200, json: { token: expect.stringMatching(/^pcs_/) } })
    })

    it('with a live key: signed out until currentUserId() is connected, then a session', async () => {
        process.env.PYAS_API_KEY = state.apiKey
        const signedOut = await routesOf(copyRecipe('nextjs', 'nextjs-live-out', forNode(null)))
        expect(await body(await signedOut.session.POST())).toMatchObject({ status: 401, json: { error: { code: 'SIGN_IN_REQUIRED' } } })
        expect((await signedOut.events.GET()).status).toBe(401)
        const signedIn = await routesOf(copyRecipe('nextjs', 'nextjs-live-in', forNode('recipe_user_2')))
        const session = await body(await signedIn.session.POST())
        expect(session.status).toBe(200)
        expect(session.json.token).toMatch(/^pcs_/)
    })

    it('webhooks: Pyas\'s signature is accepted, anything else refused', async () => {
        process.env.PYAS_WEBHOOK_SECRET = WEBHOOK_SECRET
        const routes = await routesOf(copyRecipe('nextjs', 'nextjs-hooks', forNode(null)))
        const payload = JSON.stringify({ id: 'evt_recipe_2', type: 'event.updated', data: {} })
        const post = async (signature: string | null, text = payload) => body(await routes.webhooks.POST(new Request('http://app/api/pyas/webhooks', { method: 'POST', body: text, headers: signature ? { 'pyas-signature': signature } : {} })))
        expect(await post(await signWebhookForTest(payload, WEBHOOK_SECRET))).toEqual({ status: 200, json: { received: true } })
        expect((await post(await signWebhookForTest(payload, WEBHOOK_SECRET), `${payload} `)).status).toBe(400)
        expect((await post(null)).status).toBe(400)
        delete process.env.PYAS_WEBHOOK_SECRET
        expect((await post(await signWebhookForTest(payload, WEBHOOK_SECRET))).json.error.code).toBe('NO_WEBHOOK_SECRET')
    })
})

/* ----------------------------- Express (Replit) ----------------------------- */

describe('the Express recipe (Replit, Express)', () => {
    /** The app as the steps say to mount it: the webhook route before express.json(). */
    const serve = async (copy: string) => {
        const route = (name: string) => import(join(copy, 'server', 'routes', `${name}.ts`))
        const app = express()
        app.use((await route('pyas-webhooks')).pyasWebhooks)
        app.use(express.json())
        app.use((await route('pyas-connect-session')).pyasConnectSession)
        app.use((await route('pyas-events')).pyasEvents)
        app.use((await route('pyas-book')).pyasBook)
        const server = app.listen(0)
        await new Promise((resolve) => server.once('listening', resolve))
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        return { call: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init), close: () => server.close() }
    }
    const signedInAs = (who: string | null) => (path: string, text: string) => (who && path === 'server/pyas.ts'
        ? text.replace('function currentUserId(_req: Request): string | null {\n    return null', `function currentUserId(_req: Request): string | null {\n    return '${who}'`)
        : text)

    it('with a test key: events and booking on the sample person, a connect session for the sandbox', async () => {
        process.env.PYAS_API_KEY = state.testKey
        process.env.PYAS_API_URL = API_URL
        const app = await serve(copyRecipe('express', 'express-test', signedInAs(null)))
        try {
            const events = await body(await app.call('/api/pyas/events'))
            expect(events.status).toBe(200)
            expect(events.json.events.length).toBeGreaterThan(0)
            const booked = await body(await app.call('/api/pyas/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Recipe check (Express)' }) }))
            expect([201, 409]).toContain(booked.status)
            if (booked.status === 201) expect(booked.json.event.title).toBe('Recipe check (Express)')
            expect(await body(await app.call('/api/pyas/connect-session', { method: 'POST' }))).toMatchObject({ status: 200, json: { token: expect.stringMatching(/^pcs_/) } })
        } finally {
            app.close()
        }
    })

    it('with a live key: signed out until currentUserId() is connected, then a session', async () => {
        process.env.PYAS_API_KEY = state.apiKey
        const out = await serve(copyRecipe('express', 'express-live-out', signedInAs(null)))
        const signedIn = await serve(copyRecipe('express', 'express-live-in', signedInAs('recipe_user_3')))
        try {
            expect((await out.call('/api/pyas/connect-session', { method: 'POST' })).status).toBe(401)
            const session = await body(await signedIn.call('/api/pyas/connect-session', { method: 'POST' }))
            expect(session.status).toBe(200)
            expect(session.json.token).toMatch(/^pcs_/)
        } finally {
            out.close()
            signedIn.close()
        }
    })

    it('webhooks, mounted before express.json(): Pyas\'s signature is accepted, anything else refused', async () => {
        process.env.PYAS_WEBHOOK_SECRET = WEBHOOK_SECRET
        const app = await serve(copyRecipe('express', 'express-hooks', signedInAs(null)))
        try {
            const payload = JSON.stringify({ id: 'evt_recipe_3', type: 'event.deleted', data: {} })
            const post = async (signature: string, text = payload) => body(await app.call('/api/pyas/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'pyas-signature': signature }, body: text }))
            expect(await post(await signWebhookForTest(payload, WEBHOOK_SECRET))).toEqual({ status: 200, json: { received: true } })
            expect((await post(await signWebhookForTest(payload, 'whsec_other'))).status).toBe(400)
        } finally {
            app.close()
            delete process.env.PYAS_WEBHOOK_SECRET
        }
    })
})

/* ------------------------ TanStack Start (Lovable) ------------------------ */

describe('the TanStack Start recipe (Lovable)', () => {
    // TanStack Start's two calls, stood in for: a server function is its handler, called with the
    // context Lovable's sign-in middleware would add; a server route is its POST handler.
    const forNode = (path: string, text: string) => {
        const fake = relative(join(WORK, 'x', path, '..'), join(WORK, 'fake-tanstack.ts')).split('\\').join('/')
        const to = fake.startsWith('.') ? fake : `./${fake}`
        return text.replace("from '@tanstack/react-start'", `from '${to}'`).replace("from '@tanstack/react-router'", `from '${to}'`)
    }
    const functionsOf = async (copy: string) => {
        const lib = (name: string) => import(join(copy, 'src', 'lib', `${name}.functions.ts`))
        const route = (await import(join(copy, 'src', 'routes', 'api', 'public', 'pyas-webhooks.ts'))).Route
        return {
            session: (await lib('pyas-connect')).getConnectSession,
            events: (await lib('pyas-events')).listEvents,
            book: (await lib('pyas-book')).bookMeeting,
            webhook: (init: RequestInit) => route.server.handlers.POST({ request: new Request('https://app.lovable.app/api/public/pyas-webhooks', { method: 'POST', ...init }) }) as Promise<Response>,
        }
    }

    beforeAll(() => {
        writeFileSync(join(WORK, 'fake-tanstack.ts'), [
            'export const createServerFn = (_options?: unknown) => ({ handler: (handler: any) => (opts: any = {}) => handler({ data: opts.data, context: opts.context ?? {} }) })',
            'export const createFileRoute = (_path: string) => (options: any) => options',
            '',
        ].join('\n'))
    })

    it('with a test key: events and booking on the sample person, a connect session for the sandbox', async () => {
        process.env.PYAS_API_KEY = state.testKey
        process.env.PYAS_API_URL = API_URL
        const fns = await functionsOf(copyRecipe('tanstack', 'tanstack-test', forNode))
        const events = await fns.events()
        expect(events.events.length).toBeGreaterThan(0)
        expect(Object.keys(events.events[0]).sort()).toEqual(['endsAt', 'id', 'isAllDay', 'provider', 'startsAt', 'title'])
        const booked = await fns.book()
        if ('event' in booked) expect(booked.event.title).toBe('Meeting')
        else expect(booked.error.code).toBe('NO_FREE_TIME')
        const session = await fns.session()
        expect(session).toMatchObject({ token: expect.stringMatching(/^pcs_/) })
    })

    it('with a live key: signed out is told to sign in; the signed-in person from the context gets a session', async () => {
        process.env.PYAS_API_KEY = state.apiKey
        const fns = await functionsOf(copyRecipe('tanstack', 'tanstack-live', forNode))
        expect(await fns.session()).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } })
        expect(await fns.events()).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } })
        const session = await fns.session({ context: { userId: 'recipe_user_4' } })
        expect(session.token).toMatch(/^pcs_/)
    })

    it("webhooks: Pyas's signature is accepted, anything else refused", async () => {
        process.env.PYAS_WEBHOOK_SECRET = WEBHOOK_SECRET
        const fns = await functionsOf(copyRecipe('tanstack', 'tanstack-hooks', forNode))
        const payload = JSON.stringify({ id: 'evt_recipe_4', type: 'event.created', data: {} })
        expect(await body(await fns.webhook({ body: payload, headers: { 'pyas-signature': await signWebhookForTest(payload, WEBHOOK_SECRET) } }))).toEqual({ status: 200, json: { received: true } })
        expect((await fns.webhook({ body: `${payload} `, headers: { 'pyas-signature': await signWebhookForTest(payload, WEBHOOK_SECRET) } })).status).toBe(400)
        expect((await fns.webhook({ body: payload })).status).toBe(400)
        delete process.env.PYAS_WEBHOOK_SECRET
        expect((await body(await fns.webhook({ body: payload }))).json.error.code).toBe('NO_WEBHOOK_SECRET')
    })
})

/* ------------------------------ Base44 ------------------------------ */

const base44Secrets: Record<string, string | undefined> = {}

describe('the Base44 recipe', () => {
    // Base44's runtime, stood in for: secrets.get reads the secrets above, and auth.me() knows one
    // signed-in person by their token, as Base44's sign-in does.
    const forNode = (path: string, text: string) => {
        const up = (file: string) => {
            const rel = relative(join(WORK, 'x', path, '..'), join(WORK, file)).split('\\').join('/')
            return rel.startsWith('.') ? rel : `./${rel}`
        }
        return text.replace(/npm:@pyas\/sdk@[^']+/g, '@pyas/sdk').replace('npm:@base44/sdk@0.8.54', up('fake-base44-sdk.ts')).replace("'base44:runtime'", `'${up('fake-base44-runtime.ts')}'`)
    }
    const functionsOf = async (copy: string) => {
        const fn = async (name: string) => (await import(join(copy, 'base44', 'functions', name, 'entry.ts'))).default as (req: Request) => Promise<Response>
        const handlers = { pyasConnectSession: await fn('pyasConnectSession'), pyasEvents: await fn('pyasEvents'), pyasBook: await fn('pyasBook'), pyasWebhooks: await fn('pyasWebhooks') }
        return (name: keyof typeof handlers, init?: RequestInit) => handlers[name](new Request(`https://app.base44.app/functions/${name}`, { method: 'POST', ...init }))
    }

    beforeAll(() => {
        ;(globalThis as any).__base44Secrets = base44Secrets
        writeFileSync(join(WORK, 'fake-base44-runtime.ts'), 'export const secrets = { get: (name: string) => (globalThis as any).__base44Secrets[name] }\n')
        writeFileSync(join(WORK, 'fake-base44-sdk.ts'), [
            'export const createClientFromRequest = (req: Request) => ({ auth: { me: async () => {',
            "    if (req.headers.get('Authorization') === 'Bearer signed-in') return { id: 'recipe_user_5', email: 'person@example.com' }",
            "    throw Object.assign(new Error('Unauthorized'), { status: 401 })",
            '} } })',
            '',
        ].join('\n'))
    })
    afterAll(() => { delete (globalThis as any).__base44Secrets })

    it('with a test key: events and booking on the sample person, a connect session for the sandbox', async () => {
        Object.assign(base44Secrets, { PYAS_API_KEY: state.testKey, PYAS_API_URL: API_URL })
        const call = await functionsOf(copyRecipe('base44', 'base44-test', forNode))
        const events = await body(await call('pyasEvents'))
        expect(events.status).toBe(200)
        expect(events.json.events.length).toBeGreaterThan(0)
        const booked = await body(await call('pyasBook', { body: JSON.stringify({ title: 'Recipe check (Base44)' }) }))
        expect([201, 409]).toContain(booked.status)
        if (booked.status === 201) expect(booked.json.event.title).toBe('Recipe check (Base44)')
        expect(await body(await call('pyasConnectSession'))).toMatchObject({ status: 200, json: { token: expect.stringMatching(/^pcs_/) } })
    })

    it('with a live key: signed out is told to sign in; the signed-in Base44 user gets a session; no key is a clear error', async () => {
        Object.assign(base44Secrets, { PYAS_API_KEY: state.apiKey })
        const call = await functionsOf(copyRecipe('base44', 'base44-live', forNode))
        expect(await body(await call('pyasConnectSession'))).toMatchObject({ status: 401, json: { error: { code: 'SIGN_IN_REQUIRED' } } })
        const session = await body(await call('pyasConnectSession', { headers: { Authorization: 'Bearer signed-in' } }))
        expect(session.status).toBe(200)
        expect(session.json.token).toMatch(/^pcs_/)
        delete base44Secrets.PYAS_API_KEY
        expect(await body(await call('pyasEvents'))).toMatchObject({ status: 500, json: { error: { code: 'NO_API_KEY' } } })
    })

    it("webhooks: Pyas's signature is accepted, anything else refused", async () => {
        base44Secrets.PYAS_WEBHOOK_SECRET = WEBHOOK_SECRET
        const call = await functionsOf(copyRecipe('base44', 'base44-hooks', forNode))
        const payload = JSON.stringify({ id: 'evt_recipe_5', type: 'event.updated', data: {} })
        expect(await body(await call('pyasWebhooks', { body: payload, headers: { 'pyas-signature': await signWebhookForTest(payload, WEBHOOK_SECRET) } }))).toEqual({ status: 200, json: { received: true } })
        expect((await call('pyasWebhooks', { body: payload, headers: { 'pyas-signature': await signWebhookForTest(payload, 'whsec_other') } })).status).toBe(400)
        expect((await call('pyasWebhooks', { body: payload })).status).toBe(400)
    })
})
