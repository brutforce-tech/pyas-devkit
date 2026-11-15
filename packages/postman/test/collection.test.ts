import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    BROWSER_ONLY, buildCollection, COLLECTION_NAME, isStreamRequest, operationIdsIn, operationsOf, runOrder, sandboxOutcome, scenariosOf,
} from '../src/collection'

const doc = JSON.parse(readFileSync(join(__dirname, '..', '..', 'sdk', 'openapi', 'v2.json'), 'utf8'))
const committed = JSON.parse(readFileSync(join(__dirname, '..', 'pyas-api-v2.postman_collection.json'), 'utf8'))
const collection = buildCollection(doc)

/** Every request in the collection, with the folder it is in. */
const requests = (items: any[], folder = ''): Array<{ folder: string; item: any }> =>
    items.flatMap((item) => (item.item ? requests(item.item, folder ? `${folder}/${item.name}` : item.name) : [{ folder, item }]))
const reference = requests(collection.item).filter((r) => !r.folder.startsWith('Scenarios'))
const scenarioRequests = requests(collection.item).filter((r) => r.folder.startsWith('Scenarios'))
const idOf = (item: any) => /Operation ID: `([^`]+)`/.exec(item.request.description)?.[1]
const testsOf = (item: any) => item.event.find((e: any) => e.listen === 'test').script.exec.join('\n')

describe('the Postman collection', () => {
    it('is the one the committed OpenAPI snapshot makes (npm run generate -w @pyas/postman)', () => {
        expect(committed).toEqual(JSON.parse(JSON.stringify(collection)))
    })

    it('is a v2.1 collection named "Pyas API v2"', () => {
        expect(collection.info.name).toBe(COLLECTION_NAME)
        expect(collection.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json')
    })

    it('has every operation once, but PyasConnect\'s browser-only ones, in a folder per tag', () => {
        const all = operationsOf(doc).map((o) => o.id).sort()
        const inDoc = Object.values(doc.paths).flatMap((item: any) => Object.values(item).map((op: any) => op.operationId)).filter(Boolean)
        expect(all.length).toBe(inDoc.length - BROWSER_ONLY.size)
        expect(reference.map((r) => idOf(r.item)).sort()).toEqual(all)
        expect(all.some((id) => BROWSER_ONLY.has(id))).toBe(false)
        for (const r of reference) {
            const op = operationsOf(doc).find((o) => o.id === idOf(r.item))!
            expect(r.folder).toBe(op.tag)
        }
        expect(collection.item.map((f: any) => f.name)).toEqual([...doc.tags.map((t: any) => t.name), 'Scenarios'])
    })

    it('sends the key once, from a secret collection variable, as x-api-key; no key is published', () => {
        expect(collection.auth).toEqual({
            type: 'apikey',
            apikey: [
                { key: 'key', value: 'x-api-key', type: 'string' },
                { key: 'value', value: '{{apiKey}}', type: 'string' },
                { key: 'in', value: 'header', type: 'string' },
            ],
        })
        expect(collection.variable.find((v: any) => v.key === 'apiKey')).toMatchObject({ value: '', type: 'secret' })
        expect(collection.variable.find((v: any) => v.key === 'baseUrl').value).toBe('https://api.pyas.io')
        expect(JSON.stringify(collection)).not.toMatch(/pyas_sk_(test_)?[A-Za-z0-9]{20}/)
        for (const { item } of requests(collection.item)) expect(item.request.auth).toBeUndefined()
    })

    it('fills each request with its example, the sandbox\'s names standing for its ids', () => {
        const get = reference.find((r) => idOf(r.item) === 'events.get')!.item.request
        expect(get.url.raw).toBe('{{baseUrl}}/v2/events/:eventId?accountId={{account.avery}}')
        expect(get.url.variable).toEqual([expect.objectContaining({ key: 'eventId', value: '{{event.avery.zoomcall}}' })])
        const create = reference.find((r) => idOf(r.item) === 'events.create')!.item.request
        expect(JSON.parse(create.body.raw)).toMatchObject({ accountId: '{{account.google}}', startsAt: '{{in.2d.15:00}}' })
        // Every query parameter is listed; only the example's are on.
        const list = reference.find((r) => idOf(r.item) === 'events.list')!.item.request
        expect(list.url.query.filter((q: any) => !q.disabled).map((q: any) => q.key)).toEqual(['accountId', 'from', 'to', 'expand'])
        expect(list.url.query.length).toBeGreaterThan(20)
    })

    it('makes an idempotency key per request on the writes that take one, and only those', () => {
        const idempotent = operationsOf(doc).filter((o) => (o.op.parameters ?? []).some((p: any) => p.in === 'header' && p.name === 'Idempotency-Key')).map((o) => o.id)
        expect(idempotent).toEqual(expect.arrayContaining(['events.create', 'events.import', 'events.quickAdd']))
        for (const { item } of requests(collection.item)) {
            const header = item.request.header.find((h: any) => h.key === 'Idempotency-Key')
            if (idempotent.includes(idOf(item)!)) expect(header).toMatchObject({ value: '{{idempotencyKey}}' })
            else expect(header).toBeUndefined()
        }
        expect(collection.event[0].script.exec.join('\n')).toContain("pm.variables.set('idempotencyKey'")
    })

    it('reads the sandbox once per key, and works out the relative dates', () => {
        const pre = collection.event.find((e: any) => e.listen === 'prerequest').script.exec.join('\n')
        expect(pre).toContain("'/v2/sandbox'")
        expect(pre).toContain("pm.collectionVariables.get('pyas.sandboxFor') !== key.slice(-8)")
        // The scripts are JavaScript Postman can run.
        for (const e of collection.event) expect(() => new Function('pm', e.script.exec.join('\n'))).not.toThrow()
        for (const { item } of requests(collection.item)) expect(() => new Function('pm', testsOf(item))).not.toThrow()

        // The date script, run as Postman would.
        const vars: Record<string, string> = {}
        const pm = {
            variables: { get: () => 'pyas_sk_live', set: (k: string, v: string) => { vars[k] = v }, replaceIn: (s: string) => (s === '{{$guid}}' ? 'a-guid' : s) },
            collectionVariables: { get: () => undefined },
            request: { toJSON: () => ({ body: '{"startsAt":"{{in.1d.14:00}}","from":"{{in.-7d}}"}' }), url: { variables: { each: () => undefined } } },
        }
        new Function('pm', 'console', pre)(pm, { warn: () => undefined })
        const tomorrow = new Date(Date.now() + 86_400_000)
        expect(vars['in.1d.14:00']).toBe(`${tomorrow.toISOString().slice(0, 10)}T14:00:00Z`)
        expect(vars['in.-7d']).toBe(`${new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`)
        expect(vars.idempotencyKey).toBe('a-guid')
    })

    it('tests every request: its status, and for the sandbox\'s known refusals, the error code', () => {
        const common = collection.event.find((e: any) => e.listen === 'test').script.exec.join('\n')
        expect(common).toContain('body.success')
        expect(common).toContain('body.traceId')
        expect(common).toContain("'/errors/' + body.error.code")
        for (const { item } of requests(collection.item)) expect(testsOf(item)).toMatch(/pm\.test\('Status is/)
        // The sandbox's outcomes, as the document says them (x-pyas-sandbox).
        const outcomes = operationsOf(doc).filter((o) => sandboxOutcome(o)).map((o) => [o.id, sandboxOutcome(o)!] as const)
        expect(outcomes.length).toBeGreaterThan(10)
        // Only the docs' Try it key gets these; an app's own test key gets the key (keys.get on current).
        expect(outcomes.map(([id]) => id)).not.toContain('keys.get')
        for (const [id, outcome] of outcomes) {
            const r = reference.find((x) => idOf(x.item) === id)
            expect(r, id).toBeDefined()
            expect(testsOf(r!.item)).toContain(`status(${outcome.status})`)
            if (outcome.code) expect(testsOf(r!.item)).toContain(`'${outcome.code}'`)
        }
        expect(testsOf(reference.find((r) => idOf(r.item) === 'events.get')!.item)).toContain('status(200)')
    })

    it('gives each request an example response from its schema', () => {
        const get = reference.find((r) => idOf(r.item) === 'events.get')!.item
        expect(get.response).toHaveLength(1)
        expect(get.response[0].code).toBe(200)
        expect(JSON.parse(get.response[0].body)).toMatchObject({ success: true, traceId: expect.any(String), data: expect.any(Object) })
    })

    it('has the reference\'s scenarios as folders, in order, each step keeping what the next needs', () => {
        const scenarios = scenariosOf(doc)
        expect(scenarios.length).toBeGreaterThanOrEqual(6)
        const folder = collection.item.find((f: any) => f.name === 'Scenarios')
        expect(folder.item[0].name).toBe('Start from a fresh sandbox')
        expect(folder.item.slice(1).map((f: any) => f.name)).toEqual(scenarios.map((s) => s.title))
        const book = folder.item.find((f: any) => f.name === 'Find a time when two people are free and book it')
        expect(book.item.map((i: any) => idOf(i))).toEqual(['meetingTimes.find', 'events.create', 'events.get'])
        expect(testsOf(book.item[0])).toContain("pm.collectionVariables.set('slot.startsAt'")
        expect(JSON.parse(book.item[1].request.body.raw).startsAt).toBe('{{slot.startsAt}}')
        expect(book.item[2].request.url.variable).toEqual([expect.objectContaining({ key: 'eventId', value: '{{booked.id}}' })])
        expect(scenarioRequests.length).toBe(1 + scenarios.reduce((n, s) => n + s.steps.length, 0))
        // Each step tests the status the document says it responds with (a real metadata import is accepted, 202).
        scenarios.forEach((sc, i) => sc.steps.forEach((st, j) => expect(testsOf(folder.item[i + 1].item[j]), `${sc.id} ${j + 1}`).toContain(`status(${st.status})`)))
        expect(scenarios.flatMap((sc) => sc.steps).some((st) => st.status === 202)).toBe(true)
    })

    it('says where webhooks go, since Postman cannot receive them', () => {
        expect(collection.info.description).toContain('npx @pyas/cli webhooks listen')
        expect(collection.info.description).toContain('POST /v2/webhooks/{webhookId}/test')
    })

    it('has no em dash anywhere', () => {
        expect(JSON.stringify(collection)).not.toContain(String.fromCharCode(0x2014))
    })
})

describe('reading the scenarios', () => {
    it('takes them from the document as data, and fails without them', () => {
        expect(scenariosOf(doc).every((sc) => sc.id && sc.steps.every((st) => st.operationId && st.status))).toBe(true)
        expect(() => scenariosOf({ ...doc, 'x-pyas-scenarios': undefined })).toThrow(/no x-pyas-scenarios/)
        expect(() => buildCollection({ ...doc, 'x-pyas-scenarios': [{ id: 'x', title: 'X', summary: '', steps: [{ title: 'A', operationId: 'nope.nope', status: 200 }] }] })).toThrow(/no operation nope\.nope/)
    })
})

describe('the run order', () => {
    const { collection: run, streams } = runOrder(collection)
    const ordered = run.item[0].item

    it('starts from a fresh sandbox, reads before it writes, and deletes the account last', () => {
        expect(idOf(ordered[0])).toBe('sandbox.reset')
        const methods = ordered.slice(1).map((i: any) => i.request.method)
        const rank: Record<string, number> = { GET: 0, POST: 1, PUT: 1, PATCH: 2, DELETE: 3 }
        expect(methods.map((m: string) => rank[m])).toEqual([...methods.map((m: string) => rank[m])].sort((a, b) => a - b))
        expect(idOf(ordered[ordered.length - 1])).toBe('accounts.delete')
        expect(run.item[1].name).toBe('Scenarios')
    })

    it('leaves out the streams, for the run to send itself, and loses nothing else', () => {
        expect(streams.map(idOf)).toEqual(['webhooks.listen'])
        expect(streams.every(isStreamRequest)).toBe(true)
        expect(new Set([...operationIdsIn(run), ...streams.map(idOf)])).toEqual(new Set(operationsOf(doc).map((o) => o.id)))
    })
})
