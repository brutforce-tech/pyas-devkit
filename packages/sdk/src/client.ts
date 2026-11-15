/**
 * The Pyas client: one object, the whole API as resources.
 *
 *   const pyas = new Pyas({ apiKey: process.env.PYAS_API_KEY })
 *   const events = await pyas.events.list({ accountId, from, to })
 *
 * Every call: the API key in `x-api-key`, a timeout, the API's errors as typed exceptions,
 * and retries where they are safe (reads, deletes, and creates that take an idempotency key,
 * which the SDK sends for you), waiting as long as the API's Retry-After says.
 */
import { ConnectionError, errorFor, PyasError } from './errors'
import { OPERATIONS, type OperationId, type OperationSpec, type Resources } from './generated/operations'
import type {
    BinaryInput, BinaryResult, Page, PagePromise, RequestOptions, ResponseMeta, ServerSentEvent, ServerSentEventStream,
} from './types'
import { constructWebhookEvent, verifyWebhook, type VerifyOptions, type WebhookEvent } from './webhooks'
import { sessionHandler, type SessionResolver } from './connectSession'
import { MANAGE_OPERATIONS, type ManageOperationId, type ManageResources } from './manage'

export const VERSION = '1.0.0'
const DEFAULT_BASE_URL = 'https://api.pyas.io'

export interface PyasOptions {
    /** A `pyas_sk_...` key. Default: the PYAS_API_KEY environment variable. A test key reaches the sandbox only. */
    apiKey?: string
    /**
     * Instead of a key: a person's access token from signing in to Pyas (`pyas login`, or a tool
     * connected to Pyas), for `pyas.manage`. A function is called before each request, so it can
     * refresh the token.
     */
    accessToken?: string | (() => string | Promise<string>)
    /** Default: PYAS_API_URL, else https://api.pyas.io. */
    baseUrl?: string
    /** Each request's timeout in milliseconds (default 30 000). */
    timeoutMs?: number
    /** Retries for a call that is safe to repeat (default 2). */
    maxRetries?: number
    /** Your own fetch (a proxy, a test double). Default: the global fetch. */
    fetch?: typeof fetch
    /** Added to the User-Agent, e.g. "my-app/1.4". */
    appInfo?: string
}

const env = (name: string): string | undefined =>
    typeof process !== 'undefined' && process.env ? process.env[name] : undefined

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Safe to send again: it changes nothing twice. */
const repeatable = (spec: OperationSpec) => spec.method === 'GET' || spec.method === 'PUT' || spec.method === 'DELETE' || spec.idempotent

/** The data object, with how it was answered alongside (not enumerable, so it never serializes). */
const withResponse = <T>(data: T, response: ResponseMeta): T => {
    if (data && typeof data === 'object') Object.defineProperty(data, 'lastResponse', { value: response, enumerable: false, configurable: true })
    return data
}

interface Prepared {
    url: string
    method: string
    headers: Record<string, string>
    body?: BodyInit
}

export interface Pyas extends Resources {
    /** An app's setup (/v2/manage): with a person's access token, or read-only with an API key. */
    manage: ManageResources
    /** Connect sessions, and your backend's endpoint for PyasConnect. */
    connect: Resources['connect'] & {
        /**
         * An endpoint that makes a connect session with your API key and answers `{ token }`, for
         * PyasConnect's `getSessionToken`. Optionally, `resolve` returns your id for the user (the
         * account's `subjectId`) or the session's options. Pass `(req, res)` from Express or Node's
         * http server; with `req` alone it returns a Response.
         */
        sessionHandler<Req = any>(resolve?: SessionResolver<Req>): (req: Req, res?: unknown) => Promise<Response | undefined>
    }
    /** The API's webhook endpoints, and verifying the deliveries they receive. */
    webhooks: Resources['webhooks'] & {
        /** True when a delivery's Pyas-Signature header verifies for its raw body and your endpoint's secret. */
        verify(header: string | null | undefined, rawBody: string | Uint8Array | ArrayBuffer, secret: string, opts?: VerifyOptions): Promise<boolean>
        /** The delivery's event, after checking its signature (throws when it does not verify). */
        constructEvent<T = unknown>(rawBody: string | Uint8Array | ArrayBuffer, header: string | null | undefined, secret: string, opts?: VerifyOptions): Promise<WebhookEvent<T>>
    }
}

export class Pyas {
    readonly baseUrl: string
    readonly timeoutMs: number
    readonly maxRetries: number
    /** Whether the key is a test key (the sandbox). False with an access token. */
    readonly testMode: boolean
    readonly #apiKey: string | null
    readonly #accessToken: PyasOptions['accessToken'] | null
    readonly #fetch: typeof fetch
    readonly #userAgent: string

