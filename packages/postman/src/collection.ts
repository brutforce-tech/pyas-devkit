/**
 * The Postman collection (format v2.1), built from the API's OpenAPI document
 * (the SDK's committed snapshot, packages/sdk/openapi/v2.json), never edited by hand:
 *
 *   - every operation but PyasConnect's browser-only ones, in a folder per tag as in the
 *     docs' reference, each with its description, its example and an example response;
 *   - the key once, as the collection's `apiKey` secret variable, sent as `x-api-key`;
 *   - a collection pre-request script that reads GET /v2/sandbox once per key and keeps the
 *     sandbox's ids under the examples' own names (`{{account.avery}}`), works out the
 *     examples' relative dates (`{{in.1d.14:00}}`), and makes an idempotency key per request;
 *   - the scenarios of the reference's introduction, as folders that run in order, each step
 *     keeping what the next one needs;
 *   - tests on every request: its status, the envelope, and on an error its code and docs link.
 *
 * The same object, the same way, on every run: CI regenerates it and fails on any difference.
 */

type Json = Record<string, any>

export const COLLECTION_NAME = 'Pyas API v2'
/** Fixed, so the file is the same on every run (Postman gives a published copy its own uid). */
export const COLLECTION_ID = '5b0e6b8a-2f63-4c1e-9a57-0b7c2a6f3d10'
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const PUBLIC_API = 'https://api.pyas.io'
const DOCS = 'https://developer.pyas.io'

/** The browser's half of a connect session: PyasConnect makes these requests, never a server. */
export const BROWSER_ONLY = new Set(['connect.authorize', 'connect.complete', 'connect.info', 'connect.go'])

/**
 * What an example gets in a sandbox when it is not the operation's success (the requests that
 * need a live key, or an id only a live key makes): the document says it per operation, as
 * `x-pyas-sandbox`. An outcome with `key: 'docs'` holds only
 * for the docs' Try it key; the app's own test key, as in Postman, gets the success.
 */
export const sandboxOutcome = (o: Operation): { status: number; code?: string } | undefined => {
    const outcome = o.op['x-pyas-sandbox']
    return outcome && outcome.key !== 'docs' ? outcome : undefined
}

/** A file for the operations that upload one (the document has no example for a raw body). */
const SAMPLE_FILE = 'Notes for the budget review.'

const METHOD_ORDER: Record<string, number> = { GET: 0, POST: 1, PUT: 1, PATCH: 2, DELETE: 3 }

export interface Operation {
    id: string
    method: string
    /** OpenAPI form: `/v2/events/{eventId}`. */
    path: string
    tag: string
    op: Json
    /** Its success statuses, lowest first. */
    successes: number[]
}

export const operationsOf = (doc: Json): Operation[] => {
    const out: Operation[] = []
    for (const [path, item] of Object.entries(doc.paths as Json)) {
        for (const [method, op] of Object.entries(item as Json)) {
            if (!op?.operationId || BROWSER_ONLY.has(op.operationId)) continue
            const successes = Object.keys(op.responses ?? {}).map(Number).filter((s) => s >= 200 && s < 400).sort((a, b) => a - b)
            out.push({ id: op.operationId, method: method.toUpperCase(), path, tag: op.tags?.[0] ?? 'Other', op, successes })
        }
    }
    return out
}

/* ------------------------------- Scripts ------------------------------- */

/**
 * Before every request: the sandbox's ids (read once per key), the relative dates the
 * request uses, its path's ids encoded, and a fresh idempotency key. Plain ES2020: Postman's sandbox runs it.
 */
