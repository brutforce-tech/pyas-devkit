import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Pyas } from '@pyas/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keys as settingsKeys } from '../../packages/sdk/e2e/target'
import { API_URL, localPackages, sh, start, type App } from './harness'

/**
 * The AI chat template as a developer gets it, against the real API's sandbox: scaffolded with
 * `pyas init`, installed, built and started. The approval card's lookup runs on the sandbox's
 * events. With OPENAI_API_KEY set, a real model also chats: it reads without asking, and a
 * booking stops for approval.
 */
const ROOT = resolve(__dirname, '..', '..')
const PORT = 3105
const MODEL_KEY = process.env.OPENAI_API_KEY

describe('the nextjs-ai-chat template against the sandbox', () => {
    let app: App
    let keys: { apiKey: string; testKey: string }
    const pyas = () => new Pyas({ apiKey: keys.testKey, baseUrl: API_URL })
    const describeChange = async (tool: string, input: Record<string, unknown>) => {
        const res = await fetch(`${app.url}/api/pyas-change`, { method: 'POST', body: JSON.stringify({ tool, input }) })
        expect(res.status).toBe(200)
        return res.json() as Promise<any>
    }
    /** One turn of the chat, as useChat sends it: the stream the page reads, as text. */
    const chat = async (text: string) => {
        const res = await fetch(`${app.url}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] }),
        })
        expect(res.status).toBe(200)
        return res.text()
    }

    beforeAll(async () => {
        keys = settingsKeys()
        const work = mkdtempSync(join(tmpdir(), 'pyas-nextjs-ai-chat-'))
        const dir = join(work, 'app')
        const init = JSON.parse(sh(`node "${join(ROOT, 'packages', 'cli', 'dist', 'cli.js')}" init --template nextjs-ai-chat "${dir}" --json`, work, { PYAS_API_KEY: keys.testKey, PYAS_API_URL: API_URL, PYAS_CONFIG: join(work, 'config.json') }))
        expect(init).toMatchObject({ template: 'nextjs-ai-chat', envFile: '.env.local', keyWritten: expect.stringMatching(/^pyas_sk_test_/) })

        const local = localPackages(work, { connect: true, aiTools: true })
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        for (const name of Object.keys(pkg.dependencies)) if (local[name]) pkg.dependencies[name] = `file:${local[name]}`
        // The React wrapper depends on the element and the core at its own version: the same tarballs.
        pkg.dependencies['@pyas/connect'] = `file:${local['@pyas/connect']}`
        pkg.dependencies['@pyas/connect-core'] = `file:${local['@pyas/connect-core']}`
        writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
        sh('npm install --no-audit --no-fund --loglevel=error', dir)
        const env = { PYAS_API_KEY: keys.testKey, PYAS_API_URL: API_URL, ...(MODEL_KEY ? { OPENAI_API_KEY: MODEL_KEY } : {}) }
        sh('npm run build', dir, env)
        app = await start('npm start', dir, PORT, env)
    }, 900_000)

    afterAll(() => app?.stop())

    it('serves the chat page', async () => {
        const res = await fetch(app.url)
        expect(res.status).toBe(200)
        const html = await res.text()
        expect(html).toContain('Calendar assistant')
        expect(html).toContain('Ask about your calendar')
    })

    it("the approval card reads the event from Pyas, and titles the change by what it does", async () => {
        const accounts = (await pyas().accounts.list({ subjectId: 'sandbox_user_1' })).data.filter((a) => a.provider !== 'zoom')
        const now = Date.now()
        const events = await pyas().events.list({ accountId: accounts[0].accountId, from: new Date(now).toISOString(), to: new Date(now + 7 * 86_400_000).toISOString(), limit: 5 })
        const event = events.data[0]
        const deleting = await describeChange('delete_event', { accountId: accounts[0].accountId, eventId: event.id })
        expect(deleting).toMatchObject({ ok: true, title: 'Delete an event', event: { id: event.id, title: event.title } })
        const moving = await describeChange('update_event', { accountId: accounts[0].accountId, eventId: event.id, startsAt: event.startsAt, endsAt: event.endsAt })
        expect(moving).toMatchObject({ ok: true, title: 'Move an event' })
    })

    it("opens on the signed-in person's calendars", async () => {
        const html = await (await fetch(app.url)).text()
        expect(html).toContain('avery.brooks@example.com')
        expect(html).not.toContain('Connect your calendar')
    })

    it('makes a connect session for the signed-in person, with a test key', async () => {
        const res = await fetch(`${app.url}/api/pyas/connect-session`, { method: 'POST' })
        expect(res.status).toBe(200)
        expect((await res.json()).token).toMatch(/^pcs_/)
    })

    it("disconnects the person's own calendar, and refuses someone else's", async () => {
        const disconnect = (accountId: string) => fetch(`${app.url}/api/pyas/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })
        const theirs = (await pyas().accounts.list({ subjectId: 'sandbox_user_2' })).data[0]
        const refused = await disconnect(theirs.accountId)
        expect(refused.status).toBe(404)
        expect((await pyas().accounts.get({ accountId: theirs.accountId })).accountId).toBe(theirs.accountId)
        // Positive control: a calendar of the signed-in person's own goes.
        const own = await pyas().accounts.createVirtual({ provider: 'pyas', name: 'Template check', subjectId: 'sandbox_user_1' })
        expect((await disconnect(own.accountId)).status).toBe(204)
        const left = (await pyas().accounts.list({ subjectId: 'sandbox_user_1' })).data.map((account) => account.accountId)
        expect(left).not.toContain(own.accountId)
    })

    it("sets the person's own calendar as their default, and refuses someone else's", async () => {
        const setDefault = (accountId: string) => fetch(`${app.url}/api/default-calendar`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) })
        const theirs = (await pyas().accounts.list({ subjectId: 'sandbox_user_2' })).data[0]
        const refused = await setDefault(theirs.accountId)
        expect(refused.status).toBe(404)
        expect(refused.headers.get('set-cookie')).toBeNull()
        // Positive control: one of the signed-in person's own.
        const own = (await pyas().accounts.list({ subjectId: 'sandbox_user_1' })).data.find((account) => account.provider !== 'zoom')!
        const set = await setDefault(own.accountId)
        expect(set.status).toBe(204)
        expect(set.headers.get('set-cookie')).toContain(`default_calendar=${own.accountId}`)
    })

    it("a change to another person's calendar is refused before anyone is asked", async () => {
        const theirs = (await pyas().accounts.list({ subjectId: 'sandbox_user_2' })).data[0]
        const refused = await describeChange('delete_event', { accountId: theirs.accountId, eventId: 'evt_any' })
        expect(refused).toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED' } })
    })

    it.skipIf(!MODEL_KEY)('with a real model: reading runs without asking, and a booking stops for approval', async () => {
        const reading = await chat("What's on my calendar tomorrow?")
        expect(reading).toMatch(/"toolName":"(list_events|list_accounts)"/)
        expect(reading).not.toContain('tool-approval-request')
        const booking = await chat('Book a 30 minute meeting called Template check tomorrow afternoon when I am free.')
        expect(booking).toContain('tool-approval-request')
        expect(booking).toContain('"toolName":"create_event"')
    }, 180_000)
})
