import { describe, expect, it } from 'vitest'
import { createPyasTools, inScope, PYAS_TOOLS } from '../src'
import { brief } from '../src/tools'
import { fakePyas } from './fake'

/** The person approved the call (the adapters ask; these tests run the core directly). */
const approved = { approved: true }

describe('an event as agents get it', () => {
    it('carries the local times, so an agent never converts from UTC itself (models slip around clock changes)', () => {
        const event = {
            id: 'e1', title: 'Review', startsAt: '2026-11-03T15:00:00Z', endsAt: '2026-11-03T16:00:00Z',
            startsAtLocal: '2026-11-03T10:00:00-05:00', endsAtLocal: '2026-11-03T11:00:00-05:00', timezone: 'America/New_York',
            isAllDay: false, status: 'confirmed', attendees: [], meetingUrl: null, recurrence: null, location: null, version: 'W/"v1"',
        } as any
        expect(brief(event)).toEqual({
            id: 'e1', title: 'Review', startsAt: '2026-11-03T15:00:00Z', endsAt: '2026-11-03T16:00:00Z',
            startsAtLocal: '2026-11-03T10:00:00-05:00', endsAtLocal: '2026-11-03T11:00:00-05:00', timezone: 'America/New_York',
            isAllDay: false, version: 'W/"v1"',
        })
    })
})

const names = (tools: Array<{ name: string }>) => tools.map((t) => t.name).sort()
const READS = PYAS_TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)

describe('the tool table', () => {
    it('is the MCP server\'s: task-shaped tools, each annotated and given a resource', () => {
        expect(names(PYAS_TOOLS)).toEqual(['account_status', 'accounts_needing_attention', 'api_reference', 'create_event', 'delete_event', 'explain_error', 'find_meeting_times', 'get_event', 'get_free_busy', 'get_request', 'list_accounts', 'list_calendars', 'list_events', 'list_recent_requests', 'respond_to_event', 'sandbox', 'update_event'])
        for (const t of PYAS_TOOLS) {
            expect(t.description.length, t.name).toBeGreaterThan(20)
            expect(t.description, t.name).not.toContain(String.fromCharCode(0x2014))
        }
        expect(PYAS_TOOLS.find((t) => t.name === 'delete_event')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    })
})

describe('scoping', () => {
    const { pyas } = fakePyas()

    it('offers every calendar tool by default, and the developer tools only when asked', () => {
        const all = names(createPyasTools({ allAccounts: true, pyas }))
        expect(all).toContain('create_event')
        expect(all).not.toContain('explain_error')
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['developer'] }))).toEqual(['api_reference', 'explain_error', 'get_request', 'list_recent_requests', 'sandbox'])
    })

    it('read, write, a resource, or a resource\'s reads or writes', () => {
        const reads = names(createPyasTools({ allAccounts: true, pyas, scope: ['read'] }))
        expect(reads.every((n) => READS.includes(n))).toBe(true)
        expect(reads).toContain('list_events')
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['write'] }))).toEqual(['create_event', 'delete_event', 'respond_to_event', 'update_event'])
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['events'] }))).toEqual(['create_event', 'delete_event', 'get_event', 'list_events', 'respond_to_event', 'update_event'])
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['events:read'] }))).toEqual(['get_event', 'list_events'])
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['events:read', 'availability'] }))).toEqual(['find_meeting_times', 'get_event', 'get_free_busy', 'list_events'])
    })

    it('readOnly keeps only the tools that change nothing, with any scope', () => {
        expect(names(createPyasTools({ allAccounts: true, pyas, readOnly: true })).every((n) => READS.includes(n))).toBe(true)
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['events'], readOnly: true }))).toEqual(['get_event', 'list_events'])
    })

    it('refuses a scope it does not know, so a typo never widens access', () => {
        expect(() => createPyasTools({ allAccounts: true, pyas, scope: ['event:read' as any] })).toThrow(/Unknown scope/)
        expect(() => createPyasTools({ allAccounts: true, pyas, scope: ['events:delete' as any] })).toThrow(/Unknown scope/)
        expect(() => inScope(PYAS_TOOLS[0], ['read:events' as any])).toThrow(/Unknown scope/)
    })

    it('offers the sandbox tool with a test key only', () => {
        expect(names(createPyasTools({ allAccounts: true, pyas, scope: ['developer'] }))).toContain('sandbox')
        expect(names(createPyasTools({ allAccounts: true, pyas: fakePyas('pyas_sk_live').pyas, scope: ['developer'] }))).not.toContain('sandbox')
        expect(names(createPyasTools({ allAccounts: true, apiKey: 'pyas_sk_live', scope: ['developer'] }))).not.toContain('sandbox')
    })
})

