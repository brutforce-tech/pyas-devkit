import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, PermissionError, Pyas, ValidationError } from '../src'
import { API_URL, keys } from './target'

/**
 * The SDK against the real API and its sandbox, with a test key: what a developer's first
 * hour does, through the SDK.
 */
const state = keys()
const pyas = new Pyas({ apiKey: state.testKey, baseUrl: API_URL })
const day = 86_400_000
const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * day)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
}

let avery: string

describe('the SDK against the sandbox', () => {
    beforeAll(async () => {
        const sandbox = await pyas.sandbox.get()
        expect(sandbox).toBeTruthy()
        const people: Array<{ accountId: string; name: string | null }> = []
        for await (const account of pyas.accounts.list()) people.push(account)
        avery = people.find((p) => p.name === 'Avery Brooks')!.accountId
        expect(avery).toBeTruthy()
    })

    it('reads a week of events, a page at a time and all of them', async () => {
        const window = { accountId: avery, from: at(-1, 0), to: at(7, 0), expand: true }
        const page = await pyas.events.list({ ...window, limit: 2 })
        expect(page.data.length).toBeLessThanOrEqual(2)
        expect(page.response.traceId).toMatch(/^trc_/)
        const all: string[] = []
        for await (const event of pyas.events.list({ ...window, limit: 2 })) all.push(event.id)
        expect(all.length).toBeGreaterThan(2)
        expect(new Set(all).size).toBe(all.length)
    })

    it('creates, reads, changes and deletes an event; a stale version is refused', async () => {
        const created = await pyas.events.create({ accountId: avery, title: 'SDK check', startsAt: at(2, 15), endsAt: at(2, 16) })
        expect(created.title).toBe('SDK check')
        expect(Date.parse(created.startsAt)).toBe(Date.parse(at(2, 15)))
        const read = await pyas.events.get({ eventId: created.id, accountId: avery })
        expect(read.id).toBe(created.id)
        const moved = await pyas.events.update({ eventId: created.id, accountId: avery, title: 'SDK check, moved' }, { ifMatch: read.version! })
        expect(moved.title).toBe('SDK check, moved')
        // The version read before the change is stale now.
        const stale = await pyas.events.update({ eventId: created.id, accountId: avery, title: 'Lost update' }, { ifMatch: read.version! }).catch((e) => e)
        expect(stale).toBeInstanceOf(ConflictError)
        await pyas.events.delete({ eventId: created.id, accountId: avery })
        const gone = await pyas.events.get({ eventId: created.id, accountId: avery }).catch((e) => e)
        expect(gone).toBeInstanceOf(NotFoundError)
    })

    it('a create retried with the same idempotency key makes one event', async () => {
        const key = `sdk-e2e-${Date.now()}`
        const body = { accountId: avery, title: 'Booked once', startsAt: at(3, 10), endsAt: at(3, 11) }
        const first = await pyas.events.create(body, { idempotencyKey: key })
        const again = await pyas.events.create(body, { idempotencyKey: key })
        expect(again.id).toBe(first.id)
        const found: string[] = []
        for await (const e of pyas.events.list({ accountId: avery, from: at(3, 0), to: at(4, 0), q: 'Booked once' })) found.push(e.id)
        expect(found).toEqual([first.id])
    })

    it('finds busy time and meeting times', async () => {
        const busy = await pyas.freeBusy.query({ accountIds: [avery], from: at(1, 0), to: at(2, 0) })
        expect(busy).toBeTruthy()
        const slots = await pyas.meetingTimes.find({ attendees: [{ accountId: avery }], from: at(1, 0), to: at(3, 0), durationMinutes: 30 })
        expect(slots).toBeTruthy()
    })

    it('says what went wrong, in the API\'s words', async () => {
        const missing = await pyas.accounts.get({ accountId: 'acc_does_not_exist' }).catch((e) => e)
        expect(missing).toBeInstanceOf(NotFoundError)
        expect(missing).toMatchObject({ status: 404, code: expect.stringMatching(/NOT_FOUND/), traceId: expect.stringMatching(/^trc_/) })
        expect(missing.docs).toMatch(/\/errors\//)
        // Deliberately incomplete: no start or end.
        const invalid = await pyas.events.create({ accountId: avery, title: 'No times' } as any).catch((e) => e)
        expect(invalid).toBeInstanceOf(ValidationError)
        // A live key cannot touch the sandbox.
        const live = new Pyas({ apiKey: state.apiKey, baseUrl: API_URL })
        const mismatch = await live.sandbox.get().catch((e) => e)
        expect(mismatch).toBeInstanceOf(PermissionError)
        expect(mismatch.code).toBe('AUTH_SANDBOX_MISMATCH')
    })

    it('manages a webhook endpoint and its signing secret', async () => {
        const created = await pyas.webhooks.create({ url: 'https://hooks.example.test/pyas', events: ['event.created'] })
        expect(created.endpoint.url).toBe('https://hooks.example.test/pyas')
        expect(created.signingSecret).toMatch(/^whsec_/)
        const secret = await pyas.webhooks.secret.get({ webhookId: created.endpoint.webhookId })
        expect(secret.signingSecret).toBe(created.signingSecret)
        const listed = (await pyas.webhooks.list()).map((w) => w.url)
        expect(listed).toContain('https://hooks.example.test/pyas')
    })

    it('is generated from the API as it is: the committed OpenAPI snapshot matches the running API', async () => {
        const live = await (await fetch(`${API_URL}/v2/openapi.json`)).json()
        const snapshot = JSON.parse(readFileSync(new URL('../openapi/v2.json', import.meta.url), 'utf8'))
        // Paths and schemas; the servers list names whichever API answered.
        expect({ paths: live.paths, components: live.components }, 'The API changed: npm run openapi:pull && npm run generate').toEqual({ paths: snapshot.paths, components: snapshot.components })
    })
})
