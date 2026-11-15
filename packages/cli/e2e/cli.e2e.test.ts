import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pyas, verifyWebhook } from '@pyas/sdk'
import { beforeAll, describe, expect, it } from 'vitest'
import { API_URL, keys } from '../../sdk/e2e/target'

/**
 * The CLI as a person or a coding agent runs it: a real process, against the real API's sandbox
 * (the SDK suite's setup starts it), with its config in a folder of its own.
 */
const state = keys()
const TSX = createRequire(import.meta.url).resolve('tsx/cli')
const CLI = join(__dirname, '..', 'src', 'cli.ts')
const CONFIG = join(mkdtempSync(join(tmpdir(), 'pyas-cli-')), 'config.json')
const baseEnv = { ...process.env, PYAS_CONFIG: CONFIG, PYAS_API_URL: API_URL, PYAS_API_KEY: '' }

const pyas = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [TSX, CLI, ...args], { env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 60_000 })
    const json = (() => { try { return JSON.parse(r.stdout) } catch { return null } })()
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
}
const withKey = { PYAS_API_KEY: '' }

const day = 86_400_000
const at = (days: number, hour: number) => { const d = new Date(Date.now() + days * day); d.setUTCHours(hour, 0, 0, 0); return d.toISOString() }

let avery: string
let riley: string

