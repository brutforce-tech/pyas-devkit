/**
 * Every failure is a PyasError with the API's own code (e.g. CONNECTION_NOT_FOUND), its hint,
 * the link to its documentation and the request's trace id. The subclasses group them by what
 * a program does about them; `instanceof` or `err.code` both work.
 */

export interface PyasErrorFields {
    code: string
    message: string
    status: number
    hint?: string | null
    traceId?: string | null
    docs?: string | null
    /** Seconds to wait before trying again, when the API said (429, some 503s). */
    retryAfter?: number | null
    /** Anything else the API sent with the error. */
    details?: Record<string, unknown>
}

export class PyasError extends Error {
    readonly code: string
    readonly status: number
    readonly hint: string | null
    readonly traceId: string | null
    readonly docs: string | null
    readonly retryAfter: number | null
    readonly details: Record<string, unknown>

    constructor(fields: PyasErrorFields) {
        super(fields.message)
        this.name = new.target.name
        this.code = fields.code
        this.status = fields.status
        this.hint = fields.hint ?? null
        this.traceId = fields.traceId ?? null
        this.docs = fields.docs ?? null
        this.retryAfter = fields.retryAfter ?? null
        this.details = fields.details ?? {}
    }
}

/** 400, 422: the request itself is wrong; the message and hint say how. Retrying changes nothing. */
export class ValidationError extends PyasError {}
/** 401: the API key is missing, wrong, revoked or expired. */
export class AuthenticationError extends PyasError {}
/** 403: the key cannot do this (its scopes, its mode: a test key in live data, or the reverse). */
export class PermissionError extends PyasError {}
/** 404, 410: no such resource for this app (or no longer). */
export class NotFoundError extends PyasError {}
/** 409, 412: it changed or already exists (an If-Match that no longer matches, an idempotency key reused differently). */
export class ConflictError extends PyasError {}
/** 429: too many requests. The SDK already waited and retried; `retryAfter` says how long to wait. */
export class RateLimitError extends PyasError {}
/** 5xx: Pyas or the provider failed. Safe calls were retried; the trace id finds it in Logs. */
export class ApiError extends PyasError {}
/** The API could not be reached, or the request timed out. */
export class ConnectionError extends PyasError {}

export const errorFor = (fields: PyasErrorFields): PyasError => {
    const s = fields.status
    if (s === 400 || s === 422) return new ValidationError(fields)
    if (s === 401) return new AuthenticationError(fields)
    if (s === 403) return new PermissionError(fields)
    if (s === 404 || s === 410) return new NotFoundError(fields)
    if (s === 409 || s === 412) return new ConflictError(fields)
    if (s === 429) return new RateLimitError(fields)
    if (s >= 500) return new ApiError(fields)
    return new PyasError(fields)
}

export const isPyasError = (value: unknown): value is PyasError => value instanceof PyasError
