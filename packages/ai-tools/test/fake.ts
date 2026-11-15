import { Pyas } from '@pyas/sdk'

/**
 * A Pyas client whose requests never leave the test: each is recorded, and answered as the API
 * would for a small app (two people, one event each).
 */
export const ACCOUNTS = [
    { accountId: 'acc_avery', provider: 'pyas', email: 'avery@example.com', subjectId: 'user_42' },
    { accountId: 'acc_riley', provider: 'pyas', email: 'riley@example.com', subjectId: 'user_77' },
]

/** A Zoom account, readable by id only, so it changes nothing the account lists answer. */
export const ZOOM_ACCOUNT = { accountId: 'acc_zoom', provider: 'zoom', email: 'ops@example.com', subjectId: null }

export const EVENT = {
    id: 'evt_1', title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T16:00:00Z',
    timezone: 'UTC', isAllDay: false, status: 'confirmed', version: 'v1', attendees: [],
}

export interface Sent { method: string; path: string; query: Record<string, string>; body: any }

const ok = (data: unknown, status = 200, meta: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ success: true, data, provider: 'pyas', traceId: 'trc_ok', meta }), { status, headers: { 'content-type': 'application/json', 'x-trace-id': 'trc_ok' } })

const fail = (status: number, code: string, message: string) =>
    new Response(JSON.stringify({ success: false, error: { code, message, hint: `What to do about ${code}.`, status, traceId: 'trc_fail', docs: `https://developer.pyas.io/errors/${code}` } }), { status, headers: { 'content-type': 'application/json', 'x-trace-id': 'trc_fail' } })

export const fakePyas = (apiKey = 'pyas_sk_test_fake') => {
    const sent: Sent[] = []
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        sent.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body })
        const route = `${method} ${url.pathname}`
        if (route === 'GET /v2/accounts') {
            const subject = url.searchParams.get('subjectId')
            return ok(ACCOUNTS.filter((a) => !subject || a.subjectId === subject), 200, { nextCursor: null })
        }
        if (method === 'GET' && url.pathname.startsWith('/v2/accounts/')) {
            const account = [...ACCOUNTS, ZOOM_ACCOUNT].find((a) => a.accountId === decodeURIComponent(url.pathname.slice('/v2/accounts/'.length)))
            return account ? ok({ name: null, status: 'active', ...account }) : fail(404, 'CONNECTION_NOT_FOUND', 'No such account.')
        }
        if (route === 'GET /v2/events') return ok([EVENT], 200, { nextCursor: null })
        if (route === 'POST /v2/meeting-times') return ok([{ startsAt: '2026-10-21T14:00:00Z', endsAt: '2026-10-21T14:30:00Z', optionalFree: [], optionalBusy: [] }], 200, {
            timezone: 'UTC', partial: false,
            attendees: body.accountIds.map((accountId: string) => ({ accountId, optional: false, workingHours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00', timezone: 'UTC', source: 'default' } })),
        })
        if (route === 'POST /v2/events') return ok({ ...EVENT, id: 'evt_new', title: body.title, startsAt: body.startsAt, endsAt: body.endsAt }, 201)
        if (route === 'GET /v2/events/evt_1') return ok(EVENT)
        if (route === 'GET /v2/events/evt_missing') return fail(404, 'RESOURCE_NOT_FOUND', 'No such event.')
        if (route === 'DELETE /v2/events/evt_1') return ok({ deleted: true })
        if (route === 'PATCH /v2/events/evt_1') return ok({ ...EVENT, ...(body.conferencing ? { meetingUrl: 'https://zoom.us/j/123' } : {}) })
        return fail(404, 'ROUTE_NOT_FOUND', `${route} is not faked.`)
    }
    return { pyas: new Pyas({ apiKey, baseUrl: 'https://api.test', fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), sent }
}