const PRE_REQUEST = `// Pyas: fills the examples' names with your sandbox's IDs, and their dates.
const prepare = () => {
    // {{in.1d}} is tomorrow at 00:00 UTC, {{in.1d.14:00}} tomorrow at 14:00 UTC, {{in.-7d}} a week ago.
    const names = JSON.stringify(pm.request.toJSON()).match(/\\{\\{in\\.-?\\d+d(\\.\\d{2}:\\d{2})?\\}\\}/g) || [];
    names.forEach((placeholder) => {
        const name = placeholder.slice(2, -2);
        const m = /^in\\.(-?\\d+)d(?:\\.(\\d{2}):(\\d{2}))?$/.exec(name);
        const day = new Date();
        day.setUTCHours(Number(m[2] || 0), Number(m[3] || 0), 0, 0);
        day.setUTCDate(day.getUTCDate() + Number(m[1]));
        pm.variables.set(name, day.toISOString().replace('.000Z', 'Z'));
    });
    // IDs in the path are encoded: a Google calendar ID can hold # or @.
    pm.request.url.variables.each((v) => {
        const value = pm.variables.replaceIn(String(v.value || ''));
        if (/\\{\\{/.test(value)) return;
        try { v.value = encodeURIComponent(decodeURIComponent(value)); } catch (e) { v.value = encodeURIComponent(value); }
    });
    // A new idempotency key for each request that sends one: sending it again never creates twice.
    pm.variables.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'));
};

const key = pm.variables.get('apiKey') || '';
if (!key) console.warn('Pyas: set the apiKey variable of this collection to a test key (pyas_sk_test_...).');
if (key.startsWith('pyas_sk_test_') && pm.collectionVariables.get('pyas.sandboxFor') !== key.slice(-8)) {
    // Once per key: GET /v2/sandbox lists the IDs the examples name, such as account.avery.
    pm.sendRequest({
        url: pm.variables.replaceIn('{{baseUrl}}') + '/v2/sandbox',
        method: 'GET',
        header: { 'x-api-key': key, accept: 'application/json' },
    }, (error, response) => {
        if (error || response.code !== 200) {
            console.error('Pyas: could not read GET /v2/sandbox', error || response.code);
        } else {
            const examples = response.json().data.examples || {};
            Object.keys(examples).forEach((name) => pm.collectionVariables.set(name, examples[name]));
            pm.collectionVariables.set('pyas.sandboxFor', key.slice(-8));
        }
        prepare();
    });
} else {
    prepare();
}`

/** After every request: what every v2 response has in common. */
const TESTS = `// Pyas: every v2 response carries a trace ID, and JSON responses use the v2 envelope.
pm.test('The response has a trace ID', () => pm.expect(pm.response.headers.get('X-Trace-Id')).to.be.a('string').and.not.empty);
const type = pm.response.headers.get('Content-Type') || '';
if (type.includes('application/json')) {
    const body = pm.response.json();
    if (pm.response.code < 400) {
        pm.test('The response has success and traceId', () => {
            pm.expect(body.success).to.equal(true);
            pm.expect(body.traceId).to.be.a('string').and.not.empty;
        });
    } else {
        pm.test('The error has a code, a hint, a trace ID and a link to its docs', () => {
            pm.expect(body.success).to.equal(false);
            pm.expect(body.error.code).to.match(/^[A-Z][A-Z0-9_]+$/);
            pm.expect(body.error.hint).to.be.a('string');
            pm.expect(body.error.traceId).to.be.a('string').and.not.empty;
            pm.expect(body.error.docs).to.match(new RegExp('/errors/' + body.error.code + '$'));
        });
    }
}`

const statusTest = (statuses: number[], code?: string) => {
    const lines = [statuses.length === 1
        ? `pm.test('Status is ${statuses[0]}', () => pm.response.to.have.status(${statuses[0]}));`
        : `pm.test('Status is ${statuses.join(' or ')}', () => pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(statuses)}));`]
    if (code) lines.push(`pm.test('Error code is ${code}', () => pm.expect(pm.response.json().error.code).to.equal('${code}'));`)
    return lines
}

const captureTest = (captures: Record<string, string>) => [
    'const body = pm.response.json();',
    ...Object.entries(captures).map(([name, at]) => [
        `const ${varName(name)} = ${JSON.stringify(at.split('.'))}.reduce((v, k) => (v == null ? v : v[k]), body);`,
        `pm.test('Keeps ${at} as {{${name}}}', () => pm.expect(${varName(name)}).to.be.a('string').and.not.empty);`,
        `pm.collectionVariables.set('${name}', ${varName(name)});`,
    ].join('\n')),
]

