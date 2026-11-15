import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createPyasMcpServer } from '../src/server'
import type { SetupAccess } from '../src/setupTools'

/** The app setup tools as a host sees them, over a fake API: who is offered what, and what each answers. */

const APP = {
    appId: 'app-1', orgId: 'org-1', name: 'Booking page', description: '', websiteUrl: '', allowedOrigins: [] as string[],
    signIn: { google: 'pyas', microsoft: 'pyas', zoom: 'pyas' },
    setup: {
        steps: [
            { id: 'allowed_origins', done: false, text: 'Add the address your app runs at to the allowed origins.' },
            { id: 'test_key', done: true, text: 'Create a test key.' },
        ],
        nextStep: 'Add the address your app runs at to the allowed origins.',
    },
    dashboardUrl: 'https://app.pyas.io/org/apps/app-1',
}

const fakePyas = () => {
    const manage = {
        apps: {
            list: vi.fn(async () => ({ items: [{ appId: 'app-1', name: 'Booking page', orgId: 'org-1', orgName: 'Acme' }] })),
            get: vi.fn(async () => APP),
            create: vi.fn(async (input: any) => ({ ...APP, appId: 'app-2', name: input.name })),
            update: vi.fn(async (input: any) => ({ ...APP, allowedOrigins: input.addAllowedOrigins ?? [] })),
        },
        webhooks: {
            create: vi.fn(async (input: any) => ({ webhookId: 'wh_1', url: input.url, signingSecret: { last4: 'abcd', value: 'whsec_abcd' }, nextStep: '' })),
            test: vi.fn(async () => ({ delivered: true })),
            list: vi.fn(),
        },
        keys: { createTest: vi.fn(async () => ({ key: { keyId: 'k1' }, value: 'pyas_sk_test_new', nextStep: '' })), list: vi.fn() },
    }
    return { pyas: { manage, testMode: true } as any, manage }
}

const connect = async (setup: SetupAccess | false, pyas: any, extra: { calendar?: boolean; readOnly?: boolean } = {}) => {
    const server = createPyasMcpServer({ pyas, setup, ...extra })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return client
}

const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name)
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as any
    return { text: result.content.map((c: any) => c.text).join('\n') as string, data: result.structuredContent, isError: result.isError }
}