describe('running a tool', () => {
    it('validates the input, then calls the API through the SDK', async () => {
        const { pyas, sent } = fakePyas()
        const listEvents = createPyasTools({ allAccounts: true, pyas }).find((t) => t.name === 'list_events')!
        const bad = await listEvents.execute({ accountId: 'acc_avery' })
        expect(bad).toMatchObject({ ok: false, error: { code: 'TOOL_INVALID_INPUT' } })
        expect(sent).toEqual([])
        const result = await listEvents.execute({ accountId: 'acc_avery', from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z' })
        expect(result).toEqual({ ok: true, data: { events: [expect.objectContaining({ id: 'evt_1', title: 'Design review', version: 'v1' })] } })
        expect(sent[0]).toMatchObject({ method: 'GET', path: '/v2/events', query: { accountId: 'acc_avery', expand: 'true', sort: 'start', limit: '50' } })
    })

    it('create_event makes a Zoom meeting with the Zoom account named, and says what it needs without one', async () => {
        const { pyas, sent } = fakePyas()
        const create = createPyasTools({ allAccounts: true, pyas }).find((t) => t.name === 'create_event')!
        const base = { accountId: 'acc_avery', title: 'Intro', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }
        const missing = await create.execute({ ...base, meeting: 'zoom' }, approved)
        expect(missing).toMatchObject({ ok: false })
        expect(JSON.stringify(missing)).toContain('zoomAccountId')
        expect(sent).toEqual([])
        expect(await create.execute({ ...base, meeting: 'zoom', zoomAccountId: 'acc_zoom' }, approved)).toMatchObject({ ok: true })
        expect(sent.at(-1)).toMatchObject({ method: 'POST', path: '/v2/events', body: { conferencing: { provider: 'zoom', accountId: 'acc_zoom' } } })
        await create.execute({ ...base, meeting: 'meet' }, approved)
        expect(sent.at(-1)!.body.conferencing).toEqual({ provider: 'meet' })
    })

    it('update_event adds a video meeting to the same event, removes it with none, and answers with the join link', async () => {
        const { pyas, sent } = fakePyas()
        const update = createPyasTools({ allAccounts: true, pyas }).find((t) => t.name === 'update_event')!
        const base = { accountId: 'acc_avery', eventId: 'evt_1' }
        expect(JSON.stringify(await update.execute({ ...base, meeting: 'zoom' }, approved))).toContain('zoomAccountId')
        expect(sent).toEqual([])
        expect(await update.execute({ ...base, meeting: 'zoom', zoomAccountId: 'acc_zoom' }, approved)).toMatchObject({ ok: true, data: { id: 'evt_1', meetingUrl: 'https://zoom.us/j/123' } })
        expect(sent.at(-1)).toMatchObject({ method: 'PATCH', path: '/v2/events/evt_1', body: { conferencing: { provider: 'zoom', accountId: 'acc_zoom' } } })
        await update.execute({ ...base, meeting: 'none' }, approved)
        expect(sent.at(-1)!.body).toEqual({ conferencing: null })
        await update.execute({ ...base, title: 'Renamed' }, approved)
        expect(sent.at(-1)!.body).toEqual({ title: 'Renamed' })
    })

    it('returns the API\'s error with its code, hint, docs and trace id', async () => {
        const { pyas } = fakePyas()
        const getEvent = createPyasTools({ allAccounts: true, pyas }).find((t) => t.name === 'get_event')!
        expect(await getEvent.execute({ accountId: 'acc_avery', eventId: 'evt_missing' })).toEqual({
            ok: false,
            error: { code: 'RESOURCE_NOT_FOUND', message: 'No such event.', hint: 'What to do about RESOURCE_NOT_FOUND.', docs: 'https://developer.pyas.io/errors/RESOURCE_NOT_FOUND', traceId: 'trc_fail' },
        })
    })

    it('makes its client when a tool first runs, so definitions need no key', () => {
        expect(createPyasTools({ allAccounts: true, apiKey: undefined }).length).toBeGreaterThan(5)
    })
})

describe('bound to one person (subjectId)', () => {
    it('reaches that person\'s accounts only, and refuses others before calling the API', async () => {
        const { pyas, sent } = fakePyas()
        const tools = createPyasTools({ pyas, subjectId: 'user_42' })
        const getEvent = tools.find((t) => t.name === 'get_event')!
        const refused = await getEvent.execute({ accountId: 'acc_riley', eventId: 'evt_1' })
        expect(refused).toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED', hint: expect.stringContaining('list_accounts') } })
        expect(sent.filter((s) => s.path.startsWith('/v2/events'))).toEqual([])
        expect(await getEvent.execute({ accountId: 'acc_avery', eventId: 'evt_1' })).toMatchObject({ ok: true, data: { id: 'evt_1' } })
        const meeting = tools.find((t) => t.name === 'find_meeting_times')!
        expect(await meeting.execute({ accountIds: ['acc_avery', 'acc_riley'], from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z', durationMinutes: 30 }))
            .toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED', message: expect.stringContaining('acc_riley') } })
    })

    it('find_meeting_times says how the answer was reached: whose working hours, and whether it is partial', async () => {
        const { pyas } = fakePyas()
        const meeting = createPyasTools({ allAccounts: true, pyas }).find((t) => t.name === 'find_meeting_times')!
        const result = await meeting.execute({ accountIds: ['acc_avery', 'acc_riley'], from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z', durationMinutes: 30 })
        expect(result).toMatchObject({
            ok: true,
            data: {
                slots: [{ startsAt: '2026-10-21T14:00:00Z' }],
                partial: false,
                attendees: [{ accountId: 'acc_avery', workingHours: { source: 'default' } }, { accountId: 'acc_riley' }],
            },
        })
    })

    it('fixes the subject itself: the model cannot choose another person, and app-wide tools are not offered', async () => {
        const { pyas, sent } = fakePyas()
        const tools = createPyasTools({ pyas, subjectId: 'user_42', scope: ['accounts', 'events', 'developer'] })
        expect(names(tools)).not.toEqual(expect.arrayContaining(['accounts_needing_attention']))
        expect(names(tools).filter((n) => ['accounts_needing_attention', 'get_request', 'list_recent_requests', 'sandbox'].includes(n))).toEqual([])
        const listAccounts = tools.find((t) => t.name === 'list_accounts')!
        expect(Object.keys((listAccounts.parameters as any).properties)).toEqual(['provider'])
        expect(await listAccounts.execute({ subjectId: 'user_77' })).toMatchObject({ ok: true, data: { accounts: [{ accountId: 'acc_avery' }] } })
        expect(sent.at(-1)).toMatchObject({ path: '/v2/accounts', query: { subjectId: 'user_42' } })
        const listEvents = tools.find((t) => t.name === 'list_events')!
        await listEvents.execute({ from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z' })
        expect(sent.at(-1)).toMatchObject({ path: '/v2/events', query: { subjectId: 'user_42' } })
    })
})

describe('whose calendars the tools reach', () => {
    const { pyas } = fakePyas()

    it('must be said: neither subjectId nor allAccounts is refused before any tool exists', () => {
        expect(() => createPyasTools({ pyas } as any)).toThrow(/Say whose calendars the tools reach/)
        expect(() => createPyasTools(undefined as any)).toThrow(/Say whose calendars the tools reach/)
    })

    it('refuses a subjectId that is missing or empty, the usual sign of a session with no user', () => {
        expect(() => createPyasTools({ pyas, subjectId: undefined } as any)).toThrow(/Say whose calendars/)
        expect(() => createPyasTools({ pyas, subjectId: '' } as any)).toThrow(/an empty string/)
        expect(() => createPyasTools({ pyas, subjectId: '   ' } as any)).toThrow(/non-empty string/)
        expect(() => createPyasTools({ pyas, subjectId: null } as any)).toThrow(/got null/)
    })

    it('refuses both at once', () => {
        expect(() => createPyasTools({ pyas, subjectId: 'user_42', allAccounts: true } as any)).toThrow(/not both/)
    })

    it('offers the app-wide tools only with allAccounts', () => {
        const person = createPyasTools({ pyas, subjectId: 'user_42' }).map((t) => t.name)
        const app = createPyasTools({ pyas, allAccounts: true }).map((t) => t.name)
        expect(app.length).toBeGreaterThan(person.length)
        expect(person).not.toContain('accounts_needing_attention')
    })
})

describe('which calendar a new event goes on', () => {
    const base = { title: 'Intro', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }
    const createFrom = (tools: ReturnType<typeof createPyasTools>) => tools.find((t) => t.name === 'create_event')!

    it('without a default, the model is told to ask when the person has several, and must name one', async () => {
        const create = createFrom(createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42' }))
        expect(create.description).toMatch(/more than one calendar account .* ask them which before calling this/)
        expect(await create.execute(base, approved)).toMatchObject({ ok: false, error: { code: 'TOOL_INVALID_INPUT' } })
        // Empty or null: no default.
        expect(createFrom(createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42', defaultAccountId: '' })).description).not.toMatch(/default calendar is/)
        expect(createFrom(createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42', defaultAccountId: null })).description).not.toMatch(/default calendar is/)
    })

    it("with the app's default, uses it when the model names none, and says not to ask", async () => {
        const { pyas, sent } = fakePyas()
        const create = createFrom(createPyasTools({ pyas, subjectId: 'user_42', defaultAccountId: 'acc_avery' }))
        expect(create.description).toContain("This person's default calendar is accountId acc_avery: use it unless they name another calendar, and don't ask which.")
        expect(await create.describe(base)).toMatchObject({ ok: true, details: { calendar: { accountId: 'acc_avery' } } })
        expect(await create.execute(base, approved)).toMatchObject({ ok: true })
        expect(sent.filter((s) => s.method === 'POST')).toEqual([expect.objectContaining({ path: '/v2/events', query: { accountId: 'acc_avery' } })])
    })

    it('marks the default in list_accounts', async () => {
        const list = createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42', defaultAccountId: 'acc_avery' }).find((t) => t.name === 'list_accounts')!
        expect(await list.execute({})).toMatchObject({ ok: true, data: { accounts: [expect.objectContaining({ accountId: 'acc_avery', isDefault: true })] } })
    })

    it("refuses a default that isn't the person's, as any other account", async () => {
        const { pyas, sent } = fakePyas()
        const create = createFrom(createPyasTools({ pyas, subjectId: 'user_42', defaultAccountId: 'acc_riley' }))
        expect(await create.execute(base, approved)).toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED' } })
        expect(sent.filter((s) => s.method === 'POST')).toEqual([])
    })

    it('goes with subjectId only: a default for every account means nothing', () => {
        expect(() => createPyasTools({ pyas: fakePyas().pyas, allAccounts: true, defaultAccountId: 'acc_avery' } as any)).toThrow(/goes with subjectId/)
    })
})

describe('what a change waiting for approval says', () => {
    const base = { title: 'Intro', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }

    it('names the calendar it lands on, from Pyas, with whose it is', async () => {
        const create = createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42' }).find((t) => t.name === 'create_event')!
        expect(await create.describe({ ...base, accountId: 'acc_avery' })).toMatchObject({
            ok: true,
            details: { calendar: { accountId: 'acc_avery', provider: 'pyas', email: 'avery@example.com', subjectId: 'user_42' } },
        })
    })

    it('names the Zoom account that makes the meeting', async () => {
        const create = createPyasTools({ pyas: fakePyas().pyas, allAccounts: true }).find((t) => t.name === 'create_event')!
        const described = await create.describe({ ...base, accountId: 'acc_avery', meeting: 'zoom', zoomAccountId: 'acc_zoom' })
        expect(described).toMatchObject({ ok: true, details: { calendar: { email: 'avery@example.com' }, zoomAccount: { accountId: 'acc_zoom', provider: 'zoom', email: 'ops@example.com' } } })
    })

    it("never describes someone else's calendar for a person's tools: the change is refused instead", async () => {
        const create = createPyasTools({ pyas: fakePyas().pyas, subjectId: 'user_42' }).find((t) => t.name === 'create_event')!
        expect(await create.describe({ ...base, accountId: 'acc_riley' })).toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED' } })
    })
})

describe('approval before a change', () => {
    const base = { accountId: 'acc_avery', title: 'Intro', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }

    it('is required by default for every tool that changes something, and for none that only read', () => {
        const tools = createPyasTools({ allAccounts: true, pyas: fakePyas().pyas, scope: ['read', 'write', 'developer'] })
        expect(tools.filter((t) => t.needsApproval).map((t) => t.name).sort()).toEqual(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name).sort())
        expect(tools.filter((t) => t.needsApproval).map((t) => t.name)).toEqual(expect.arrayContaining(['create_event', 'update_event', 'delete_event', 'respond_to_event']))
        expect(tools.find((t) => t.name === 'list_events')!.needsApproval).toBe(false)
    })

    it('sends nothing without the person\'s approval, and tells the model so', async () => {
        const { pyas, sent } = fakePyas()
        const tools = createPyasTools({ allAccounts: true, pyas })
        expect(await tools.find((t) => t.name === 'create_event')!.execute(base)).toEqual({ ok: false, error: expect.objectContaining({ code: 'TOOL_APPROVAL_REQUIRED' }) })
        expect(await tools.find((t) => t.name === 'delete_event')!.execute({ accountId: 'acc_avery', eventId: 'evt_1' }, { approved: false })).toMatchObject({ ok: false, error: { code: 'TOOL_APPROVAL_REQUIRED' } })
        expect(sent).toEqual([])
        expect(await tools.find((t) => t.name === 'create_event')!.execute(base, approved)).toMatchObject({ ok: true })
        expect(sent).toHaveLength(1)
    })

    it('checks the input first, so the person is never asked to approve a call that cannot run', async () => {
        const create = createPyasTools({ allAccounts: true, pyas: fakePyas().pyas }).find((t) => t.name === 'create_event')!
        expect(await create.execute({ accountId: 'acc_avery' })).toMatchObject({ ok: false, error: { code: 'TOOL_INVALID_INPUT' } })
    })

    it('can be turned off by an app that asks the person itself', async () => {
        const { pyas, sent } = fakePyas()
        const tools = createPyasTools({ allAccounts: true, pyas, requireApproval: false })
        expect(tools.some((t) => t.needsApproval)).toBe(false)
        expect(await tools.find((t) => t.name === 'create_event')!.execute(base)).toMatchObject({ ok: true })
        expect(sent).toHaveLength(1)
    })
})
