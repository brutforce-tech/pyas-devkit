import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'
import { pyasAnthropicTools, runPyasToolUses } from '../src/anthropic'
import { fakePyas } from './fake'

describe('the Anthropic tools', () => {
    it('are tool definitions with an object input_schema, no key needed', () => {
        const tools: Tool[] = pyasAnthropicTools({ subjectId: 'user_42', readOnly: true })
        const list = tools.find((t) => t.name === 'list_events')!
        expect(list.description).toContain('Lists events between two times')
        expect(list.input_schema).toMatchObject({ type: 'object', required: ['from', 'to'] })
        expect(Object.keys(list.input_schema.properties as object)).not.toContain('subjectId')
        expect(tools.map((t) => t.name)).not.toContain('delete_event')
    })

    it('runs tool_use blocks through the SDK, returning tool_result blocks', async () => {
        const { pyas, sent } = fakePyas()
        const content = [
            { type: 'text' },
            { type: 'tool_use', id: 'tu_1', name: 'delete_event', input: { accountId: 'acc_avery', eventId: 'evt_1' } },
            { type: 'tool_use', id: 'tu_2', name: 'get_event', input: { accountId: 'acc_riley', eventId: 'evt_1' } },
        ]
        // The read runs; the deletion waits for the person, and nothing is deleted yet.
        const first = await runPyasToolUses(content, { pyas, subjectId: 'user_42' })
        expect(first.results).toEqual([{ type: 'tool_result', tool_use_id: 'tu_2', content: expect.stringContaining('TOOL_ACCOUNT_NOT_ALLOWED'), is_error: true }])
        expect(first.pending).toEqual([{ id: 'tu_1', tool: 'delete_event', title: 'Delete an event', input: { accountId: 'acc_avery', eventId: 'evt_1' }, event: expect.objectContaining({ title: 'Design review' }), calendar: expect.objectContaining({ accountId: 'acc_avery', email: 'avery@example.com' }), call: content[1] }])
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])

        const { results } = await runPyasToolUses(first.pending.map((change) => change.call), { pyas, subjectId: 'user_42', approved: ['tu_1'] })
        expect([...results, ...first.results]).toEqual([
            { type: 'tool_result', tool_use_id: 'tu_1', content: JSON.stringify({ deleted: 'evt_1' }) },
            { type: 'tool_result', tool_use_id: 'tu_2', content: expect.stringContaining('TOOL_ACCOUNT_NOT_ALLOWED'), is_error: true },
        ])
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([expect.objectContaining({ path: '/v2/events/evt_1', query: { accountId: 'acc_avery' } })])
    })
})
