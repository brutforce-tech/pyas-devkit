/**
 * Pyas's tools for AI agents: shaped like tasks, not one per endpoint. One table,
 * shared by the MCP server (@pyas/mcp) and by the framework adapters of this package (the
 * Vercel AI SDK, LangChain, OpenAI, Anthropic), so the two never drift.
 *
 * Two kinds of agent use them:
 * - one acting on someone's calendars: accounts, events, free time, replies;
 * - a coding agent integrating Pyas: what an error code means and how to fix it, what a request
 *   did (by its trace id), the recent failures, the API reference, the sandbox's people.
 *
 * Each tool says whether it only reads, changes or deletes (the MCP annotations), which resource
 * it acts on (for scoping), and whether it reaches the whole app rather than one person's
 * calendars (left out when the tools are bound to one person).
 */
import { PyasError, type Event, type Pyas } from '@pyas/sdk'
import { z } from 'zod/v4'

/** What a host is told about a tool, to decide whether to ask the user first. */
export interface ToolHints { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
const READ: ToolHints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
const WRITE: ToolHints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
const DESTROY: ToolHints = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }

/** What a tool acts on: scopes name these (`events`, `events:read`). */
export type ToolResource = 'accounts' | 'calendars' | 'events' | 'availability' | 'developer'
export const RESOURCES: readonly ToolResource[] = ['accounts', 'calendars', 'events', 'availability', 'developer']

/** What a tool runs with. */
export interface ToolContext {
    pyas: Pyas
    /** Set when the tools act for one person only (your app's id for them). */
    subjectId?: string
    /** Throws when an account is not one the tools may use (bound to a person: not theirs). */
    checkAccounts?: (accountIds: string[]) => Promise<void>
}

export interface PyasToolDefinition {
    name: string
    title: string
    description: string
    /** The input, field by field (zod v4). */
    input: z.ZodRawShape
    annotations: ToolHints
    resource: ToolResource
    /** Reaches the whole app, not one person's calendars: never offered when bound to a person. */
    appWide?: boolean
    /** Only with a test key (the sandbox). */
    testOnly?: boolean
    run(ctx: ToolContext, input: any): Promise<unknown>
    /**
     * For a change, before the person is asked to approve it: refuses what could never run (an
     * account that isn't theirs, an event that doesn't exist), and returns the event as it is now,
     * read from Pyas, so the person sees what they approve rather than what the model says.
     */
    describe?(ctx: ToolContext, input: any): Promise<PyasChangeDetails>
    /** What this one change does, for the approval, when the tool's title is broader. */
    changeTitle?(input: any): string
}

/** A calendar account as an approval shows it: whose it is, so the person sees where the change lands. */
export interface PyasChangeAccount {
    accountId: string
    provider: string
    email: string | null
    name: string | null
    /** Your app's id for the person the account belongs to, when it has one. */
    subjectId: string | null
}

/** What a change is about, from Pyas's own data. */
export interface PyasChangeDetails {
    /** The event the change updates, deletes or answers, as it is now. None for a new event. */
    event?: ReturnType<typeof brief>
    /** The calendar the change is made on. */
    calendar?: PyasChangeAccount
    /** The Zoom account that makes the meeting, for a change that adds a Zoom meeting. */
    zoomAccount?: PyasChangeAccount
}

/** The event a change is about, as it is now (after checking the account). */
const currentEvent = async (ctx: ToolContext, { accountId, eventId }: { accountId: string; eventId: string }): Promise<PyasChangeDetails> => {
    await check(ctx, accountId)
    return { event: brief(await ctx.pyas.events.get({ accountId, eventId })) }
}

/**
 * An event, as much as an agent needs (get_event has the rest). The local times are there so an
 * agent tells people the time where the event is without converting from UTC itself, which models
 * get wrong around clock changes.
 */
export const brief = (e: Event) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    startsAtLocal: e.startsAtLocal,
    endsAtLocal: e.endsAtLocal,
    timezone: e.timezone,
    isAllDay: e.isAllDay,
    ...(e.location ? { location: e.location } : {}),
    ...(e.status !== 'confirmed' ? { status: e.status } : {}),
    ...(e.attendees?.length ? { attendees: e.attendees.map((a) => ({ email: a.email, ...(a.response ? { response: a.response } : {}) })) } : {}),
    ...(e.meetingUrl ? { meetingUrl: e.meetingUrl } : {}),
    ...(e.recurrence ? { recurrence: e.recurrence } : {}),
    version: e.version,
})

