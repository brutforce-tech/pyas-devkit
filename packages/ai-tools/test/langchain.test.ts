import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { Command, END, MemorySaver, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { describe, expect, it } from 'vitest'
import { pyasToolkit } from '../src/langchain'
import { fakePyas } from './fake'

describe('the LangChain tools', () => {
    it('are structured tools with a name, a description and a schema', () => {
        const tools = pyasToolkit({ allAccounts: true, pyas: fakePyas().pyas, readOnly: true })
        expect(tools.map((t) => t.name)).toContain('list_events')
        expect(tools.map((t) => t.name)).not.toContain('create_event')
        const list = tools.find((t) => t.name === 'list_events')!
        expect(list.description).toContain('Lists events between two times')
        expect(list.schema).toBeDefined()
    })

    it('run through LangChain\'s own invoke, which validates, and reach the API through the SDK', async () => {
        const { pyas, sent } = fakePyas()
        const list = pyasToolkit({ allAccounts: true, pyas }).find((t) => t.name === 'list_events')!
        const text = await list.invoke({ accountId: 'acc_avery', from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z' })
        expect(JSON.parse(String(text))).toEqual({ events: [expect.objectContaining({ id: 'evt_1' })] })
        expect(sent[0]).toMatchObject({ path: '/v2/events', query: { accountId: 'acc_avery' } })
        // LangChain refuses input that does not match the schema before the tool runs.
        await expect(list.invoke({ accountId: 'acc_avery' } as any)).rejects.toThrow()
        expect(sent).toHaveLength(1)
    })

    it('return the API\'s error as JSON for the model', async () => {
        const get = pyasToolkit({ allAccounts: true, pyas: fakePyas().pyas }).find((t) => t.name === 'get_event')!
        expect(JSON.parse(String(await get.invoke({ accountId: 'acc_avery', eventId: 'evt_missing' })))).toEqual({ error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }) })
    })
})

describe('approval in LangGraph', () => {
    const graphFor = (tools: ReturnType<typeof pyasToolkit>) => new StateGraph(MessagesAnnotation)
        .addNode('tools', new ToolNode(tools))
        .addEdge(START, 'tools')
        .addEdge('tools', END)
        .compile({ checkpointer: new MemorySaver() })
    const asks = (id: string, name: string, args: Record<string, unknown>) => ({ messages: [new AIMessage({ content: '', tool_calls: [{ id, name, args }] })] })
    const booking = { accountId: 'acc_avery', title: 'Intro call', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z' }

    it('pauses the graph at a change with what to show the person, and runs it once they approve', async () => {
        const { pyas, sent } = fakePyas()
        const graph = graphFor(pyasToolkit({ allAccounts: true, pyas }))
        const config = { configurable: { thread_id: 'approve' } }
        const paused: any = await graph.invoke(asks('call_c', 'create_event', booking), config)
        expect(paused.__interrupt__).toEqual([expect.objectContaining({ value: { type: 'pyas_approval', tool: 'create_event', title: 'Create an event', input: booking } })])
        expect(sent.filter((s) => s.method !== 'GET')).toEqual([])

        const done = await graph.invoke(new Command({ resume: { approved: true } }), config)
        const result = done.messages.at(-1) as ToolMessage
        expect(JSON.parse(String(result.content))).toMatchObject({ id: 'evt_new', title: 'Intro call' })
        expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1)
    })

    it('carries the event a change is about, as it is in Pyas, and refuses someone else\'s account without pausing', async () => {
        const { pyas, sent } = fakePyas()
        const graph = graphFor(pyasToolkit({ pyas, subjectId: 'user_42' }))
        const paused: any = await graph.invoke(asks('call_d', 'delete_event', { accountId: 'acc_avery', eventId: 'evt_1' }), { configurable: { thread_id: 'event' } })
        expect(paused.__interrupt__[0].value).toMatchObject({ tool: 'delete_event', event: { id: 'evt_1', title: 'Design review' } })
        const refused: any = await graph.invoke(asks('call_r', 'delete_event', { accountId: 'acc_riley', eventId: 'evt_1' }), { configurable: { thread_id: 'refused' } })
        expect(refused.__interrupt__).toBeUndefined()
        expect(String(refused.messages.at(-1).content)).toContain('TOOL_ACCOUNT_NOT_ALLOWED')
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])
    })

    it('tells the model a declined change was declined, and sends nothing', async () => {
        const { pyas, sent } = fakePyas()
        const graph = graphFor(pyasToolkit({ allAccounts: true, pyas }))
        const config = { configurable: { thread_id: 'decline' } }
        await graph.invoke(asks('call_d', 'delete_event', { accountId: 'acc_avery', eventId: 'evt_1' }), config)
        const done = await graph.invoke(new Command({ resume: { approved: false } }), config)
        expect(String((done.messages.at(-1) as ToolMessage).content)).toContain('TOOL_DECLINED')
        expect(sent.filter((s) => s.method === 'DELETE')).toEqual([])
    })

    it('never runs a change outside a graph, where nobody can be asked', async () => {
        const { pyas, sent } = fakePyas()
        const create = pyasToolkit({ allAccounts: true, pyas }).find((t) => t.name === 'create_event')!
        await expect(create.invoke(booking)).rejects.toThrow()
        expect(sent.filter((s) => s.method !== 'GET')).toEqual([])
    })

    it('runs reads without pausing, and changes too when the app asks the person itself', async () => {
        const { pyas, sent } = fakePyas()
        const graph = graphFor(pyasToolkit({ allAccounts: true, pyas, requireApproval: false }))
        const done: any = await graph.invoke(asks('call_c', 'create_event', booking), { configurable: { thread_id: 'off' } })
        expect(done.__interrupt__).toBeUndefined()
        expect(sent.filter((s) => s.method === 'POST')).toHaveLength(1)
    })
})
