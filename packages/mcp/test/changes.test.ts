import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPyasMcpServer, type ChangeDecision, type PendingChange } from '../src/server'

/** Changes to calendars with a `beforeChange` hook (the hosted server on real calendars): asked first, made only when allowed. */

const EVENT = { id: 'evt_1', title: 'Intro call', startsAt: '2026-11-10T15:00:00Z', endsAt: '2026-11-10T15:30:00Z', status: 'confirmed', attendees: [] }

const fakePyas = () => {
    const events = {
        create: vi.fn(async (input: any) => ({ ...EVENT, title: input.title })),
        get: vi.fn(async () => EVENT),
        delete: vi.fn(async () => undefined),
    }
    return { pyas: { events, accounts: {}, testMode: false } as any, events }
}

const connect = async (options: Record<string, unknown>) => {
    const server = createPyasMcpServer({ setup: false, ...options } as any)
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return client
}

const create = { accountId: 'acc_1', title: 'Intro call', startsAt: '2026-11-10T15:00:00Z', endsAt: '2026-11-10T15:30:00Z' }

describe('changes with a beforeChange hook', () => {
    it('asks before a change, never before a read, and makes the change only when allowed', async () => {
        const { pyas, events } = fakePyas()
        const asked: PendingChange[] = []
        let decision: ChangeDecision = { proceed: false, text: 'Not made yet. The person confirms it at https://app.pyas.io/oauth/confirm/c1.', data: { confirmUrl: 'https://app.pyas.io/oauth/confirm/c1' } }
        const client = await connect({ pyas, beforeChange: async (change: PendingChange) => { asked.push(change); return decision } })

        await client.callTool({ name: 'get_event', arguments: { accountId: 'acc_1', eventId: 'evt_1' } })
        expect(asked).toEqual([])

        const waiting = await client.callTool({ name: 'create_event', arguments: create }) as any
        expect(asked).toEqual([{ tool: 'create_event', title: 'Create an event', input: create }])
        expect(events.create).not.toHaveBeenCalled()
        expect(waiting.isError).toBeFalsy()
        expect(waiting.content[0].text).toContain('Not made yet')
        expect(waiting.structuredContent).toEqual({ confirmUrl: 'https://app.pyas.io/oauth/confirm/c1' })

        decision = { proceed: true }
        const made = await client.callTool({ name: 'create_event', arguments: create }) as any
        expect(events.create).toHaveBeenCalledTimes(1)
        expect(made.structuredContent).toMatchObject({ id: 'evt_1' })
    })

    it('sends a client that opens pages the confirm page itself, as a URL elicitation', async () => {
        const { pyas, events } = fakePyas()
        const client = await connect({
            pyas,
            beforeChange: async () => ({ proceed: false, text: 'Confirm this change in Pyas.', openUrl: { id: 'c2', url: 'https://app.pyas.io/oauth/confirm/c2', message: 'Confirm in Pyas: delete Intro call.' } }),
        })
        const error = await client.callTool({ name: 'delete_event', arguments: { accountId: 'acc_1', eventId: 'evt_1' } }).catch((thrown) => thrown)
        expect(error.code).toBe(-32042)
        expect(error.data.elicitations).toEqual([{ mode: 'url', elicitationId: 'c2', url: 'https://app.pyas.io/oauth/confirm/c2', message: 'Confirm in Pyas: delete Intro call.' }])
        expect(events.delete).not.toHaveBeenCalled()
    })

    it('read-only calendars offer the tools that change nothing', async () => {
        const { pyas } = fakePyas()
        const tools = (await (await connect({ pyas, calendar: 'read-only' })).listTools()).tools
        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_accounts', 'list_events', 'get_event', 'find_meeting_times']))
        expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true)
    })
})
