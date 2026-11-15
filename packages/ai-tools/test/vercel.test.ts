import { generateText, type ModelMessage, type ToolSet } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { describePyasChange, pyasTools } from '../src/vercel'
import { fakePyas } from './fake'

const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
}

describe('the Vercel AI SDK tools', () => {
    it('are a ToolSet keyed by name, each with a description, an input schema and execute', () => {
        const tools: ToolSet = pyasTools({ allAccounts: true, pyas: fakePyas().pyas, scope: ['events:read'] })
        expect(Object.keys(tools).sort()).toEqual(['get_event', 'list_events'])
        expect(tools.list_events).toMatchObject({ description: expect.stringContaining('Lists events between two times'), execute: expect.any(Function) })
        expect(tools.list_events.inputSchema).toBeDefined()
    })

    it('run inside generateText: the model sees their JSON Schema, and its call reaches the API through the SDK', async () => {
        const { pyas, sent } = fakePyas()
        let offered: any[] = []
        const model = new MockLanguageModelV4({
            doGenerate: async (options: any) => {
                offered = options.tools ?? []
                return {
                    content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'create_event', input: JSON.stringify({ accountId: 'acc_avery', title: 'Intro call', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }) }],
                    finishReason: { unified: 'tool-calls', raw: undefined },
                    usage,
                    warnings: [],
                }
            },
        })
        const tools = pyasTools({ pyas, subjectId: 'user_42' })
        const prompt: ModelMessage[] = [{ role: 'user', content: 'Book an intro call tomorrow at 3pm.' }]
        const result = await generateText({ model, tools, messages: prompt })
        const create = offered.find((t) => t.name === 'create_event')
        expect(create.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['accountId', 'title', 'startsAt', 'endsAt']) })
        expect(offered.map((t) => t.name)).not.toContain('accounts_needing_attention')

        // The AI SDK stops at the change and asks for approval: nothing is sent yet.
        const request = result.content.find((part) => part.type === 'tool-approval-request') as any
        expect(request).toMatchObject({ toolCall: { toolName: 'create_event' } })
        expect(result.toolResults).toEqual([])
        expect(sent.filter((s) => s.method === 'POST')).toEqual([])

        // The person approves, and the next call runs it.
        const approve: ModelMessage = { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: request.approvalId, approved: true }] }
        let seen = ''
        const done = new MockLanguageModelV4({
            doGenerate: async (options: any) => {
                seen = JSON.stringify(options.prompt)
                return { content: [{ type: 'text', text: 'Booked.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
            },
        })
        await generateText({ model: done, tools, messages: [...prompt, ...result.response.messages, approve] })
        // The model reads the booked event as the tool's result.
        expect(seen).toContain('evt_new')
        expect(sent.find((s) => s.method === 'POST')).toMatchObject({ path: '/v2/events', query: { accountId: 'acc_avery' }, body: { title: 'Intro call' } })
    })

    it('mark every change as needing approval, and run a declined one never', async () => {
        const { pyas, sent } = fakePyas()
        const tools = pyasTools({ allAccounts: true, pyas })
        expect(Object.entries(tools).filter(([, t]) => t.needsApproval).map(([name]) => name)).toEqual(expect.arrayContaining(['create_event', 'update_event', 'delete_event', 'respond_to_event']))
        expect(tools.list_events.needsApproval).toBe(false)
        const model = new MockLanguageModelV4({
            doGenerate: async () => ({
                content: [{ type: 'tool-call', toolCallId: 'call_d', toolName: 'delete_event', input: JSON.stringify({ accountId: 'acc_avery', eventId: 'evt_1' }) }],
                finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [],
            }),
        })
        const prompt: ModelMessage[] = [{ role: 'user', content: 'Delete the design review.' }]
        const result = await generateText({ model, tools, messages: prompt })
        const request = result.content.find((part) => part.type === 'tool-approval-request') as any
        const decline: ModelMessage = { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: request.approvalId, approved: false }] }
        const done = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: 'Left it.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }) })
        await generateText({ model: done, tools, messages: [...prompt, ...result.response.messages, decline] })
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])
    })

    it('describe a change for the approval screen from Pyas\'s own data, checking the account as the tools do', async () => {
        const { pyas, sent } = fakePyas()
        const options = { pyas, subjectId: 'user_42' }
        expect(await describePyasChange({ tool: 'delete_event', input: { accountId: 'acc_avery', eventId: 'evt_1' } }, options))
            .toEqual({ ok: true, title: 'Delete an event', event: expect.objectContaining({ id: 'evt_1', title: 'Design review', startsAt: '2026-10-21T15:00:00Z' }), calendar: expect.objectContaining({ accountId: 'acc_avery', subjectId: 'user_42' }) })
        expect(await describePyasChange({ tool: 'create_event', input: { accountId: 'acc_avery', title: 'Intro', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' } }, options))
            .toEqual({ ok: true, title: 'Create an event', calendar: { accountId: 'acc_avery', provider: 'pyas', email: 'avery@example.com', name: null, subjectId: 'user_42' } })
        expect(await describePyasChange({ tool: 'delete_event', input: { accountId: 'acc_riley', eventId: 'evt_1' } }, options))
            .toMatchObject({ ok: false, error: { code: 'TOOL_ACCOUNT_NOT_ALLOWED' } })
        expect(await describePyasChange({ tool: 'list_events', input: {} }, options)).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_FOUND' } })
        expect(sent.filter((s) => s.method !== 'GET')).toEqual([])
    })

    it('title an update by what it does, for the approval card', async () => {
        const options = { pyas: fakePyas().pyas, subjectId: 'user_42' }
        const titleOf = async (input: Record<string, unknown>) => {
            const described = await describePyasChange({ tool: 'update_event', input: { accountId: 'acc_avery', eventId: 'evt_1', ...input } }, options)
            return described.ok ? described.title : described.error.code
        }
        expect(await titleOf({ startsAt: '2026-10-21T16:30:00Z', endsAt: '2026-10-21T17:00:00Z' })).toBe('Move an event')
        expect(await titleOf({ meeting: 'meet' })).toBe('Add a video meeting')
        expect(await titleOf({ meeting: 'none' })).toBe('Remove the video meeting')
        expect(await titleOf({ title: 'Design sync' })).toBe('Update an event')
        expect(await titleOf({ title: 'Design sync', startsAt: '2026-10-21T16:30:00Z' })).toBe('Update an event')
    })

    it('run a change at once when the app asks the person itself (requireApproval: false)', async () => {
        const tools = pyasTools({ allAccounts: true, pyas: fakePyas().pyas, requireApproval: false })
        expect(tools.create_event.needsApproval).toBe(false)
    })

    it('give the model the API\'s error to act on', async () => {
        const tools = pyasTools({ allAccounts: true, pyas: fakePyas().pyas })
        const output = await tools.get_event.execute!({ accountId: 'acc_avery', eventId: 'evt_missing' }, { toolCallId: 'c', messages: [] } as any)
        expect(output).toEqual({ error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND', traceId: 'trc_fail' }) })
    })
})
