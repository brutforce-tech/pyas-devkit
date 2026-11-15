/**
 * `/v2/manage`: an app's setup, for the CLI and AI tools. Signed in as a
 * person (`pyas login`, or a tool connected to Pyas), a call can change an
 * app's settings, add sandbox webhooks and create test keys; with an API key
 * it can only read its own app.
 *
 *   const pyas = new Pyas({ accessToken: () => session.token() })
 *   const apps = await pyas.manage.apps.list()
 */
import type { OperationSpec } from './generated/operations'
import type { RequestOptions } from './types'

const op = (method: OperationSpec['method'], path: string, body = false): OperationSpec => ({
    method,
    path,
    pathParams: [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
    query: [],
    lists: [],
    idempotent: false,
    ifMatch: false,
    body: body ? 'json' : null,
    result: 'json',
})

export const MANAGE_OPERATIONS = {
    'manage.apps.list': op('GET', '/v2/manage/apps'),
    'manage.apps.create': op('POST', '/v2/manage/apps', true),
    'manage.apps.get': op('GET', '/v2/manage/apps/{appId}'),
    'manage.apps.update': op('PATCH', '/v2/manage/apps/{appId}', true),
    'manage.webhooks.list': op('GET', '/v2/manage/apps/{appId}/webhooks'),
    'manage.webhooks.create': op('POST', '/v2/manage/apps/{appId}/webhooks', true),
    'manage.webhooks.test': op('POST', '/v2/manage/apps/{appId}/webhooks/{webhookId}/test', true),
    'manage.keys.list': op('GET', '/v2/manage/apps/{appId}/keys'),
    'manage.keys.createTest': op('POST', '/v2/manage/apps/{appId}/keys/test', true),
} as const satisfies Record<string, OperationSpec>

export type ManageOperationId = keyof typeof MANAGE_OPERATIONS

export interface ManageAppSummary {
    appId: string
    name: string
    orgId: string
    orgName: string
}

export interface SetupStep {
    id: 'allowed_origins' | 'first_call' | 'test_key' | 'webhook' | 'own_calendar' | 'signin' | 'live'
    done: boolean
    /** What to do, in plain words (or, for `signin`, how people sign in). */
    text: string
}

export interface ManageApp {
    appId: string
    orgId: string
    name: string
    description: string
    websiteUrl: string
    /** Where PyasConnect may open: origins like https://my-app.example.com, or https://*.lovable.app. */
    allowedOrigins: string[]
    /** Whose sign-in people see for each provider: Pyas Auth (`pyas`) or the app's own, Native Auth (`own`). */
    signIn: Record<'google' | 'microsoft' | 'zoom', 'pyas' | 'own'>
    setup: { steps: SetupStep[]; nextStep: string }
    dashboardUrl: string
}

export interface ManageWebhook {
    webhookId: string
    url: string
    description: string | null
    events: string[]
    status: string
    [field: string]: unknown
}

export interface ManageKey {
    keyId: string
    name: string
    mode: 'live' | 'test'
    scopes: string[]
    status: 'active' | 'rotating' | 'inactive' | 'revoked'
    last4: string | null
    expiresAt: string | null
    createdAt: string | null
    [field: string]: unknown
}

export interface ManageAppInput {
    name?: string
    description?: string
    websiteUrl?: string
    /** The whole list. A page's address is cut to its origin. */
    allowedOrigins?: string[]
}

export interface ManageResources {
    apps: {
        /** The apps you can reach, with their organizations. */
        list(options?: RequestOptions): Promise<{ items: ManageAppSummary[]; orgs?: Array<{ orgId: string; name: string }> }>
        /** A new app. `orgId` is needed only when you belong to more than one organization. */
        create(params: ManageAppInput & { name: string; orgId?: string }, options?: RequestOptions): Promise<ManageApp>
        /** The app, with its setup checklist and the next thing to do. */
        get(params: { appId: string }, options?: RequestOptions): Promise<ManageApp>
        /** Name, description, website and allowed origins. `addAllowedOrigins` adds to the list instead of replacing it. */
        update(params: ManageAppInput & { appId: string; addAllowedOrigins?: string[] }, options?: RequestOptions): Promise<ManageApp>
    }
    webhooks: {
        /** The app's sandbox webhook endpoints. */
        list(params: { appId: string }, options?: RequestOptions): Promise<{ items: ManageWebhook[] }>
        /** A sandbox endpoint. Its signing secret is returned this once. */
        create(params: { appId: string; url: string; events?: string[]; description?: string }, options?: RequestOptions): Promise<ManageWebhook & { signingSecret: { last4: string; value: string }; nextStep: string }>
        /** Sends a test delivery (`webhook.ping`, or the event type given). */
        test(params: { appId: string; webhookId: string; type?: string }, options?: RequestOptions): Promise<{ delivered: boolean; [field: string]: unknown }>
    }
    keys: {
        /** The app's keys, live and test, never their values. */
        list(params: { appId: string }, options?: RequestOptions): Promise<{ items: ManageKey[] }>
        /** A test key for the app's sandbox. Its value is returned this once. */
        createTest(params: { appId: string; name?: string }, options?: RequestOptions): Promise<{ key: ManageKey | null; value: string; nextStep: string }>
    }
}