const varName = (name: string) => `kept_${name.replace(/[^A-Za-z0-9]/g, '_')}`

const script = (listen: 'prerequest' | 'test', lines: string[]) => ({ listen, script: { type: 'text/javascript', exec: lines.join('\n').split('\n') } })

/* --------------------------- Example responses --------------------------- */

/**
 * An illustrative value for a schema: its own example, else a plain one for its type. The
 * document has no recorded responses, so each request's example response is built from
 * the response schema (Postman's importer does the same).
 */
const sample = (doc: Json, schema: Json | undefined, depth = 0): unknown => {
    if (!schema || depth > 8) return null
    if (schema.$ref) return sample(doc, doc.components.schemas[String(schema.$ref).split('/').pop()!], depth + 1)
    if ('const' in schema) return schema.const
    if (schema.examples?.length) return schema.examples[0]
    if (schema.example !== undefined) return schema.example
    if (schema.default !== undefined) return schema.default
    if (schema.enum?.length) return schema.enum[0]
    const options = schema.anyOf ?? schema.oneOf
    if (options) return sample(doc, options.find((o: Json) => o.type !== 'null') ?? options[0], depth + 1)
    if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: Json) => sample(doc, s, depth + 1)))
    const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') ?? 'null' : schema.type
    switch (type) {
        case 'object': {
            const out: Json = {}
            for (const [k, v] of Object.entries((schema.properties ?? {}) as Json)) out[k] = sample(doc, v, depth + 1)
            return out
        }
        case 'array': return schema.items ? [sample(doc, schema.items, depth + 1)] : []
        case 'string': return schema.format === 'date-time' ? '2026-03-15T14:00:00Z' : schema.format === 'uri' ? 'https://example.com' : 'string'
        case 'integer': return 0
        case 'number': return 0
        case 'boolean': return true
        case 'null': return null
        default: return schema.properties ? sample(doc, { ...schema, type: 'object' }, depth) : null
    }
}

const exampleResponse = (doc: Json, o: Operation, request: Json): Json | null => {
    const status = o.successes[0]
    const content = o.op.responses?.[status]?.content?.['application/json']
    if (!content) return null
    const body = sample(doc, content.schema) as Json
    if (body && typeof body === 'object' && 'traceId' in body) body.traceId = 'trc_0123456789abcdef01234567'
    return {
        name: 'Example response',
        originalRequest: { method: request.method, url: request.url.raw },
        status: o.op.responses[status].description ?? 'OK',
        code: status,
        _postman_previewlanguage: 'json',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Trace-Id', value: 'trc_0123456789abcdef01234567' }],
        body: JSON.stringify(body, null, 2),
    }
}

/* ------------------------------- Requests ------------------------------- */

interface RequestInput {
    pathValues?: Record<string, string>
    query?: Array<{ key: string; value: string; description?: string; disabled?: boolean }>
    body?: unknown
}

const isStream = (o: Operation) => o.successes.some((s) => o.op.responses[s]?.content?.['text/event-stream'])