describe('the app setup tools', () => {
    it('offer reading to an API key, changes with manage, test keys with keys:test', async () => {
        const { pyas } = fakePyas()
        const key = await names(await connect({ scopes: [] }, pyas, { calendar: false }))
        expect(key.sort()).toEqual(['get_recipe', 'go_live_checklist', 'setup_status'])
        const manage = await names(await connect({ appId: 'app-1', scopes: ['manage'] }, pyas, { calendar: false }))
        expect(manage.sort()).toEqual(['create_app', 'create_webhook', 'get_recipe', 'go_live_checklist', 'setup_status', 'update_app'])
        const all = await names(await connect({ appId: 'app-1', scopes: ['manage', 'keys:test'] }, pyas, { calendar: false }))
        expect(all).toContain('get_test_key')
        // No tools at all: the server offers no tools/list.
        await expect(names(await connect(false, pyas, { calendar: false }))).rejects.toThrow('Method not found')
        expect((await names(await connect({ appId: 'app-1', scopes: ['manage'] }, pyas, { calendar: false, readOnly: true }))).sort()).toEqual(['get_recipe', 'go_live_checklist', 'setup_status'])
    })

    it('every tool is ready for a connector directory: a title, a description, and explicit read-only and destructive hints', async () => {
        const { pyas } = fakePyas()
        const tools = (await (await connect({ appId: 'app-1', scopes: ['manage', 'keys:test'] }, pyas)).listTools()).tools
        expect(tools.length).toBeGreaterThan(20)
        for (const tool of tools) {
            expect(tool.title, tool.name).toBeTruthy()
            expect(tool.annotations?.title, tool.name).toBe(tool.title)
            expect(tool.description?.length, tool.name).toBeGreaterThan(20)
            expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean')
            expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean')
            // A tool that deletes is never marked read-only.
            if (tool.annotations?.destructiveHint) expect(tool.annotations.readOnlyHint, tool.name).toBe(false)
        }
    })

    it('every answer ends with the next step, and works on the connection\'s app', async () => {
        const { pyas, manage } = fakePyas()
        const client = await connect({ appId: 'app-1', scopes: ['manage', 'keys:test'] }, pyas, { calendar: false })
        for (const [tool, args] of [
            ['setup_status', {}], ['update_app', { addAllowedOrigins: ['https://id-preview--1.lovable.app/x'] }], ['get_test_key', {}],
            ['create_webhook', { url: 'https://example.com/hooks' }], ['go_live_checklist', {}],
            ['get_recipe', { platform: 'lovable', task: 'connect-calendar' }],
        ] as const) {
            const answer = await call(client, tool, args)
            expect(answer.isError, tool).toBeFalsy()
            expect(answer.text, tool).toMatch(/Next step: .+$/)
            expect(answer.text, tool).not.toContain('—')
        }
        expect(manage.apps.update).toHaveBeenCalledWith({ appId: 'app-1', addAllowedOrigins: ['https://id-preview--1.lovable.app/x'] })
        expect(manage.apps.list).not.toHaveBeenCalled()
    })

    it('a test key goes in a server-side secret, never browser code; a live key stays in the dashboard', async () => {
        const { pyas } = fakePyas()
        const client = await connect({ appId: 'app-1', scopes: ['keys:test'] }, pyas, { calendar: false })
        const { text } = await call(client, 'get_test_key')
        expect(text).toContain('pyas_sk_test_new')
        expect(text).toContain('PYAS_API_KEY')
        expect(text).toContain('Never put it in browser code')
        expect(text).toContain('a live key is created by the person in the Pyas dashboard')
    })

    it('a webhook is tested as soon as it is added, and a failed test says what to check', async () => {
        const { pyas, manage } = fakePyas()
        manage.webhooks.test.mockResolvedValueOnce({ delivered: false })
        const client = await connect({ appId: 'app-1', scopes: ['manage'] }, pyas, { calendar: false })
        const { text } = await call(client, 'create_webhook', { url: 'https://example.com/hooks' })
        expect(manage.webhooks.test).toHaveBeenCalledWith({ appId: 'app-1', webhookId: 'wh_1' })
        expect(text).toContain('Test delivery: not delivered')
        expect(text).toContain('Check that the address is public')
    })

    it('going live is the person\'s, through the dashboard link', async () => {
        const { pyas } = fakePyas()
        const client = await connect({ appId: 'app-1', scopes: ['manage'] }, pyas, { calendar: false })
        const { text, data } = await call(client, 'go_live_checklist')
        expect(text).toContain('1 thing left')
        expect(data.dashboardUrl).toBe('https://app.pyas.io/org/apps/app-1')
        expect(text).toContain('Plans, payment and live keys are done there')
    })

    it('a new app made from a connection held to another app says how to switch', async () => {
        const { pyas } = fakePyas()
        const client = await connect({ appId: 'app-1', scopes: ['manage'] }, pyas, { calendar: false })
        const { text } = await call(client, 'create_app', { name: 'Second app' })
        expect(text).toContain('Created Second app (app-2).')
        expect(text).toContain('connects it again, choosing the new app')
    })

    it('without a connection\'s app, uses the only one, and asks which when there are several', async () => {
        const { pyas, manage } = fakePyas()
        const client = await connect({ scopes: [] }, pyas, { calendar: false })
        expect((await call(client, 'setup_status')).isError).toBeFalsy()
        expect(manage.apps.get).toHaveBeenCalledWith({ appId: 'app-1' })
        manage.apps.list.mockResolvedValueOnce({ items: [{ appId: 'a', name: 'A', orgId: 'o', orgName: '' }, { appId: 'b', name: 'B', orgId: 'o', orgName: '' }] })
        const asked = await call(client, 'setup_status')
        expect(asked.isError).toBe(true)
        expect(asked.text).toContain('Name the app with appId. Yours: A (a), B (b).')
    })
})
