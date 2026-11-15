/**
 * Tools for building an app on Pyas, for people who build with an AI tool and may never read
 * the code: where their setup stands, the app and where it may run, a test key, a webhook, and
 * what is left before going live. They work on /v2/manage, so what each may do is the API's
 * decision: a person signed in to Pyas with `manage` changes the app, `keys:test` adds test
 * keys, and an API key only reads its own app.
 *
 * Every answer ends with the next step in plain words. Live keys, plans and payment are never
 * handled here: the answer links to the dashboard, where the person does them.
 */
import type { ManageApp, Pyas } from '@pyas/sdk'
import { z } from 'zod'
import { RECIPE_PLATFORMS, RECIPE_TASKS, recipeFor, recipeText } from './recipes'

export interface SetupAccess {
    /** The app this connection works on; without one, the only app the caller can reach, or the one named. */
    appId?: string
    /** What the person allowed: `manage` to change the app, `keys:test` for test keys. A key has neither. */
    scopes: string[]
}

export interface SetupTool {
    name: string
    title: string
    description: string
    input: Record<string, z.ZodTypeAny>
    annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
    /** The scope it needs; none: anyone who can read the app. */
    needs?: 'manage' | 'keys:test'
    run(pyas: Pyas, access: SetupAccess, input: any): Promise<{ text: string; data: Record<string, unknown> }>
}

const appIdInput = { appId: z.string().optional().describe('The app, when you can reach more than one. Leave it out to use this connection\'s app.') }

/** The app to work on: the connection's own, the one asked for, or the only one there is. */
const appOf = async (pyas: Pyas, access: SetupAccess, asked?: string): Promise<string> => {
    if (access.appId) return access.appId
    if (asked) return asked
    const apps = await pyas.manage.apps.list()
    if (apps.items.length === 1) return apps.items[0].appId
    if (!apps.items.length) throw new TypeError('There is no app yet. Create one with create_app.')
    throw new TypeError(`Name the app with appId. Yours: ${apps.items.map((a) => `${a.name} (${a.appId})`).join(', ')}.`)
}

const checklist = (app: ManageApp) => app.setup.steps.map((step) => `${step.done ? '[x]' : '[ ]'} ${step.text}`).join('\n')

const read = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
const change = (title: string) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })

/** Where people keep a secret on the platforms vibe coders use, for "store it as a secret". */
const SECRET_HOMES = 'In Lovable or Bolt with Supabase, an Edge Function secret; in Replit, Secrets; on Vercel or Netlify, an environment variable; locally, a .env file that git ignores'

