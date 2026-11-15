/**
 * The SDK's types, derived from the API's own OpenAPI document
 * (src/generated/schema.ts): what each operation takes and what it answers.
 */
import type { components, operations } from './generated/schema'
import type { ListParams, OperationId } from './generated/operations'

type Clean<T> = [T] extends [never] ? {} : [T] extends [undefined] ? {} : NonNullable<T>
type Get<T, P extends string> = T extends { [K in P]?: infer V } ? V : never
type ParamsOf<K extends OperationId> = operations[K] extends { parameters: infer P } ? P : {}
type Widen<T, L> = { [P in keyof T]: P extends L ? T[P] | string[] : T[P] }

type PathOf<K extends OperationId> = Clean<Get<ParamsOf<K>, 'path'>>
type QueryOf<K extends OperationId> = Widen<Clean<Get<ParamsOf<K>, 'query'>>, K extends keyof ListParams ? ListParams[K] : never>
type BodyOf<K extends OperationId> = Clean<Get<operations[K], 'requestBody'>> extends { content: { 'application/json': infer J } } ? J : {}
/** Hand-shaped additions the document cannot describe. */
type ExtraOf<K extends OperationId> = K extends 'events.list'
    ? {
        /** Events by your own keys (`metadata.<key>=<value>`), across the app: `{ orderId: '123' }`. */
        metadata?: Record<string, string | number | boolean>
    }
    : {}

/** What an operation takes: its path, query and body parameters in one object. */
export type Params<K extends OperationId> = PathOf<K> & QueryOf<K> & BodyOf<K> & ExtraOf<K>

type Responses<K extends OperationId> = operations[K] extends { responses: infer R } ? R : never
type Ok<K extends OperationId> = Responses<K>[Extract<keyof Responses<K>, 200 | 201 | 202>]
type OkJson<K extends OperationId> = Ok<K> extends { content: { 'application/json': infer J } } ? J : never

/** What an operation answers: the envelope's `data`. */
export type Data<K extends OperationId> = OkJson<K> extends { data: infer D } ? D : never
/** One item of a paged list. */
export type Item<K extends OperationId> = Data<K> extends Array<infer I> ? I : never

export interface RequestOptions {
    /**
     * For creates that take one: the same key never creates twice, so a retry is safe. The SDK
     * makes one per call when you pass none, and keeps it across its own retries.
     */
    idempotencyKey?: string
    /** For updates and deletes that take one: change it only if it is still at this `version`. */
    ifMatch?: string
    /** Cancels the request. */
    signal?: AbortSignal
    /** This call's timeout, overriding the client's. */
    timeoutMs?: number
    /** This call's retries, overriding the client's. */
    maxRetries?: number
    /** Extra headers (rarely needed). */
    headers?: Record<string, string>
}

/** What every answer carries besides its data. */
export interface ResponseMeta {
    status: number
    /** Quote it to support, or find the request in your dashboard's Logs. */
    traceId: string | null
    /** The provider that answered (google, microsoft, zoom, pyas), when one did. */
    provider: string | null
    meta: Record<string, unknown>
    headers: Headers
}

export interface Page<T> {
    data: T[]
    /** Pass as `cursor` for the next page; null on the last. */
    nextCursor: string | null
    hasMore: boolean
    response: ResponseMeta
    /** The next page, or null on the last. */
    next(): Promise<Page<T> | null>
}

/** One page when awaited; every item, page after page, with `for await`. */
export type PagePromise<T> = Promise<Page<T>> & AsyncIterable<T>

/** A file to upload: bytes, a Blob, or a stream. */
export type BinaryInput = Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>

export interface BinaryResult {
    data: ArrayBuffer
    contentType: string | null
    fileName: string | null
    response: ResponseMeta
}

export interface ServerSentEvent {
    event: string
    data: string
    id: string | null
    /** `data` parsed as JSON. */
    json<T = unknown>(): T
}

/** Events as the API sends them; `close()` stops listening. */
export type ServerSentEventStream = AsyncIterable<ServerSentEvent> & { close(): void }

/** Every schema the API describes, by name: `Schemas['Event']`. */
export type Schemas = components['schemas']
export type Event = Schemas['Event']
export type Calendar = Schemas['Calendar']
export type Provider = Schemas['Provider']