/** The request object of an operation, with the values given. */
const requestFor = (o: Operation, input: RequestInput): Json => {
    const params: Json[] = o.op.parameters ?? []
    const segments = o.path.split('/').filter(Boolean).map((s) => s.replace(/^\{(.+)\}$/, ':$1'))
    const query = input.query ?? []
    const raw = `{{baseUrl}}/${segments.join('/')}${query.filter((q) => !q.disabled).length ? `?${query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`
    const header: Json[] = []
    for (const p of params.filter((x) => x.in === 'header')) {
        if (p.name === 'Idempotency-Key') header.push({ key: 'Idempotency-Key', value: '{{idempotencyKey}}', description: `${p.description ?? ''} Made for each request by the collection's pre-request script.`.trim() })
        else header.push({ key: p.name, value: '', description: p.description ?? '', disabled: true })
    }
    // A stream (the webhook relay) stays open: it is asked for as one.
    if (isStream(o)) header.push({ key: 'Accept', value: 'text/event-stream' })
    const request: Json = { method: o.method, header, url: { raw, host: ['{{baseUrl}}'], path: segments } }
    if (query.length) request.url.query = query
    const pathParams = params.filter((p) => p.in === 'path')
    if (pathParams.length) request.url.variable = pathParams.map((p) => ({ key: p.name, value: input.pathValues?.[p.name] ?? '', ...(p.description ? { description: p.description } : {}) }))
    const content = o.op.requestBody?.content ?? {}
    if (content['application/json']) {
        header.push({ key: 'Content-Type', value: 'application/json' })
        request.body = { mode: 'raw', raw: JSON.stringify(input.body ?? {}, null, 2), options: { raw: { language: 'json' } } }
    } else if (Object.keys(content).length) {
        header.push({ key: 'Content-Type', value: Object.keys(content)[0] })
        request.body = { mode: 'raw', raw: SAMPLE_FILE }
    }
    return request
}

const descriptionOf = (o: Operation, outcome?: { status: number; code?: string }) => [
    o.op.description ?? o.op.summary,
    `\`${o.method} ${o.path}\``,
    outcome ? `**Test:** in a sandbox, this example gets ${outcome.status}${outcome.code ? ` \`${outcome.code}\`` : ''}.` : null,
    `Operation ID: \`${o.id}\``,
].filter(Boolean).join('\n\n')

/** One operation, filled with its example from the document. */
const referenceItem = (doc: Json, o: Operation): Json => {
    const params: Json[] = o.op.parameters ?? []
    const pathValues = Object.fromEntries(params.filter((p) => p.in === 'path').map((p) => [p.name, p.example === undefined ? '' : String(p.example)]))
    // Every query parameter is listed; those the example uses are on.
    const query = params.filter((p) => p.in === 'query').map((p) => ({
        key: p.name,
        value: p.example === undefined ? '' : String(p.example),
        ...(p.description ? { description: p.description } : {}),
        ...(p.example === undefined ? { disabled: true } : {}),
    }))
    const body = o.op.requestBody?.content?.['application/json']?.example
    const request = requestFor(o, { pathValues, query, body })
    const outcome = sandboxOutcome(o)
    request.description = descriptionOf(o, outcome)
    const response = exampleResponse(doc, o, request)
    return {
        name: o.op.summary ?? o.id,
        event: [script('test', outcome ? statusTest([outcome.status], outcome.code) : statusTest([o.successes[0]]))],
        // A file kept elsewhere is answered with a redirect: the redirect is the response.
        ...(o.id === 'events.attachments.content' ? { protocolProfileBehavior: { followRedirects: false } } : {}),
        request,
        response: response ? [response] : [],
    }
}

/* ------------------------------- Scenarios ------------------------------- */

export interface ScenarioStep {
    title: string
    operationId: string
    params?: Record<string, string>
    query?: Record<string, string>
    body?: unknown
    /** The status the step responds with. */
    status: number
    /** Values to keep for later steps, by name, from paths in the response such as `data.id`. */
    capture?: Record<string, string>
}

export interface Scenario {
    id: string
    title: string
    summary: string
    steps: ScenarioStep[]
}

/** The scenarios, as the document gives them (`x-pyas-scenarios`). */
export const scenariosOf = (doc: Json): Scenario[] => {
    const scenarios = doc['x-pyas-scenarios']
    if (!Array.isArray(scenarios) || !scenarios.length) throw new Error('The OpenAPI document has no x-pyas-scenarios.')
    return scenarios
}