describe('the CLI against the sandbox', () => {
    beforeAll(() => {
        // Saved once, as a person would: everything after uses the saved key.
        const login = pyas(['login', '--key', state.testKey, '--json'])
        expect(login.code).toBe(0)
        expect(login.json).toMatchObject({ mode: 'test', saved: CONFIG })
        expect(readFileSync(CONFIG, 'utf8')).toContain(state.testKey)
        const accounts = pyas(['accounts', 'list', '--json'])
        avery = accounts.json.find((a: any) => a.name === 'Avery Brooks').accountId
        riley = accounts.json.find((a: any) => a.name === 'Riley Chen').accountId
    })

    it('says which key and API it uses, and refuses what is not a key', () => {
        const status = pyas(['status', '--json'])
        expect(status.code).toBe(0)
        expect(status.json).toMatchObject({ api: API_URL, mode: 'test', from: CONFIG })
        expect(status.json.key).not.toContain(state.testKey.slice(15))
        expect(pyas(['login', '--key', 'nope']).code).toBe(2)
        // The environment wins over the saved key.
        expect(pyas(['status', '--json'], { PYAS_API_KEY: state.apiKey }).json).toMatchObject({ mode: 'live', from: 'PYAS_API_KEY' })
    })

    it('says whether a calendar works, and lists every one that needs fixing', () => {
        const one = pyas(['accounts', 'status', avery])
        expect(one.code).toBe(0)
        expect(one.stdout).toContain('Health  healthy')
        expect(one.stdout).not.toContain('[object Object]')
        expect(pyas(['accounts', 'status', avery, '--json']).json.overall).toEqual({ status: 'healthy', reason: null, fix: null })
        // A new sandbox's accounts all work.
        const all = pyas(['accounts', 'status', '--needs-attention'])
        expect(all.code).toBe(0)
        expect(all.stdout.trim()).toBe('Every account is healthy.')
        expect(pyas(['accounts', 'status', '--needs-attention', '--json']).json).toEqual([])
        expect(pyas(['accounts', 'status', avery, '--needs-attention']).code).toBe(2)
    })

    it('creates an event, finds it, and deletes it (asking first, unless --yes)', () => {
        const made = pyas(['events', 'create', '--account', avery, '--title', 'From the CLI', '--start', at(2, 14), '--duration', '45', '--attendee', 'riley@example.test', '--json'])
        expect(made.code).toBe(0)
        expect(made.json).toMatchObject({ title: 'From the CLI' })
        const listed = pyas(['events', 'list', '--account', avery, '--from', at(2, 0), '--days', '1', '--json'])
        expect(listed.json.map((e: any) => e.id)).toContain(made.json.id)
        const human = pyas(['events', 'list', '--account', avery, '--from', at(2, 0), '--days', '1'])
        expect(human.stdout).toMatch(/EVENT\s+STARTS\s+LENGTH\s+TITLE/)
        expect(human.stdout).toContain('From the CLI')
        // No terminal and no --yes: it will not delete.
        const unsure = pyas(['events', 'delete', made.json.id, '--account', avery])
        expect(unsure.code).toBe(2)
        expect(pyas(['events', 'delete', made.json.id, '--account', avery, '--yes', '--json']).json).toEqual({ deleted: made.json.id })
    })

    it('finds times two people are free', () => {
        // A week, so the window always holds working days, whatever day the suite runs on.
        const times = pyas(['times', '--accounts', `${avery},${riley}`, '--duration', '30', '--from', at(1, 0), '--days', '7', '--json'])
        expect(times.code).toBe(0)
        expect(times.json.length).toBeGreaterThan(0)
    })

    it('explains errors, exits 1 with the API\'s error, and finds the failed request by its trace id', async () => {
        const explained = pyas(['errors', 'explain', 'connection_not_found', '--json'])
        expect(explained.json).toMatchObject({ code: 'CONNECTION_NOT_FOUND', fix: expect.any(String) })
        expect(pyas(['errors', 'explain', 'NOT_A_CODE']).code).toBe(2)

        const failed = pyas(['events', 'get', 'evt_nope', '--account', avery, '--json'])
        expect(failed.code).toBe(1)
        expect(failed.json.error).toMatchObject({ code: expect.stringMatching(/NOT_FOUND/), traceId: expect.stringMatching(/^trc_/), hint: expect.any(String) })
        const human = pyas(['events', 'get', 'evt_nope', '--account', avery])
        expect(human.stderr).toMatch(/Trace id: trc_\w+ \(pyas logs get trc_\w+\)/)

        // Logs are written every few seconds.
        let log: any = null
        for (let i = 0; i < 20 && log?.code !== 0; i++) {
            log = pyas(['logs', 'get', failed.json.error.traceId, '--json'])
            if (log.code !== 0) await new Promise((r) => setTimeout(r, 500))
        }
        expect(log.json).toMatchObject({ traceId: failed.json.error.traceId, status: 404 })
    })

    it('calls any operation by its id; tells a wrong command from a refused one', () => {
        expect(pyas(['request', 'sandbox.get', '--json']).code).toBe(0)
        expect(pyas(['request', 'accounts.get', '--params', '{"accountId":"nope"}', '--json']).code).toBe(1)
        expect(pyas(['frobnicate']).stderr).toContain('Unknown command: frobnicate')
        expect(pyas(['events', 'list', '--nope']).code).toBe(2)
        expect(pyas(['--version', '--json']).json).toMatchObject({ cli: expect.any(String), sdk: expect.any(String) })
    })

    it('forwards the sandbox\'s webhook events to a local handler, signed as in production', async () => {
        const received: Array<{ headers: IncomingMessage['headers']; body: string }> = []
        const handler = createServer((req, res) => {
            let body = ''
            req.on('data', (c) => { body += c })
            req.on('end', () => { received.push({ headers: req.headers, body }); res.writeHead(200).end() })
        })
        await new Promise<void>((r) => handler.listen(0, r))
        const port = (handler.address() as { port: number }).port

        const listen = spawn(process.execPath, [TSX, CLI, 'webhooks', 'listen', '--forward', `http://localhost:${port}/webhooks`, '--events', 'event.*', '--json'], { env: baseEnv })
        let out = ''
        listen.stdout.on('data', (c) => { out += c })
        try {
            // The stream opens with this session's signing secret.
            const until = Date.now() + 30_000
            while (!out.includes('"type":"ready"') && Date.now() < until) await new Promise((r) => setTimeout(r, 200))
            const secret = JSON.parse(out.split('\n').find((l) => l.includes('"type":"ready"'))!).signingSecret as string
            expect(secret).toMatch(/^whsec_/)

            const created = await new Pyas({ apiKey: state.testKey, baseUrl: API_URL }).events.create({ accountId: avery, title: 'Relayed', startsAt: at(3, 9), endsAt: at(3, 10) })
            const deadline = Date.now() + 30_000
            while (!received.some((r) => r.body.includes(created.id)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
            const delivery = received.find((r) => r.body.includes(created.id))!
            if (!delivery) throw new Error(`No delivery. CLI said:
${out}
Handler got ${received.length}`)
            expect(delivery.headers['pyas-event-type']).toBe('event.created')
            expect(await verifyWebhook(String(delivery.headers['pyas-signature']), delivery.body, secret)).toBe(true)
            // And says so, as a line an agent can read.
            const forwarded = out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.type === 'forwarded' && l.eventType === 'event.created')
            expect(forwarded).toMatchObject({ status: 200 })
        } finally {
            listen.kill()
            handler.close()
        }
    })

    it('forgets the key on logout', () => {
        expect(pyas(['logout', '--json']).code).toBe(0)
        const none = pyas(['status'], withKey)
        expect(none.code).toBe(2)
        expect(none.stderr).toContain('No API key')
    })
})
