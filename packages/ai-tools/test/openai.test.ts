import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { describe, expect, it } from 'vitest'
import { pyasFunctionDefinitions, runPyasFunctionCalls, runPyasToolCalls } from '../src/openai'
import { fakePyas } from './fake'

describe('the OpenAI function definitions', () => {
    it('are Chat Completions tools with JSON Schema parameters, no key needed', () => {
        const tools: ChatCompletionTool[] = pyasFunctionDefinitions({ subjectId: 'user_42' })
        const create = tools.find((t) => t.type === 'function' && t.function.name === 'create_event') as any
        expect(create.function.description).toContain('Creates a new event')
        expect(create.function.parameters).toMatchObject({ type: 'object', properties: { accountId: { type: 'string' }, attendees: { type: 'array' } }, required: expect.arrayContaining(['accountId', 'title']) })
        expect(create.function.parameters.$schema).toBeUndefined()
        expect(JSON.stringify(tools)).not.toContain('accounts_needing_attention')
    })

    it('come in the Responses API\'s shape too', () => {
        const tools: FunctionTool[] = pyasFunctionDefinitions({ allAccounts: true, api: 'responses', scope: ['events:read'] })
        expect(tools.map((t) => t.name).sort()).toEqual(['get_event', 'list_events'])
        expect(tools[0]).toMatchObject({ type: 'function', strict: false, parameters: { type: 'object' } })
    })

    it('runs Chat Completions tool calls through the SDK, and leaves other tools\' calls alone', async () => {
        const { pyas, sent } = fakePyas()
        const { results: messages, pending } = await runPyasToolCalls([
            { id: 'call_1', type: 'function', function: { name: 'list_events', arguments: JSON.stringify({ accountId: 'acc_avery', from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z' }) } },
            { id: 'call_2', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
            { id: 'call_3', type: 'function', function: { name: 'get_event', arguments: 'not json' } },
        ], { allAccounts: true, pyas })
        expect(messages).toEqual([
            { role: 'tool', tool_call_id: 'call_1', content: expect.stringContaining('"evt_1"') },
            { role: 'tool', tool_call_id: 'call_3', content: expect.stringContaining('TOOL_INVALID_INPUT') },
        ])
        expect(pending).toEqual([])
        expect(sent).toHaveLength(1)
    })

    it('runs a change only once the person approves it: until then it is pending, and nothing is sent', async () => {
        const { pyas, sent } = fakePyas()
        const create = { id: 'call_c', type: 'function', function: { name: 'create_event', arguments: JSON.stringify({ accountId: 'acc_avery', title: 'Intro call', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }) } }
        const remove = { id: 'call_d', type: 'function', function: { name: 'delete_event', arguments: JSON.stringify({ accountId: 'acc_avery', eventId: 'evt_1' }) } }
        const list = { id: 'call_l', type: 'function', function: { name: 'list_events', arguments: JSON.stringify({ accountId: 'acc_avery', from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z' }) } }
        const first = await runPyasToolCalls([list, create, remove], { allAccounts: true, pyas })
        expect(first.results.map((r) => r.tool_call_id)).toEqual(['call_l'])
        expect(first.pending).toEqual([
            { id: 'call_c', tool: 'create_event', title: 'Create an event', input: expect.objectContaining({ title: 'Intro call' }), calendar: expect.objectContaining({ accountId: 'acc_avery', email: 'avery@example.com' }), call: create },
            // The event as it is in Pyas, so the person sees what the deletion is really about.
            { id: 'call_d', tool: 'delete_event', title: 'Delete an event', input: { accountId: 'acc_avery', eventId: 'evt_1' }, event: expect.objectContaining({ id: 'evt_1', title: 'Design review' }), calendar: expect.objectContaining({ accountId: 'acc_avery', email: 'avery@example.com' }), call: remove },
        ])
        // Reads only: the events listed, the event to delete and each change's calendar looked up.
        expect(sent.filter((s) => s.method !== 'GET')).toEqual([])

        // The person approves the new event and declines the deletion.
        const second = await runPyasToolCalls(first.pending.map((change) => change.call), { allAccounts: true, pyas, approved: ['call_c'], declined: ['call_d'] })
        expect(second.pending).toEqual([])
        expect(second.results).toEqual([
            { role: 'tool', tool_call_id: 'call_c', content: expect.stringContaining('"evt_new"') },
            { role: 'tool', tool_call_id: 'call_d', content: expect.stringContaining('TOOL_DECLINED') },
        ])
        expect(sent.filter((s) => s.method !== 'GET').map((s) => s.method)).toEqual(['POST'])
    })

    it('refuses at once a change that could never run, without asking: someone else\'s account, or no such event', async () => {
        const { pyas, sent } = fakePyas()
        const { results, pending } = await runPyasToolCalls([
            { id: 'call_r', function: { name: 'delete_event', arguments: JSON.stringify({ accountId: 'acc_riley', eventId: 'evt_1' }) } },
            { id: 'call_m', function: { name: 'delete_event', arguments: JSON.stringify({ accountId: 'acc_avery', eventId: 'evt_missing' }) } },
        ], { pyas, subjectId: 'user_42' })
        expect(pending).toEqual([])
        expect(results).toEqual([
            { role: 'tool', tool_call_id: 'call_r', content: expect.stringContaining('TOOL_ACCOUNT_NOT_ALLOWED') },
            { role: 'tool', tool_call_id: 'call_m', content: expect.stringContaining('RESOURCE_NOT_FOUND') },
        ])
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])
    })

    it('does not ask about a call that cannot run: invalid input comes back at once', async () => {
        const { pyas, sent } = fakePyas()
        const { results, pending } = await runPyasToolCalls([{ id: 'call_x', function: { name: 'create_event', arguments: JSON.stringify({ accountId: 'acc_avery' }) } }], { allAccounts: true, pyas })
        expect(pending).toEqual([])
        expect(results[0].content).toContain('TOOL_INVALID_INPUT')
        expect(sent).toEqual([])
    })

    it('runs Responses API function calls', async () => {
        const { pyas } = fakePyas()
        const { results: outputs } = await runPyasFunctionCalls([{ type: 'function_call', call_id: 'fc_1', name: 'get_event', arguments: JSON.stringify({ accountId: 'acc_avery', eventId: 'evt_missing' }) }], { allAccounts: true, pyas })
        expect(outputs).toEqual([{ type: 'function_call_output', call_id: 'fc_1', output: expect.stringContaining('RESOURCE_NOT_FOUND') }])
    })

    it('holds a Responses API change for approval too', async () => {
        const { pyas, sent } = fakePyas()
        const call = { type: 'function_call', call_id: 'fc_d', name: 'delete_event', arguments: JSON.stringify({ accountId: 'acc_avery', eventId: 'evt_1' }) }
        const first = await runPyasFunctionCalls([call], { allAccounts: true, pyas })
        expect(first).toEqual({ results: [], pending: [expect.objectContaining({ id: 'fc_d', tool: 'delete_event', call })] })
        const second = await runPyasFunctionCalls([call], { allAccounts: true, pyas, approved: ['fc_d'] })
        expect(second.results).toEqual([{ type: 'function_call_output', call_id: 'fc_d', output: JSON.stringify({ deleted: 'evt_1' }) }])
        expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(1)
    })
})