const scenarioFolder = (operations: Operation[], s: Scenario): Json => ({
    name: s.title,
    description: s.summary,
    item: s.steps.map((step, i) => {
        const o = operations.find((x) => x.id === step.operationId)
        if (!o) throw new Error(`Scenario ${s.id}, step ${i + 1}: no operation ${step.operationId}.`)
        const query = Object.entries(step.query ?? {}).map(([key, value]) => ({ key, value }))
        const request = requestFor(o, { pathValues: step.params ?? {}, query, body: step.body })
        request.description = [o.op.summary ? `${o.op.summary}.` : null, `\`${o.method} ${o.path}\``, `Operation ID: \`${o.id}\``].filter(Boolean).join('\n\n')
        const tests = [...statusTest([step.status])]
        if (step.capture && Object.keys(step.capture).length) tests.push(...captureTest(step.capture))
        return { name: `${i + 1}. ${step.title}`, event: [script('test', tests)], request, response: [] }
    }),
})

/* ------------------------------- Collection ------------------------------- */

const intro = (scenarioCount: number) => `The [Pyas](https://pyas.io) API v2: Google Calendar, Microsoft Outlook, Zoom and virtual calendars through one API. Generated from the API's OpenAPI document, and tested against the API before each release.

## Start in your sandbox

1. Fork this collection.
2. In the collection's **Variables**, paste a test key (\`pyas_sk_test_...\`, from your app's API keys in the Pyas dashboard) into \`apiKey\`.
3. Send any request.

A test key reaches your app's sandbox only: people with calendars and a week of events, and simulated Google, Outlook and Zoom accounts. Nothing touches a real calendar. Pyas never publishes a key, so the variable is empty until you fill it, and it is a secret variable.

The examples name the sandbox's data instead of its IDs: \`{{account.avery}}\` is Avery Brooks's account, \`{{event.avery.design}}\` the Design Review on her calendar. Before your first request, the collection's pre-request script reads \`GET /v2/sandbox\` and stores your sandbox's IDs under those names. \`{{in.1d.14:00}}\` is tomorrow at 14:00 UTC, and \`{{in.-7d}}\` a week ago, worked out before each request.

Every request sends your key once, from the collection, as the \`x-api-key\` header. Every request that creates, changes or deletes something gets a new \`Idempotency-Key\`, so a request resent by mistake never makes the change twice.

## What is here

- **A folder per resource,** as in the [API reference](${DOCS}/reference): every operation, with its description and an example you can send as it is. PyasConnect's requests from the browser are left out, as in the reference's Try it.
- **Scenarios,** ${scenarioCount} common jobs step by step. Run a scenario's folder with the Collection Runner: each step keeps what the next one needs, such as \`{{slot.startsAt}}\`. The first request of the Scenarios folder resets your sandbox.
- **Tests on every request:** the status, the response's \`success\` and \`traceId\`, and for an error its code and a link to its documentation. Run the collection as a smoke test of your own sandbox.

Some examples change the sandbox (one deletes an account, another the sandbox inbox). \`POST /v2/sandbox/reset\`, in the Sandbox folder, puts it back as new.

## Webhooks

Postman can't receive webhooks. To see them while you develop, run \`npx @pyas/cli webhooks listen --forward http://localhost:3000/webhooks\` (the Pyas CLI): it relays your sandbox's events to your own handler, signed as in production. \`POST /v2/webhooks/{webhookId}/test\` sends a sample delivery to an endpoint, and the sandbox inbox (\`{{webhook.inbox}}\`) records every event your sandbox sends.

## More

- Docs: ${DOCS}
- Errors: every error links to its page, such as ${DOCS}/errors/RESOURCE_NOT_FOUND
- The Node.js SDK: \`npm install @pyas/sdk\``

