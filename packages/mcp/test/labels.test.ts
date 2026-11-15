import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPyasMcpServer } from '../src/server'

/** A sandbox server and a live one connected side by side: the agent can tell their tools apart. */

const connect = async (testMode: boolean) => {
    const server = createPyasMcpServer({ pyas: { testMode } as any, setup: false })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return client
}

const descriptionOf = (tools: Array<{ name: string; description?: string }>, name: string) => tools.find((tool) => tool.name === name)?.description ?? ''

describe('which calendars a server works on', () => {
    it('a test key: titled for the sandbox, and each calendar tool says so first', async () => {
        const client = await connect(true)
        expect(client.getServerVersion()?.title).toBe('Pyas (sandbox)')
        // Its icon and site, for the tools that show a server's (MCP 2025-11-25).
        expect(client.getServerVersion()).toMatchObject({ websiteUrl: 'https://pyas.io', icons: [{ src: 'https://mcp.pyas.io/icon.png', mimeType: 'image/png', sizes: ['256x256'] }, { src: 'https://mcp.pyas.io/icon-64.png' }, { src: 'https://mcp.pyas.io/icon.svg', mimeType: 'image/svg+xml' }] })
        expect(client.getInstructions()).toContain('Each calendar tool\'s description starts with "Sandbox:"')
        const { tools } = await client.listTools()
        for (const name of ['list_accounts', 'list_events', 'create_event', 'get_request', 'sandbox']) {
            expect(descriptionOf(tools, name), name).toMatch(/^Sandbox: works on test people and events only, never a real calendar\. \S/)
        }
        // These answer the same on either.
        expect(descriptionOf(tools, 'explain_error')).not.toMatch(/^Sandbox/)
        expect(descriptionOf(tools, 'api_reference')).not.toMatch(/^Sandbox/)
    })

    it('a live key: titled for live calendars, and each calendar tool says so first', async () => {
        const client = await connect(false)
        expect(client.getServerVersion()?.title).toBe('Pyas (live calendars)')
        expect(client.getInstructions()).toContain('If a Pyas sandbox server is connected too, use this one only when the user means real people\'s calendars')
        const { tools } = await client.listTools()
        for (const name of ['list_accounts', 'list_events', 'delete_event', 'get_free_busy']) {
            expect(descriptionOf(tools, name), name).toMatch(/^Live calendars: works on the real calendars people connected to the app\. \S/)
        }
        expect(descriptionOf(tools, 'explain_error')).not.toMatch(/^Live/)
    })
})

describe('what the server says about keys', () => {
    const instructionsOf = async (testMode: boolean, about?: string) => {
        const server = createPyasMcpServer({ pyas: { testMode } as any, setup: false, about })
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
        const client = new Client({ name: 'test', version: '1.0.0' })
        await Promise.all([server.connect(serverSide), client.connect(clientSide)])
        return client.getInstructions() ?? ''
    }

    it('names the key it runs with, when the person gave it one', async () => {
        expect(await instructionsOf(true)).toContain('This server uses a test key')
        expect(await instructionsOf(false)).toContain('This server uses a live key')
    })

    it('names no key on a connection the person signed in to (the hosted server), so a model never says they need one', async () => {
        const sandbox = await instructionsOf(true, 'You are connected to the Pyas app "Scheduler".')
        expect(sandbox).not.toMatch(/test key|live key/)
        expect(sandbox).toContain('The sandbox has sample people on Pyas calendars')
        const live = await instructionsOf(false, 'You are connected to the Pyas app "Scheduler".')
        expect(live).not.toMatch(/test key|live key/)
        expect(live).toContain('Changes affect real people\'s calendars')
    })
})
