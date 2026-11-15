import { Pyas } from '@pyas/sdk'
import { generateText, type ModelMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPyasTools } from '../src'
import { pyasAnthropicTools, runPyasToolUses } from '../src/anthropic'
import { pyasToolkit } from '../src/langchain'
import { pyasFunctionDefinitions, runPyasToolCalls } from '../src/openai'
import { pyasTools } from '../src/vercel'
import { API_URL, keys } from '../../sdk/e2e/target'

/**
 * The tools of every adapter against the real API's sandbox, with a test key (the SDK suite's
 * setup starts the API: ../../sdk/e2e/globalSetup.ts). A fake model stands in for the LLM: what
 * is tested is what reaches the API and what comes back.
 */
const state = keys()
const pyas = new Pyas({ apiKey: state.testKey, baseUrl: API_URL })

const day = 86_400_000
const at = (days: number, hour: number) => { const d = new Date(Date.now() + days * day); d.setUTCHours(hour, 0, 0, 0); return d.toISOString() }
const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
}

let avery: { accountId: string; subjectId: string }
let riley: { accountId: string; subjectId: string }

describe('the AI framework tools against the sandbox', () => {
    beforeAll(async () => {
        const accounts = (await pyas.accounts.list({ limit: 100 })).data as any[]
        avery = accounts.find((a) => a.name === 'Avery Brooks')
        riley = accounts.find((a) => a.name === 'Riley Chen')
        expect(avery?.subjectId).toBeTruthy()
    })

    it('Vercel AI SDK: a model\'s create_event call waits for approval, then books the event in the sandbox', async () => {
        const model = new MockLanguageModelV4({
            doGenerate: async () => ({
                content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'create_event', input: JSON.stringify({ accountId: avery.accountId, title: 'Vercel e2e call', startsAt: at(2, 15), endsAt: at(2, 16) }) }],
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage,
                warnings: [],
            }),
        })
        const tools = pyasTools({ apiKey: state.testKey, baseUrl: API_URL, subjectId: avery.subjectId })
        const prompt: ModelMessage[] = [{ role: 'user', content: 'Book it.' }]
        const result = await generateText({ model, tools, messages: prompt })
        const request = result.content.find((part) => part.type === 'tool-approval-request') as any
        expect(request).toBeDefined()
        const booked = async () => (await pyas.events.list({ accountId: avery.accountId, from: at(2, 0), to: at(3, 0) })).data.filter((e: any) => e.title === 'Vercel e2e call')
        // Waiting for the person: nothing on the calendar yet.
        expect(await booked()).toEqual([])

        const done = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: 'Booked.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }) })
        const approve: ModelMessage = { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: request.approvalId, approved: true }] }
        await generateText({ model: done, tools, messages: [...prompt, ...result.response.messages, approve] })
        const [created] = (await booked()) as any[]
        expect(created).toMatchObject({ title: 'Vercel e2e call', id: expect.any(String) })
        const event = await pyas.events.get({ accountId: avery.accountId, eventId: created.id })
        expect(event.title).toBe('Vercel e2e call')
        await pyas.events.delete({ accountId: avery.accountId, eventId: created.id })
    })

    it('LangChain: list_events finds the sandbox\'s week of events, for the bound person only', async () => {
        const tools = pyasToolkit({ apiKey: state.testKey, baseUrl: API_URL, subjectId: avery.subjectId, readOnly: true })
        const list = tools.find((t) => t.name === 'list_events')!
        const mine = JSON.parse(String(await list.invoke({ from: at(-1, 0), to: at(7, 0) })))
        expect(mine.events.length).toBeGreaterThan(0)
        const theirs = JSON.parse(String(await list.invoke({ accountId: riley.accountId, from: at(-1, 0), to: at(7, 0) })))
        expect(theirs.error.code).toBe('TOOL_ACCOUNT_NOT_ALLOWED')
    })

    it('OpenAI: find_meeting_times across two people', async () => {
        const options = { allAccounts: true as const, apiKey: state.testKey, baseUrl: API_URL, scope: ['availability' as const] }
        expect(pyasFunctionDefinitions(options).map((t) => t.function.name).sort()).toEqual(['find_meeting_times', 'get_free_busy'])
        const { results: [message] } = await runPyasToolCalls([{ id: 'call_1', type: 'function', function: { name: 'find_meeting_times', arguments: JSON.stringify({ accountIds: [avery.accountId, riley.accountId], from: at(1, 0), to: at(6, 0), durationMinutes: 30 }) } }], options)
        const { slots } = JSON.parse(message.content)
        expect(slots.length).toBeGreaterThan(0)
        expect(slots[0]).toMatchObject({ startsAt: expect.any(String), endsAt: expect.any(String) })
    })

    it('Anthropic: an error comes back as the API\'s code, hint and trace id, marked is_error', async () => {
        const options = { allAccounts: true as const, apiKey: state.testKey, baseUrl: API_URL }
        expect(pyasAnthropicTools(options).map((t) => t.name)).toContain('get_event')
        const { results: [result] } = await runPyasToolUses([{ type: 'tool_use', id: 'tu_1', name: 'get_event', input: { accountId: avery.accountId, eventId: 'evt_does_not_exist' } }], options)
        expect(result.is_error).toBe(true)
        const { error } = JSON.parse(result.content)
        expect(error).toMatchObject({ code: expect.stringMatching(/NOT_FOUND/), hint: expect.any(String), traceId: expect.stringMatching(/^trc_/) })
    })

    it('the sandbox tool, with a test key and the developer scope', async () => {
        const sandbox = createPyasTools({ allAccounts: true, apiKey: state.testKey, baseUrl: API_URL, scope: ['developer'] }).find((t) => t.name === 'sandbox')!
        const result = await sandbox.execute({})
        expect(result).toMatchObject({ ok: true, data: { accounts: expect.any(Array) } })
    })
})
