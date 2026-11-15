/**
 * Verifying Pyas's webhook deliveries, exactly as the API signs them:
 *
 *   Pyas-Signature: t=1760788800,v1=5257a869e7...
 *
 * `v1` is HMAC-SHA256, in hex, over `<t>.<raw body>` with the endpoint's signing secret
 * (`whsec_...`). The timestamp is signed too, so an old delivery cannot be replayed: a signature
 * older than five minutes is refused. While a rotated secret is in its grace period a delivery
 * carries a `v1` for each secret, and either verifies.
 *
 * Verify the raw body, as received, before parsing it: re-serialized JSON does not match.
 */
import { PyasError } from './errors'

export const SIGNATURE_HEADER = 'Pyas-Signature'
export const TOLERANCE_SECONDS = 300

export interface VerifyOptions {
    /** Seconds a signature stays valid (default 300). */
    toleranceSeconds?: number
    /** The current time in milliseconds (for tests). */
    now?: number
}

/**
 * What `event.*` and `invitation.replied` deliveries carry in `data.object`: the IDs
 * to read the event with, never its details.
 */
export interface WebhookEventRef {
    /** The event's ID; when `isSeries` is true, the recurring series'. */
    id: string
    /** Pass it as `calendarRef` when you read the event. */
    calendarId: string
    /** For one occurrence of a series that changed on its own, the series' ID. */
    seriesId: string | null
    /** The change was to a whole recurring series. */
    isSeries: boolean
}

/** What `calendar.*` deliveries carry in `data.object`. */
export interface WebhookCalendarRef {
    id: string
}

/** A delivery as Pyas sends it. `data` depends on `type` (usually `{ object }`). */
export interface WebhookEvent<T = unknown> {
    /** `evt_...`: the same id on every retry of this event, so you can skip duplicates. */
    id: string
    type: string
    apiVersion: string
    createdAt: string
    /** False in the sandbox (test mode). */
    livemode: boolean
    appId: string
    accountId: string | null
    subjectId: string | null
    provider: string | null
    data: T
    /** The request that caused it, when one did (your own writes carry your request's trace id). */
    request: { traceId: string } | null
    /** Sent with "Send test event". */
    test?: true
}

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Compares in constant time for equal lengths. */
const same = (a: string, b: string) => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

const hmacHex = async (secret: string, message: string) => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

const asText = (body: string | Uint8Array | ArrayBuffer) =>
    typeof body === 'string' ? body : new TextDecoder().decode(body instanceof ArrayBuffer ? new Uint8Array(body) : body)

/** True when the header holds a valid, recent signature of this raw body by this secret. */
export const verifyWebhook = async (
    header: string | null | undefined,
    rawBody: string | Uint8Array | ArrayBuffer,
    secret: string,
    opts: VerifyOptions = {},
): Promise<boolean> => {
    if (!header || !secret) return false
    const parts = header.split(',').map((p) => p.trim().split('='))
    const t = Number(parts.find(([k]) => k === 't')?.[1])
    if (!Number.isInteger(t)) return false
    const now = Math.floor((opts.now ?? Date.now()) / 1000)
    if (Math.abs(now - t) > (opts.toleranceSeconds ?? TOLERANCE_SECONDS)) return false
    const expected = await hmacHex(secret, `${t}.${asText(rawBody)}`)
    return parts.some(([k, v]) => k === 'v1' && !!v && /^[0-9a-f]{64}$/.test(v) && same(v, expected))
}

/**
 * The delivery's event, after checking its signature; throws a PyasError
 * (WEBHOOK_SIGNATURE_INVALID) when it does not verify.
 */
export const constructWebhookEvent = async <T = unknown>(
    rawBody: string | Uint8Array | ArrayBuffer,
    header: string | null | undefined,
    secret: string,
    opts: VerifyOptions = {},
): Promise<WebhookEvent<T>> => {
    if (!(await verifyWebhook(header, rawBody, secret, opts))) {
        throw new PyasError({
            code: 'WEBHOOK_SIGNATURE_INVALID',
            status: 400,
            message: 'The Pyas-Signature header does not verify for this body and secret, or is more than five minutes old.',
            hint: 'Verify the raw body exactly as received (before any JSON parsing), with the signing secret of this webhook endpoint.',
        })
    }
    return JSON.parse(asText(rawBody)) as WebhookEvent<T>
}

/** The header for a body, signed as Pyas signs it: for testing your own webhook handler. */
export const signWebhookForTest = async (rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) =>
    `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`