export const SETUP_TOOLS: SetupTool[] = [
    {
        name: 'setup_status',
        title: 'Check setup',
        description: 'Where the app\'s setup stands: what is done, what is left, and the next step. Use it first, and after each change.',
        input: appIdInput,
        annotations: read('Check setup'),
        async run(pyas, access, input) {
            const app = await pyas.manage.apps.get({ appId: await appOf(pyas, access, input.appId) })
            return {
                text: `${app.name} (${app.appId})\nAllowed origins: ${app.allowedOrigins.join(', ') || 'none yet'}\n\n${checklist(app)}\n\nNext step: ${app.setup.nextStep}`,
                data: { app, nextStep: app.setup.nextStep },
            }
        },
    },
    {
        name: 'create_app',
        title: 'Create an app',
        description: 'Creates a Pyas app. Give the address the app runs at (its preview URL) in allowedOrigins, so the calendar connection dialog opens there.',
        input: {
            name: z.string().min(1).max(100).describe('The app\'s name, as people will see it.'),
            allowedOrigins: z.array(z.string()).optional().describe('Addresses the app runs at, such as its preview URL. Each is cut to its origin.'),
            description: z.string().max(500).optional(),
        },
        annotations: change('Create an app'),
        needs: 'manage',
        async run(pyas, access, input) {
            const app = await pyas.manage.apps.create({ name: input.name, ...(input.allowedOrigins ? { allowedOrigins: input.allowedOrigins } : {}), ...(input.description ? { description: input.description } : {}) })
            const held = access.appId && access.appId !== app.appId
            return {
                text: [
                    `Created ${app.name} (${app.appId}).`,
                    held
                        ? 'This connection works with another app. To work on the new one here, the person disconnects this tool on their Pyas profile and connects it again, choosing the new app.'
                        : `Next step: ${app.setup.nextStep}`,
                ].join('\n'),
                data: { app, nextStep: held ? 'Connect again and choose the new app.' : app.setup.nextStep },
            }
        },
    },
    {
        name: 'update_app',
        title: 'Update the app',
        description: 'Changes the app\'s name, description or website, or adds addresses it may run at (allowed origins). A page address, such as a preview URL, is cut to its origin.',
        input: {
            ...appIdInput,
            name: z.string().min(1).max(100).optional(),
            description: z.string().max(500).optional(),
            websiteUrl: z.string().max(2048).optional(),
            addAllowedOrigins: z.array(z.string()).optional().describe('Addresses to add, such as https://my-app.lovable.app or a preview URL.'),
        },
        annotations: change('Update the app'),
        needs: 'manage',
        async run(pyas, access, input) {
            const { appId: asked, ...changes } = input
            const app = await pyas.manage.apps.update({ appId: await appOf(pyas, access, asked), ...changes })
            return {
                text: `Saved ${app.name}. Allowed origins: ${app.allowedOrigins.join(', ') || 'none'}.\n\nNext step: ${app.setup.nextStep}`,
                data: { app, nextStep: app.setup.nextStep },
            }
        },
    },
    {
        name: 'get_test_key',
        title: 'Get a test key',
        description: 'Creates a test key for the app\'s sandbox and returns it once. It goes in a secret where the app\'s server code runs, never in code that runs in the browser.',
        input: { ...appIdInput, name: z.string().max(100).optional().describe('A name to tell the key apart in the dashboard.') },
        annotations: change('Get a test key'),
        needs: 'keys:test',
        async run(pyas, access, input) {
            const made = await pyas.manage.keys.createTest({ appId: await appOf(pyas, access, input.appId), ...(input.name ? { name: input.name } : {}) })
            const next = `Store it as the secret PYAS_API_KEY where the app's server code runs (${SECRET_HOMES}). Never put it in browser code. It works only in the sandbox; a live key is created by the person in the Pyas dashboard.`
            return { text: `Test key: ${made.value}\n\nNext step: ${next}`, data: { key: made.key, value: made.value, nextStep: next } }
        },
    },
    {
        name: 'create_webhook',
        title: 'Add a webhook',
        description: 'Adds a webhook endpoint in the app\'s sandbox, returns its signing secret once, and sends it a test delivery. Live endpoints are added by the person in the Pyas dashboard.',
        input: {
            ...appIdInput,
            url: z.string().url().describe('The endpoint\'s HTTPS address, on the app\'s server.'),
            events: z.array(z.string()).optional().describe('Event types to receive (all when left out), such as event.created.'),
        },
        annotations: change('Add a webhook'),
        needs: 'manage',
        async run(pyas, access, input) {
            const appId = await appOf(pyas, access, input.appId)
            const made = await pyas.manage.webhooks.create({ appId, url: input.url, ...(input.events ? { events: input.events } : {}) })
            const test = await pyas.manage.webhooks.test({ appId, webhookId: made.webhookId }).catch((error: Error) => ({ delivered: false, error: error.message }))
            const next = test.delivered
                ? `Store the signing secret as PYAS_WEBHOOK_SECRET (${SECRET_HOMES}) and check that the handler verifies each delivery's Pyas-Signature header with it.`
                : `The test delivery did not reach ${made.url}. Check that the address is public and the handler answers 2xx, then store the signing secret as PYAS_WEBHOOK_SECRET and run setup_status.`
            return {
                text: `Added ${made.url} (${made.webhookId}) in the sandbox.\nSigning secret: ${made.signingSecret.value}\nTest delivery: ${test.delivered ? 'delivered' : 'not delivered'}\n\nNext step: ${next}`,
                data: { webhook: made, testDelivery: test, nextStep: next },
            }
        },
    },
    {
        name: 'get_recipe',
        title: 'Get code for a task',
        description: 'The code for one task on the platform the app is built on (Lovable, Bolt, Replit, v0, Base44, Next.js or Express): each file and where it goes, the packages, the secret to set, and the steps. The key stays in server code; the browser calls the app\'s own server.',
        input: {
            platform: z.enum(RECIPE_PLATFORMS).describe('Where the app is built: lovable (a project with src/routes/, on TanStack Start: every Lovable project since May 2026), lovable-vite (an older Lovable project with supabase/functions/), bolt, replit, v0, base44 (backend functions, on the Builder plan and above), nextjs or express.'),
            task: z.enum(RECIPE_TASKS).describe('connect-calendar (a button to connect Google or Outlook), list-events, book (a meeting at a free time) or receive-webhooks.'),
        },
        annotations: read('Get code for a task'),
        async run(_pyas, _access, input) {
            const recipe = recipeFor(input.platform, input.task)
            return { text: recipeText(recipe), data: { recipe, nextStep: recipe.nextStep } }
        },
    },
    {
        name: 'go_live_checklist',
        title: 'Check what is left to go live',
        description: 'What is left before the app works with real people\'s calendars, and the dashboard link where the person does the rest: choosing a plan, a live key, a live webhook.',
        input: appIdInput,
        annotations: read('Check what is left to go live'),
        async run(pyas, access, input) {
            const app = await pyas.manage.apps.get({ appId: await appOf(pyas, access, input.appId) })
            const left = app.setup.steps.filter((step) => !step.done)
            const next = left.length
                ? `The person finishes these in the Pyas dashboard: ${app.dashboardUrl}. Plans, payment and live keys are done there, not through this tool.`
                : 'The app is live.'
            return {
                text: [`${app.name}: ${left.length ? `${left.length} thing${left.length === 1 ? '' : 's'} left` : 'nothing left'}.`, ...left.map((step) => `[ ] ${step.text}`), '', `Next step: ${next}`].join('\n'),
                data: { left, dashboardUrl: app.dashboardUrl, nextStep: next },
            }
        },
    },
]

/** The tools a connection may use: reading for everyone, changes only with what the person allowed. */
export const setupToolsFor = (access: SetupAccess) => SETUP_TOOLS.filter((tool) => !tool.needs || access.scopes.includes(tool.needs))