    constructor(options: PyasOptions = {}) {
        const accessToken = options.apiKey ? null : options.accessToken ?? null
        const apiKey = accessToken ? null : options.apiKey ?? env('PYAS_API_KEY') ?? null
        if (!apiKey && !accessToken) {
            throw new PyasError({
                code: 'AUTH_MISSING_API_KEY',
                status: 0,
                message: 'No API key: pass { apiKey } or set PYAS_API_KEY.',
                hint: 'Create one in your Pyas dashboard, under your app, API keys. A test key (pyas_sk_test_...) works against the sandbox.',
            })
        }
        this.#apiKey = apiKey
        this.#accessToken = accessToken
        this.baseUrl = (options.baseUrl ?? env('PYAS_API_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
        this.timeoutMs = options.timeoutMs ?? 30_000
        this.maxRetries = options.maxRetries ?? 2
        this.testMode = !!apiKey?.startsWith('pyas_sk_test_')
        const f = options.fetch ?? globalThis.fetch
        if (!f) throw new Error('No fetch available: use Node 20 or later, or pass { fetch }.')
        this.#fetch = f.bind(globalThis)
        this.#userAgent = `pyas-sdk-node/${VERSION}${options.appInfo ? ` ${options.appInfo}` : ''}`
        Object.assign(this, this.#resources())
        Object.assign(this.webhooks, {
            verify: verifyWebhook,
            constructEvent: constructWebhookEvent,
        })
        Object.assign(this.connect, {
            sessionHandler: (resolve?: SessionResolver<any>) => sessionHandler((params) => this.connect.sessions.create(params), resolve),
        })
    }

    /** Any operation by its id, for one the resources do not cover yet: `pyas.request('events.list', {...})`. */
    request<K extends OperationId | ManageOperationId>(id: K, params?: Record<string, unknown>, options?: RequestOptions, file?: BinaryInput): Promise<unknown> | PagePromise<unknown> | ServerSentEventStream {
        const spec = ((OPERATIONS as Record<string, OperationSpec>)[id] ?? (MANAGE_OPERATIONS as Record<string, OperationSpec>)[id]) as OperationSpec
        if (!spec) throw new TypeError(`Unknown operation: ${String(id)}`)
        if (spec.result === 'paged') return this.#paged(id, spec, params ?? {}, options ?? {})
        if (spec.result === 'stream') return this.#stream(id, spec, params ?? {}, options ?? {})
        return this.#call(id, spec, params ?? {}, options ?? {}, file)
    }

    #resources(): Record<string, unknown> {
        const root: Record<string, any> = {}
        const all = { ...OPERATIONS, ...MANAGE_OPERATIONS } as Record<OperationId | ManageOperationId, OperationSpec>
        for (const id of Object.keys(all) as Array<OperationId | ManageOperationId>) {
            const parts = id.split('.')
            let node = root
            for (const part of parts.slice(0, -1)) node = node[part] ??= {}
            const spec = all[id]
            node[parts[parts.length - 1]] = spec.body === 'binary'
                ? (params: Record<string, unknown>, file: BinaryInput, options?: RequestOptions) => this.request(id, params, options, file)
                : (params?: Record<string, unknown>, options?: RequestOptions) => this.request(id, params, options)
        }
        return root
    }

    #prepare(id: string, spec: OperationSpec, params: Record<string, unknown>, options: RequestOptions, file?: BinaryInput): Prepared {
        const rest: Record<string, unknown> = { ...params }
        let path = spec.path
        for (const name of spec.pathParams) {
            const value = rest[name]
            if (value === undefined || value === null || value === '') throw new TypeError(`${id} needs ${name}`)
            path = path.replace(`{${name}}`, encodeURIComponent(String(value)))
            delete rest[name]
        }
        const url = new URL(`${this.baseUrl}${path}`)
        for (const name of spec.query) {
            const value = rest[name]
            delete rest[name]
            if (value === undefined || value === null) continue
            url.searchParams.set(name, Array.isArray(value) ? value.join(',') : String(value))
        }
        // events.list: events by your own keys, as metadata.<key>=<value>.
        if (id === 'events.list' && rest.metadata && typeof rest.metadata === 'object') {
            for (const [k, v] of Object.entries(rest.metadata as Record<string, unknown>)) url.searchParams.set(`metadata.${k}`, String(v))
            delete rest.metadata
        }
        // The key or token is added as each attempt is sent (#send): a token may be refreshed in between.
        const headers: Record<string, string> = {
            accept: spec.result === 'binary' ? '*/*' : spec.result === 'stream' ? 'text/event-stream' : 'application/json',
            'user-agent': this.#userAgent,
            ...(options.headers ?? {}),
        }
        if (spec.idempotent) headers['idempotency-key'] = options.idempotencyKey ?? newIdempotencyKey()
        if (options.ifMatch !== undefined) {
            if (!spec.ifMatch) throw new TypeError(`${id} does not take ifMatch`)
            headers['if-match'] = options.ifMatch
        }
        let body: BodyInit | undefined
        if (spec.body === 'json') {
            headers['content-type'] = 'application/json'
            body = JSON.stringify(rest)
        } else {
            const unknown = Object.keys(rest).filter((k) => rest[k] !== undefined)
            if (unknown.length) throw new TypeError(`Unknown parameter${unknown.length > 1 ? 's' : ''} for ${id}: ${unknown.join(', ')}`)
            if (spec.body === 'binary') {
                if (file === undefined) throw new TypeError(`${id} needs the file to upload`)
                headers['content-type'] = (file instanceof Blob && file.type) || String(params.contentType ?? 'application/octet-stream')
                if (file instanceof Blob) headers['content-length'] = String(file.size)
                else if (file instanceof ArrayBuffer || file instanceof Uint8Array) headers['content-length'] = String(file.byteLength)
                body = file as BodyInit
            }
        }
        return { url: url.toString(), method: spec.method, headers, body }
    }

    /** Sends it, retrying what is safe to retry; answers the Response of the last attempt. */
    async #send(spec: OperationSpec, prepared: Prepared, options: RequestOptions): Promise<Response> {
        const retries = options.maxRetries ?? this.maxRetries
        const timeoutMs = options.timeoutMs ?? this.timeoutMs
        // A streamed body cannot be sent twice.
        const resendable = !(prepared.body instanceof ReadableStream)
        for (let attempt = 0; ; attempt++) {
            // Cancelled already (a paged call starts when awaited): its abort event has fired.
            if (options.signal?.aborted) throw options.signal.reason
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)
            const onAbort = () => controller.abort(options.signal?.reason)
            options.signal?.addEventListener('abort', onAbort, { once: true })
            let res: Response | null = null
            let failure: unknown = null
            try {
                res = await this.#fetch(prepared.url, {
                    method: prepared.method,
                    headers: { ...prepared.headers, ...(await this.#credentials()) },
                    body: prepared.body,
                    signal: controller.signal,
                    // Never follow a redirect: the API key would go with it (an attachment's 303 points elsewhere).
                    redirect: 'manual',
                    ...(prepared.body instanceof ReadableStream ? { duplex: 'half' } : {}),
                } as RequestInit)
            } catch (error) {
                failure = error
            } finally {
                clearTimeout(timer)
                options.signal?.removeEventListener('abort', onAbort)
            }
            if (options.signal?.aborted) throw options.signal.reason
            const status = res?.status ?? 0
            // 429 means it was not done; the others are only retried when doing it twice changes nothing.
            const retryable = status === 429 || ((failure !== null || status === 502 || status === 503 || status === 504) && repeatable(spec))
            if (retryable && resendable && attempt < retries) {
                const after = Number(res?.headers.get('retry-after'))
                const wait = Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : Math.min(8000, 500 * 2 ** attempt) * (0.75 + Math.random() / 2)
                // Let the unread answer go without waiting on it.
                void res?.body?.cancel().catch(() => undefined)
                await sleep(wait, options.signal)
                continue
            }
            if (failure !== null) {
                const timedOut = failure instanceof DOMException && failure.name === 'TimeoutError' || (failure as Error)?.name === 'TimeoutError'
                throw new ConnectionError({
                    code: timedOut ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED',
                    status: 0,
                    message: timedOut ? `No answer from ${this.baseUrl} within ${timeoutMs} ms.` : `Could not reach ${this.baseUrl}: ${(failure as Error)?.message ?? failure}`,
                    hint: timedOut ? 'Raise timeoutMs for a slow provider, or retry.' : 'Check the network, and baseUrl.',
                })
            }
            return res!
        }
    }

    /** The API key, or the person's access token as a bearer token. */
    async #credentials(): Promise<Record<string, string>> {
        if (this.#apiKey) return { 'x-api-key': this.#apiKey }
        const token = typeof this.#accessToken === 'function' ? await this.#accessToken() : this.#accessToken
        return { authorization: `Bearer ${token}` }
    }

    async #fail(res: Response): Promise<never> {
        const traceId = res.headers.get('x-trace-id')
        let error: any = null
        try { error = (await res.json())?.error } catch { /* not JSON */ }
        const after = Number(res.headers.get('retry-after'))
        throw errorFor({
            code: error?.code ?? `HTTP_${res.status}`,
            status: res.status,
            message: error?.message ?? `The API answered ${res.status}.`,
            hint: error?.hint ?? null,
            traceId: error?.traceId ?? traceId,
            docs: error?.docs ?? null,
            retryAfter: Number.isFinite(after) && after > 0 ? after : null,
            details: error ? Object.fromEntries(Object.entries(error).filter(([k]) => !['code', 'status', 'message', 'hint', 'traceId', 'docs'].includes(k))) : {},
        })
    }

    #meta(res: Response, body?: any): ResponseMeta {
        return {
            status: res.status,
            traceId: body?.traceId ?? res.headers.get('x-trace-id'),
            provider: body?.provider ?? null,
            meta: body?.meta ?? {},
            headers: res.headers,
        }
    }

    async #call(id: string, spec: OperationSpec, params: Record<string, unknown>, options: RequestOptions, file?: BinaryInput): Promise<unknown> {
        const res = await this.#send(spec, this.#prepare(id, spec, params, options, file), options)
        if (spec.result === 'binary') {
            if (res.status >= 300 && res.status < 400) {
                // Where the file lives (Google Drive, a link): fetch it yourself; the API key stays here.
                const location = res.headers.get('location')
                return { data: new ArrayBuffer(0), contentType: null, fileName: null, location, response: this.#meta(res) } as BinaryResult & { location: string | null }
            }
            if (!res.ok) return this.#fail(res)
            const disposition = res.headers.get('content-disposition') ?? ''
            const fileName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null
            return {
                data: await res.arrayBuffer(),
                contentType: res.headers.get('content-type'),
                fileName: fileName ? decodeURIComponent(fileName) : null,
                location: null,
                response: this.#meta(res),
            }
        }
        if (!res.ok) return this.#fail(res)
        if (res.status === 204 || spec.result === 'empty') return undefined
        const body = await res.json()
        return withResponse(body.data, this.#meta(res, body))
    }

    #paged(id: string, spec: OperationSpec, params: Record<string, unknown>, options: RequestOptions): PagePromise<unknown> {
        const load = async (cursor?: string | null): Promise<Page<unknown>> => {
            const res = await this.#send(spec, this.#prepare(id, spec, cursor ? { ...params, cursor } : params, options), options)
            if (!res.ok) return this.#fail(res)
            const body = await res.json()
            const nextCursor: string | null = body.meta?.nextCursor ?? null
            return {
                data: Array.isArray(body.data) ? body.data : [],
                nextCursor,
                hasMore: !!nextCursor,
                response: this.#meta(res, body),
                next: () => (nextCursor ? load(nextCursor) : Promise.resolve(null)),
            }
        }
        let first: Promise<Page<unknown>> | null = null
        const firstPage = () => (first ??= load(params.cursor as string | undefined))
        const iterate = async function* () {
            let page: Page<unknown> | null = await firstPage()
            while (page) {
                yield* page.data
                page = await page.next()
            }
        }
        return {
            then: (onFulfilled, onRejected) => firstPage().then(onFulfilled, onRejected),
            catch: (onRejected) => firstPage().catch(onRejected),
            finally: (onFinally) => firstPage().finally(onFinally),
            [Symbol.toStringTag]: 'PagePromise',
            [Symbol.asyncIterator]: () => iterate(),
        } as PagePromise<unknown>
    }

    #stream(id: string, spec: OperationSpec, params: Record<string, unknown>, options: RequestOptions): ServerSentEventStream {
        const controller = new AbortController()
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
        const self = this
        return {
            close: () => controller.abort(),
            async *[Symbol.asyncIterator]() {
                // A stream stays open: no timeout, no retries.
                const res = await self.#send(spec, self.#prepare(id, spec, params, options), { ...options, signal, timeoutMs: 2 ** 31 - 1, maxRetries: 0 })
                if (!res.ok) await self.#fail(res)
                const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
                let buffer = ''
                try {
                    while (true) {
                        const { value, done } = await reader.read()
                        if (done) return
                        buffer += value
                        let end: number
                        while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
                            const block = buffer.slice(0, end)
                            buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '')
                            const event = parseEvent(block)
                            if (event) yield event
                        }
                    }
                } catch (error) {
                    if (signal.aborted) return
                    throw error
                } finally {
                    reader.releaseLock()
                }
            },
        }
    }
}

/** One server-sent event block; null for comments and keep-alives. */
const parseEvent = (block: string): ServerSentEvent | null => {
    let event = 'message'
    let id: string | null = null
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
        else if (field === 'id') id = value
    }
    if (!data.length) return null
    const text = data.join('\n')
    return { event, data: text, id, json: <T>() => JSON.parse(text) as T }
}