/** The API's public JSON (the error catalog, the OpenAPI document). */
export const publicJson = async (pyas: Pyas, path: string) => {
    const res = await fetch(`${pyas.baseUrl}${path}`)
    if (!res.ok) {
        const body: any = await res.json().catch(() => null)
        throw new PyasError({ code: body?.error?.code ?? `HTTP_${res.status}`, status: res.status, message: body?.error?.message ?? `${path} returned ${res.status}.`, hint: body?.error?.hint ?? null })
    }
    return res.json()
}

/** The API reference, condensed: one line per operation, filtered by words in it. */
export const condensedReference = (doc: any, search?: string) => {
    const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const lines: string[] = []
    for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
        for (const [method, op] of Object.entries<any>(item)) {
            if (!op?.operationId) continue
            const params = (op.parameters ?? []).filter((p: any) => p.in !== 'header').map((p: any) => `${p.name}${p.required ? '' : '?'}`)
            const line = `${method.toUpperCase()} ${path}  (${op.operationId})  ${op.summary ?? ''}${params.length ? `  params: ${params.join(', ')}` : ''}${op.requestBody ? '  + JSON body' : ''}`
            if (words.every((w) => line.toLowerCase().includes(w) || (op.description ?? '').toLowerCase().includes(w))) lines.push(line)
        }
    }
    return lines
}

const iso = z.string().describe('An ISO 8601 date and time, e.g. 2026-10-21T15:00:00Z (or with an offset).')
const accountId = z.string().describe('A Pyas account ID (list_accounts returns them).')
const attendees = z.array(z.object({ email: z.string(), name: z.string().optional(), optional: z.boolean().optional() }))

const check = (ctx: ToolContext, ...ids: Array<string | undefined>) => ctx.checkAccounts?.(ids.filter((id): id is string => !!id)) ?? Promise.resolve()