export const buildCollection = (doc: Json): Json => {
    const operations = operationsOf(doc)
    const tags: string[] = (doc.tags ?? []).map((t: Json) => t.name)
    for (const o of operations) if (!tags.includes(o.tag)) tags.push(o.tag)
    const tagDescriptions = Object.fromEntries((doc.tags ?? []).map((t: Json) => [t.name, t.description]))
    const byMethodThenPath = (a: Operation, b: Operation) => METHOD_ORDER[a.method] - METHOD_ORDER[b.method] || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)

    const folders = tags.map((tag) => ({
        name: tag,
        ...(tagDescriptions[tag] ? { description: tagDescriptions[tag] } : {}),
        item: operations.filter((o) => o.tag === tag).sort(byMethodThenPath).map((o) => referenceItem(doc, o)),
    })).filter((f) => f.item.length)

    const scenarios = scenariosOf(doc)
    const reset = operations.find((o) => o.id === 'sandbox.reset')
    if (!reset) throw new Error('The document has no sandbox.reset operation, which the scenarios start from.')
    const resetItem = {
        name: 'Start from a fresh sandbox',
        event: [script('test', statusTest(reset.successes))],
        request: { ...requestFor(reset, {}), description: 'Resets your sandbox, so the scenarios start from its sample data.\n\nOperation ID: `sandbox.reset`' },
        response: [],
    }

    return {
        info: {
            _postman_id: COLLECTION_ID,
            name: COLLECTION_NAME,
            description: intro(scenarios.length),
            schema: SCHEMA,
        },
        auth: {
            type: 'apikey',
            apikey: [
                { key: 'key', value: 'x-api-key', type: 'string' },
                { key: 'value', value: '{{apiKey}}', type: 'string' },
                { key: 'in', value: 'header', type: 'string' },
            ],
        },
        event: [
            script('prerequest', PRE_REQUEST.split('\n')),
            script('test', TESTS.split('\n')),
        ],
        variable: [
            { key: 'baseUrl', value: PUBLIC_API, type: 'string', description: 'The API. Every request goes here.' },
            { key: 'apiKey', value: '', type: 'secret', description: 'Your test key (pyas_sk_test_...): it reaches your sandbox only.' },
        ],
        item: [
            ...folders,
            { name: 'Scenarios', description: 'Common jobs step by step. Run one scenario\'s folder with the Collection Runner: the steps run in order, each keeping what the next one needs. Start with "Start from a fresh sandbox".', item: [resetItem, ...scenarios.map((s) => scenarioFolder(operations, s))] },
        ],
    }
}

/** The operation id of every request in a collection (from each request's description). */
export const operationIdsIn = (collection: Json): string[] => {
    const ids: string[] = []
    const walk = (items: Json[]) => {
        for (const item of items) {
            if (item.item) walk(item.item)
            const m = /Operation ID: `([^`]+)`/.exec(String(item.request?.description ?? ''))
            if (m) ids.push(m[1])
        }
    }
    walk(collection.item ?? [])
    return ids
}

/** Whether a request is a stream that stays open (sent with Accept: text/event-stream). */
export const isStreamRequest = (item: Json) => (item.request?.header ?? []).some((h: Json) => h.key === 'Accept' && h.value === 'text/event-stream')

/**
 * The collection as one run: a fresh sandbox, then every reference request in an order that
 * leaves each the data it needs (reads, then creates, then changes, then deletes, the account
 * last, as the API's own test of its examples does), then the scenarios from a fresh sandbox.
 *
 * Streams are left out (`streams`): a runner waits for a response to end, and a stream does not.
 * The run against the API sends them itself.
 */
export const runOrder = (collection: Json): { collection: Json; streams: Json[] } => {
    const reference: Json[] = []
    let scenarios: Json | null = null
    for (const folder of collection.item as Json[]) {
        if (folder.name === 'Scenarios') scenarios = folder
        else reference.push(...folder.item)
    }
    const idOf = (item: Json) => /Operation ID: `([^`]+)`/.exec(String(item.request?.description ?? ''))?.[1] ?? ''
    const last = (item: Json) => (idOf(item) === 'accounts.delete' ? 1 : 0)
    const sorted = reference
        .filter((item) => !isStreamRequest(item))
        .map((item, i) => ({ item, i }))
        .sort((a, b) => METHOD_ORDER[a.item.request.method] - METHOD_ORDER[b.item.request.method] || last(a.item) - last(b.item) || a.i - b.i)
        .map(({ item }) => item)
    const fresh = scenarios?.item?.[0]
    return {
        collection: { ...collection, item: [{ name: 'Reference', item: [...(fresh ? [fresh] : []), ...sorted] }, ...(scenarios ? [scenarios] : [])] },
        streams: reference.filter(isStreamRequest),
    }
}