/** Every tool, in the order a host lists them. */
export const PYAS_TOOLS: PyasToolDefinition[] = [
    /* ------------------------------ Calendars ------------------------------ */
    {
        name: 'list_accounts',
        title: 'List connected calendars',
        description: 'Lists the calendar accounts connected to this app (Google, Outlook, Zoom, Pyas virtual calendars), each with its accountId, email and subjectId. To find one person\'s accounts, filter by subjectId.',
        input: { subjectId: z.string().optional().describe('Your app\'s id for a person.'), provider: z.enum(['google', 'microsoft', 'zoom', 'pyas']).optional() },
        annotations: READ,
        resource: 'accounts',
        run: async (ctx, { subjectId, provider }) => {
            const subject = ctx.subjectId ?? subjectId
            const accounts: unknown[] = []
            for await (const a of ctx.pyas.accounts.list({ ...(subject ? { subjectId: subject } : {}), ...(provider ? { provider } : {}) })) {
                accounts.push(a)
                if (accounts.length >= 200) break
            }
            return { accounts }
        },
    },
    {
        name: 'account_status',
        title: 'Check a calendar\'s health',
        description: 'Checks whether an account can sync. The overall status is healthy, attention or broken. If the account can\'t sync, the response explains why and how to fix it. A fix of reconnect means the person must sign in again, in your app: open PyasConnect with a connect session for this accountId, and the account keeps its accountId. The response also lists what the account can do (read, write, free/busy, meetings).',
        input: { accountId },
        annotations: READ,
        resource: 'accounts',
        run: async (ctx, { accountId }) => {
            await check(ctx, accountId)
            return ctx.pyas.accounts.status.get({ accountId })
        },
    },
    {
        name: 'accounts_needing_attention',
        title: 'Find calendars that need fixing',
        description: 'Lists every account in the app whose overall health is attention or broken, up to 200. Each account includes the reason, the fix and a message for its owner (userMessage).',
        input: { provider: z.enum(['google', 'microsoft', 'zoom', 'pyas']).optional() },
        annotations: READ,
        resource: 'accounts',
        appWide: true,
        run: async (ctx, { provider }) => {
            const accounts: unknown[] = []
            for await (const s of ctx.pyas.accounts.status.list({ overall: ['attention', 'broken'], ...(provider ? { provider } : {}) })) {
                accounts.push(s)
                if (accounts.length >= 200) break
            }
            return { accounts }
        },
    },
    {
        name: 'list_calendars',
        title: 'List an account\'s calendars',
        description: 'Lists the calendars of one account, with their calendarRef (primary is the main calendar), name, time zone and access level.',
        input: { accountId },
        annotations: READ,
        resource: 'calendars',
        run: async (ctx, { accountId }) => {
            await check(ctx, accountId)
            return { calendars: (await ctx.pyas.calendars.list({ accountId })).data }
        },
    },
    {
        name: 'list_events',
        title: 'List events',
        description: 'Lists events between two times, for one account (accountId) or for every account of a person (subjectId). Recurring events are expanded, and events are sorted by start time. To search the title, location and attendees, use query.',
        input: {
            accountId: accountId.optional(),
            subjectId: z.string().optional().describe('Every account of this person, instead of one accountId.'),
            from: iso, to: iso,
            query: z.string().optional().describe('Words to find in the title, location or attendees.'),
            calendarRef: z.string().optional().describe('One calendar (default: primary).'),
            limit: z.number().int().min(1).max(250).default(50),
        },
        annotations: READ,
        resource: 'events',
        run: async (ctx, { accountId, subjectId, from, to, query, calendarRef, limit }) => {
            const subject = ctx.subjectId ?? subjectId
            if (!accountId && !subject) throw new TypeError('Pass accountId or subjectId.')
            await check(ctx, accountId)
            const events: unknown[] = []
            let more = false
            const params: any = { from, to, expand: true, sort: 'start', limit: Math.min(limit, 100), ...(accountId ? { accountId } : { subjectId: subject }), ...(query ? { q: query } : {}), ...(calendarRef ? { calendarRef } : {}) }
            for await (const e of ctx.pyas.events.list(params)) {
                if (events.length >= limit) { more = true; break }
                events.push(brief(e as Event))
            }
            return { events, ...(more ? { more: true, note: 'There are more events than the limit. Narrow the time range or raise limit.' } : {}) }
        },
    },
    {
        name: 'get_event',
        title: 'Get an event',
        description: 'Returns one event with all its details, including the description, attendees and their responses, conferencing, recurrence, reminders and your metadata.',
        input: { accountId, eventId: z.string() },
        annotations: READ,
        resource: 'events',
        run: async (ctx, { accountId, eventId }) => {
            await check(ctx, accountId)
            return ctx.pyas.events.get({ accountId, eventId })
        },
    },
    {
        name: 'create_event',
        title: 'Create an event',
        description: 'Creates a new event on an account\'s calendar. Which calendar: if the person has more than one calendar account (in list_accounts, leaving out Zoom accounts) and hasn\'t said which one to use, ask them which before calling this, unless you were told their default calendar. If the person hasn\'t said how long the event is, ask them, unless you were told a default length, and set endsAt from startsAt and that length. It can invite attendees, who receive invitations, and add a video meeting: meet on a Google calendar, teams on an Outlook calendar, or zoom on any calendar with zoomAccountId, a connected Zoom account from list_accounts. If the person has more than one Zoom account and hasn\'t said which, ask them which. Pyas calendars (the sandbox\'s people) take zoom only. To change an event that already exists, including adding a video meeting to it, use update_event: a new event sends attendees a second invitation.',
        input: {
            accountId,
            title: z.string(),
            startsAt: iso, endsAt: iso,
            timezone: z.string().optional().describe('IANA time zone, for example America/New_York (default: the calendar\'s time zone).'),
            description: z.string().optional(),
            location: z.string().optional(),
            attendees: attendees.optional(),
            meeting: z.enum(['meet', 'teams', 'zoom']).optional().describe('Add a video meeting: meet (Google calendars), teams (Outlook calendars) or zoom (with zoomAccountId).'),
            zoomAccountId: z.string().optional().describe('For zoom: the connected Zoom account to make the meeting with (provider zoom in list_accounts).'),
            recurrence: z.string().optional().describe('An RFC 5545 RRULE, e.g. FREQ=WEEKLY;BYDAY=MO.'),
            calendarRef: z.string().optional(),
        },
        annotations: WRITE,
        resource: 'events',
        run: async (ctx, { meeting, zoomAccountId, ...input }) => {
            if (meeting === 'zoom' && !zoomAccountId) throw new TypeError('A Zoom meeting needs zoomAccountId: the connected Zoom account (provider zoom in list_accounts).')
            await check(ctx, input.accountId, meeting === 'zoom' ? zoomAccountId : undefined)
            return brief(await ctx.pyas.events.create({ ...input, ...(meeting ? { conferencing: { provider: meeting, ...(meeting === 'zoom' ? { accountId: zoomAccountId } : {}) } } : {}) }))
        },
        describe: async (ctx, { accountId, meeting, zoomAccountId }) => {
            await check(ctx, accountId, meeting === 'zoom' ? zoomAccountId : undefined)
            return {}
        },
    },
    {
        name: 'update_event',
        title: 'Update an event or add a video meeting',
        description: 'Changes an existing event in place: its title, times, location, description, attendees, or video meeting. Attendees get an update, not a new invitation. To add a video link to an event, pass meeting: meet on a Google calendar, teams on an Outlook calendar, or zoom on any calendar with zoomAccountId, a connected Zoom account from list_accounts. If the person has more than one Zoom account and hasn\'t said which, ask them which. Pyas calendars (the sandbox\'s people) take zoom only. An event that already has a meeting gets a new link, and meeting none removes it. Only the fields you pass change. To change the time, pass both startsAt and endsAt, keeping the event\'s length unless the person changed it. To reject the update if someone else changed the event first, pass the version from get_event.',
        input: {
            accountId, eventId: z.string(),
            title: z.string().optional(), startsAt: iso.optional(), endsAt: iso.optional(), timezone: z.string().optional(),
            description: z.string().optional(), location: z.string().optional(),
            attendees: attendees.optional().describe('The full list, which replaces the current one.'),
            meeting: z.enum(['meet', 'teams', 'zoom', 'none']).optional().describe('Add a video meeting: meet (Google calendars), teams (Outlook calendars) or zoom (with zoomAccountId). none removes the event\'s meeting.'),
            zoomAccountId: z.string().optional().describe('For zoom: the connected Zoom account to make the meeting with (provider zoom in list_accounts).'),
            version: z.string().optional().describe('The event\'s version from get_event.'),
        },
        // Not idempotent: adding a meeting twice makes two meetings, the second replacing the first.
        annotations: WRITE,
        resource: 'events',
        run: async (ctx, { version, meeting, zoomAccountId, ...input }) => {
            if (meeting === 'zoom' && !zoomAccountId) throw new TypeError('A Zoom meeting needs zoomAccountId: the connected Zoom account (provider zoom in list_accounts).')
            await check(ctx, input.accountId, meeting === 'zoom' ? zoomAccountId : undefined)
            const conferencing = meeting === 'none' ? { conferencing: null } : meeting ? { conferencing: { provider: meeting, ...(meeting === 'zoom' ? { accountId: zoomAccountId } : {}) } } : {}
            return brief(await ctx.pyas.events.update({ ...input, ...conferencing }, version ? { ifMatch: version } : {}))
        },
        describe: (ctx, input) => currentEvent(ctx, input),
        changeTitle: ({ meeting, startsAt, endsAt, title, description, location, attendees, timezone }) => {
            const moves = startsAt !== undefined || endsAt !== undefined || timezone !== undefined
            const edits = [title, description, location, attendees].some((field) => field !== undefined)
            if (meeting && !moves && !edits) return meeting === 'none' ? 'Remove the video meeting' : 'Add a video meeting'
            if (moves && !meeting && !edits) return 'Move an event'
            return 'Update an event'
        },
    },
    {
        name: 'delete_event',
        title: 'Delete an event',
        description: 'Deletes an event. When the account organized it, attendees are told it was cancelled.',
        input: { accountId, eventId: z.string() },
        annotations: DESTROY,
        resource: 'events',
        run: async (ctx, { accountId, eventId }) => {
            await check(ctx, accountId)
            await ctx.pyas.events.delete({ accountId, eventId })
            return { deleted: eventId }
        },
        describe: (ctx, input) => currentEvent(ctx, input),
    },
    {
        name: 'respond_to_event',
        title: 'Reply to an invitation',
        description: 'Accepts, declines or tentatively accepts an event the account was invited to.',
        input: { accountId, eventId: z.string(), response: z.enum(['accepted', 'declined', 'tentative']), comment: z.string().optional() },
        annotations: { ...WRITE, idempotentHint: true },
        resource: 'events',
        run: async (ctx, { accountId, eventId, response, comment }) => {
            await check(ctx, accountId)
            return ctx.pyas.events.respond({ accountId, eventId, response, ...(comment ? { comment } : {}) })
        },
        describe: (ctx, input) => currentEvent(ctx, input),
    },
    {
        name: 'find_meeting_times',
        title: 'Find times everyone is free',
        description: 'Finds time slots of the given length when every listed account is free, within each person\'s working hours, across Google, Outlook and Pyas calendars. Slot times are in UTC. The result says which working hours were used for each person, and partial is true when a calendar could not be read.',
        input: {
            accountIds: z.array(z.string()).min(1).max(20),
            from: iso, to: iso,
            durationMinutes: z.number().int().min(5).max(1440),
            timezone: z.string().optional().describe('IANA time zone that slots start on round times in, and that working hours fall back to. Slot times are still returned in UTC.'),
            limit: z.number().int().min(1).max(50).default(10),
        },
        annotations: READ,
        resource: 'availability',
        run: async (ctx, input) => {
            await check(ctx, ...input.accountIds)
            const slots = await ctx.pyas.meetingTimes.find(input)
            // The API's meta says how the answer was reached; the SDK keeps it beside the data.
            const meta = (slots as { lastResponse?: { meta?: Record<string, unknown> } }).lastResponse?.meta ?? {}
            return { slots, partial: meta.partial === true, attendees: meta.attendees ?? [] }
        },
    },
    {
        name: 'get_free_busy',
        title: 'Get busy times',
        description: 'Returns when each account is busy between two times, without event details.',
        input: { accountIds: z.array(z.string()).min(1).max(20), from: iso, to: iso },
        annotations: READ,
        resource: 'availability',
        run: async (ctx, input) => {
            await check(ctx, ...input.accountIds)
            return ctx.pyas.freeBusy.query(input)
        },
    },

    /* ------------------------- For coding agents ------------------------- */
    {
        name: 'explain_error',
        title: 'Explain an error code',
        description: 'Explains what a Pyas error code means, what usually causes it, how to fix it, whether a retry can help, and related codes.',
        input: { code: z.string().describe('e.g. CONNECTION_NOT_FOUND') },
        annotations: { ...READ, openWorldHint: false },
        resource: 'developer',
        run: (ctx, { code }) => publicJson(ctx.pyas, `/v2/errors/${encodeURIComponent(code.trim().toUpperCase())}`),
    },
    {
        name: 'get_request',
        title: 'What a request did',
        description: 'Returns one request to the Pyas API by its trace ID. Every response and error includes a trace ID. The result includes the endpoint, the response, the error and hint, and what Pyas did for the request (provider calls, webhooks).',
        input: { traceId: z.string().describe('trc_...') },
        annotations: { ...READ, openWorldHint: false },
        resource: 'developer',
        appWide: true,
        run: (ctx, { traceId }) => ctx.pyas.logs.get({ traceId }),
    },
    {
        name: 'list_recent_requests',
        title: 'Recent requests',
        description: 'Lists the latest requests to the API for this key\'s app and mode, newest first. To find what is going wrong, set failedOnly to list only failed requests.',
        input: {
            failedOnly: z.boolean().default(false),
            accountId: accountId.optional(),
            limit: z.number().int().min(1).max(100).default(20),
        },
        annotations: { ...READ, openWorldHint: false },
        resource: 'developer',
        appWide: true,
        run: async (ctx, { failedOnly, accountId, limit }) => {
            const page = await ctx.pyas.logs.list({ ...(failedOnly ? { outcome: 'failed' } : {}), ...(accountId ? { accountId } : {}), limit } as any)
            return { requests: page.data }
        },
    },
    {
        name: 'api_reference',
        title: 'Search the API reference',
        description: 'Searches the Pyas API v2 operations and returns one line per operation (method, path, operation ID, summary, parameters), filtered by the words you pass. The full OpenAPI document is at /v2/openapi.json.',
        input: { search: z.string().optional().describe('Words to search for, for example "webhook replay" or "free busy".') },
        annotations: { ...READ, openWorldHint: false },
        resource: 'developer',
        run: async (ctx, { search }) => {
            const lines = condensedReference(await publicJson(ctx.pyas, '/v2/openapi.json'), search)
            return { operations: lines.slice(0, 80), ...(lines.length > 80 ? { more: lines.length - 80 } : {}) }
        },
    },
    {
        name: 'sandbox',
        title: 'The sandbox',
        description: 'Returns this app\'s sandbox, including its people (with their accountIds), their calendars and the IDs to test requests with.',
        input: {},
        annotations: { ...READ, openWorldHint: false },
        resource: 'developer',
        appWide: true,
        testOnly: true,
        run: (ctx) => ctx.pyas.sandbox.get(),
    },
]
