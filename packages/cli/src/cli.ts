#!/usr/bin/env node
/**
 * The Pyas CLI (`npx @pyas/cli`): the API from a terminal, for developers and their coding agents.
 * Every command takes --json (the data alone on stdout) and --yes (no questions). Exit codes:
 * 0 done, 1 the API said no or could not be reached, 2 the command was wrong.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { Pyas, PyasError, VERSION as SDK_VERSION, type Event } from '@pyas/sdk'
import { clearConfig, configPath, masked, readConfig, resolveAuth, writeConfig } from './config'
import { accessToken, DEFAULT_API_URL, finishDeviceLogin, LoginError, revokeSession, showCode, startDeviceLogin, type DeviceLogin } from './session'
import { scaffold, TEMPLATES } from './init'
import { createOut, report, table, UsageError, when, type Out } from './output'

export const VERSION = '1.0.0'

interface Ctx {
    args: string[]
    values: Record<string, any>
    out: Out
    pyas: () => Pyas
    /** For an app's setup (/v2/manage): the person signed in with pyas login, or read-only with the key. */
    manage: () => Pyas
}

type Options = NonNullable<ParseArgsConfig['options']>

interface Command {
    usage: string
    summary: string
    options?: Options
    run(ctx: Ctx): Promise<void>
}

const DAY = 86_400_000

const need = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || !value) throw new UsageError(`Missing ${name}.`)
    return value
}

const isoOr = (value: unknown, fallback: number): string => {
    if (value === undefined) return new Date(fallback).toISOString()
    const ms = Date.parse(String(value))
    if (!Number.isFinite(ms)) throw new UsageError(`Invalid date and time: ${value}. Use ISO 8601, for example 2026-10-21T15:00:00Z.`)
    return new Date(ms).toISOString()
}

const confirm = async (ctx: Ctx, question: string) => {
    if (ctx.values.yes) return true
    if (!process.stdin.isTTY) throw new UsageError(`${question} Pass --yes to confirm without a prompt.`)
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await rl.question(`${question} [y/N] `)
    rl.close()
    return /^y(es)?$/i.test(answer.trim())
}

/** Opens the page in the person's browser; when it cannot, the address printed above is enough. */
const openBrowser = (url: string) => {
    const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    try {
        spawn(command as string, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
    } catch {
        // Printed above.
    }
}

const apiUrlOf = (values: Record<string, any>) => String(values['api-url'] ?? readConfig().apiUrl ?? process.env.PYAS_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')

/** After the sign-in: what the person can now reach. */
const signedInSummary = async (ctx: Ctx, apiUrl: string) => {
    const apps = await ctx.manage().manage.apps.list()
    const orgs = new Set(apps.items.map((app) => app.orgId)).size
    ctx.out.data({ signedIn: true, apiUrl, apps: apps.items.length, organizations: orgs }, () => apps.items.length
        ? `Signed in. You can set up ${apps.items.length} app${apps.items.length === 1 ? '' : 's'}${orgs > 1 ? ` in ${orgs} organizations` : ''}. Run pyas apps list to see them.`
        : 'Signed in. You have no apps yet: run pyas apps create <name>.')
}

const stepLine = (step: { done: boolean; text: string }) => `  [${step.done ? 'x' : ' '}] ${step.text}`

const eventLine = (e: Event, zone?: string) => [e.id, `${when(e.startsAt, zone)}`, e.isAllDay ? 'all day' : `${Math.round((Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60_000)} min`, e.title || '(no title)']

const COMMANDS: Record<string, Command> = {
    init: {
        usage: `pyas init --template <${TEMPLATES.join('|')}> [dir]`,
        summary: 'Creates a starter app with the SDK, PyasConnect and webhook signature verification. A test key from pyas login or PYAS_API_KEY is written into its .env.',
        options: { template: { type: 'string' } },
        async run({ args, values, out }) {
            const template = values.template as string | undefined
            if (!template || !TEMPLATES.includes(template)) throw new UsageError(`Choose a template: pyas init --template <${TEMPLATES.join('|')}> [dir].`)
            const auth = resolveAuth()
            const result = scaffold({ template, dir: args[0] ?? `pyas-${template}`, apiKey: auth.apiKey, apiUrl: values['api-url'] ?? auth.apiUrl })
            out.data(result, () => [
                `Created ${result.dir} from the ${template} template.`,
                result.keyWritten
                    ? `Your test key ${result.keyWritten} is in ${result.envFile}, which .gitignore keeps out of git.`
                    : result.liveKeySkipped
                        ? `${result.envFile} has no key, because the CLI never writes a live key into a project. Set PYAS_API_KEY there yourself, or run pyas login with a test key and run init again.`
                        : `Set PYAS_API_KEY in ${result.envFile}. A test key (pyas_sk_test_...) works in your sandbox.`,
                '',
                'Next:',
                ...result.next.map((c) => `  ${c}`),
            ].join('\n'))
        },
    },
    login: {
        usage: 'pyas login [--no-browser] [--no-wait | --wait] [--api-url <url>]  |  pyas login --key <pyas_sk_...>',
        summary: 'Signs you in: the terminal shows a code, you enter it in the dashboard and approve, and the CLI can set up your apps. With --key, saves an API key instead (pass - to read it from stdin). Both are kept in your config folder, never in the project. For coding agents: --no-wait prints the code and returns, then pyas login --wait finishes once it is approved.',
        options: { key: { type: 'string' }, 'no-browser': { type: 'boolean' }, 'no-wait': { type: 'boolean' }, wait: { type: 'boolean' } },
        async run(ctx) {
            const { values, out } = ctx
            if (values.key === undefined) {
                if (values.wait) {
                    const pending = readConfig().pendingLogin
                    if (!pending) throw new UsageError('No sign-in is waiting. Run pyas login --no-wait first, or pyas login.')
                    await finishDeviceLogin(pending)
                    return signedInSummary(ctx, pending.apiUrl)
                }
                const login: DeviceLogin = await startDeviceLogin(apiUrlOf(values))
                const code = showCode(login.userCode)
                if (values['no-wait']) {
                    writeConfig({ ...readConfig(), pendingLogin: login })
                    out.data({ userCode: code, verificationUri: login.verificationUri, expiresAt: new Date(login.expiresAt).toISOString(), next: 'pyas login --wait' }, () => [
                        `Open ${login.verificationUri} and enter the code ${code}.`,
                        'Then run pyas login --wait. The code works for 10 minutes.',
                    ].join('\n'))
                    return
                }
                out.note(`Your code: ${code}`)
                out.note(`Open ${login.verificationUri}, enter the code and approve. Only approve a sign-in you started.`)
                if (!values['no-browser'] && process.stdout.isTTY) openBrowser(login.verificationUri)
                out.note('Waiting for approval...')
                await finishDeviceLogin(login)
                return signedInSummary(ctx, login.apiUrl)
            }
            let key = values.key as string | undefined
            if (key === '-') key = (await new Promise<string>((resolve) => { let d = ''; process.stdin.on('data', (c) => { d += c }); process.stdin.on('end', () => resolve(d)) })).trim()
            if (!key) throw new UsageError('Missing key. Run pyas login --key pyas_sk_... (a test key, pyas_sk_test_..., works only in the sandbox).')
            if (!key.startsWith('pyas_sk_')) throw new UsageError('That is not a Pyas API key. Pyas API keys start with pyas_sk_.')
            const apiUrl = values['api-url'] as string | undefined
            // Checked before it is saved.
            const pyas = new Pyas({ apiKey: key, ...(apiUrl ? { baseUrl: apiUrl } : {}) })
            await pyas.keys.list()
            writeConfig({ ...readConfig(), apiKey: key, ...(apiUrl ? { apiUrl } : {}) })
            out.data({ saved: configPath(), mode: pyas.testMode ? 'test' : 'live', key: masked(key) }, () => `Saved ${masked(key)} (${pyas.testMode ? 'test mode, sandbox only' : 'live'}) to ${configPath()}.`)
        },
    },
    logout: {
        usage: 'pyas logout',
        summary: 'Signs the CLI out and deletes the saved key.',
        async run({ out }) {
            const session = readConfig().session
            if (session) await revokeSession(session)
            clearConfig()
            out.data({ removed: configPath() }, () => `Removed ${configPath()}.`)
        },
    },
    status: {
        usage: 'pyas status',
        summary: 'Shows which key and API the CLI uses, and what the key has access to.',
        async run({ out, pyas }) {
            const auth = resolveAuth()
            const session = readConfig().session
            if (!auth.apiKey && !session) throw new UsageError('No API key, and not signed in. Run pyas login --key pyas_sk_... or set PYAS_API_KEY for calendar commands, or run pyas login to set up your apps.')
            const signedIn = session ? { api: session.apiUrl, refreshes: true } : null
            if (!auth.apiKey) {
                out.data({ signedIn }, () => `Signed in to ${session!.apiUrl} (pyas login). No API key: set one with pyas login --key for calendar commands.`)
                return
            }
            const client = pyas()
            const keys = await client.keys.list()
            const info = { api: client.baseUrl, key: masked(auth.apiKey), from: auth.from, mode: client.testMode ? 'test' : 'live', keys: keys.length, signedIn }
            out.data(info, () => [
                `API        ${info.api}`,
                `Key        ${info.key} (${info.mode === 'test' ? 'test, sandbox only' : 'live'}), from ${info.from}`,
                `Keys       ${info.keys} on this app`,
                `Signed in  ${session ? `yes, to ${session.apiUrl} (pyas login)` : 'no (pyas login sets up apps)'}`,
            ].join('\n'))
        },
    },
    'apps list': {
        usage: 'pyas apps list',
        summary: 'Lists the apps you can set up, with their organizations. Needs pyas login (or reads the key\'s own app).',
        async run({ out, manage }) {
            const apps = await manage().manage.apps.list()
            out.data(apps.items, () => apps.items.length
                ? table(apps.items.map((a) => [a.appId, a.name, a.orgName]), ['APP', 'NAME', 'ORGANIZATION'])
                : 'No apps. Create one with pyas apps create <name>.')
        },
    },
    'apps show': {
        usage: 'pyas apps show <appId>',
        summary: 'Shows an app\'s settings and its setup checklist, with the next thing to do.',
        async run({ args, out, manage }) {
            const app = await manage().manage.apps.get({ appId: need(args[0], 'appId') })
            out.data(app, () => [
                `${app.name} (${app.appId})`,
                `Allowed origins  ${app.allowedOrigins.length ? app.allowedOrigins.join(', ') : 'none yet'}`,
                `Dashboard        ${app.dashboardUrl}`,
                '',
                'Setup:',
                ...app.setup.steps.map(stepLine),
                '',
                `Next: ${app.setup.nextStep}`,
            ].join('\n'))
        },
    },
    'apps create': {
        usage: 'pyas apps create <name> [--org <orgId>] [--origin <url>]...',
        summary: 'Creates an app. --origin adds where PyasConnect may open (a page\'s address is cut to its origin). --org is needed only if you belong to more than one organization.',
        options: { org: { type: 'string' }, origin: { type: 'string', multiple: true } },
        async run({ args, values, out, manage }) {
            const app = await manage().manage.apps.create({
                name: need(args.join(' ').trim(), 'name'),
                ...(values.org ? { orgId: values.org } : {}),
                ...(values.origin ? { allowedOrigins: values.origin } : {}),
            })
            out.data(app, () => `Created ${app.name} (${app.appId}).\nNext: ${app.setup.nextStep}`)
        },
    },
    'apps update': {
        usage: 'pyas apps update <appId> [--name <name>] [--description <text>] [--website <url>] [--add-origin <url>]...',
        summary: 'Changes an app\'s name, description or website, or adds allowed origins.',
        options: { name: { type: 'string' }, description: { type: 'string' }, website: { type: 'string' }, 'add-origin': { type: 'string', multiple: true } },
        async run({ args, values, out, manage }) {
            const app = await manage().manage.apps.update({
                appId: need(args[0], 'appId'),
                ...(values.name !== undefined ? { name: values.name } : {}),
                ...(values.description !== undefined ? { description: values.description } : {}),
                ...(values.website !== undefined ? { websiteUrl: values.website } : {}),
                ...(values['add-origin'] ? { addAllowedOrigins: values['add-origin'] } : {}),
            })
            out.data(app, () => `Saved ${app.name}. Allowed origins: ${app.allowedOrigins.join(', ') || 'none'}.\nNext: ${app.setup.nextStep}`)
        },
    },
    'keys test': {
        usage: 'pyas keys test <appId> [--name <name>]',
        summary: 'Creates a test key for the app\'s sandbox and prints it once. Store it as a secret where your server code runs (PYAS_API_KEY), never in browser code.',
        options: { name: { type: 'string' } },
        async run({ args, values, out, manage }) {
            const made = await manage().manage.keys.createTest({ appId: need(args[0], 'appId'), ...(values.name ? { name: values.name } : {}) })
            out.data(made, () => `${made.value}\n\n${made.nextStep}`)
        },
    },
    'webhooks create': {
        usage: 'pyas webhooks create <appId> <url> [--events <type,type>]',
        summary: 'Adds a webhook endpoint in the app\'s sandbox and prints its signing secret once. Live endpoints are added in the dashboard.',
        options: { events: { type: 'string' } },
        async run({ args, values, out, manage }) {
            const made = await manage().manage.webhooks.create({
                appId: need(args[0], 'appId'),
                url: need(args[1], 'url'),
                ...(values.events ? { events: String(values.events).split(',').map((e) => e.trim()).filter(Boolean) } : {}),
            })
            out.data(made, () => [`Added ${made.url} (${made.webhookId}) in the sandbox.`, `Signing secret: ${made.signingSecret.value}`, '', made.nextStep].join('\n'))
        },
    },
    'accounts list': {
        usage: 'pyas accounts list [--subject <subjectId>] [--provider google|microsoft|zoom|pyas]',
        summary: 'Lists connected calendars.',
        options: { subject: { type: 'string' }, provider: { type: 'string' } },
        async run({ values, out, pyas }) {
            const accounts: any[] = []
            for await (const a of pyas().accounts.list({ ...(values.subject ? { subjectId: values.subject } : {}), ...(values.provider ? { provider: values.provider } : {}) } as any)) accounts.push(a)
            out.data(accounts, () => accounts.length
                ? table(accounts.map((a) => [a.accountId, a.provider, a.email ?? '', a.name ?? '', a.subjectId ?? '', a.status ?? '']), ['ACCOUNT', 'PROVIDER', 'EMAIL', 'NAME', 'SUBJECT', 'STATUS'])
                : 'No accounts.')
        },
    },
    'accounts status': {
        usage: 'pyas accounts status <accountId> | pyas accounts status --needs-attention [--provider google|microsoft|zoom|pyas]',
        summary: 'Checks whether a calendar can sync, and if not, why and how to fix it. With --needs-attention, lists every account in the app that needs action.',
        options: { 'needs-attention': { type: 'boolean' }, provider: { type: 'string' } },
        async run({ args, values, out, pyas }) {
            if (values['needs-attention']) {
                if (args[0]) throw new UsageError('Pass an account ID or --needs-attention, not both.')
                const accounts: any[] = []
                for await (const s of pyas().accounts.status.list({ overall: ['attention', 'broken'], ...(values.provider ? { provider: values.provider } : {}) } as any)) accounts.push(s)
                out.data(accounts, () => accounts.length
                    ? table(accounts.map((s) => [s.accountId, s.provider, s.email ?? '', s.overall.status, s.overall.fix ?? '', s.overall.reason ?? '']), ['ACCOUNT', 'PROVIDER', 'EMAIL', 'HEALTH', 'FIX', 'REASON'])
                    : 'Every account is healthy.')
                return
            }
            const status: any = await pyas().accounts.status.get({ accountId: need(args[0], 'the account id') })
            out.data(status, () => [
                `${status.accountId}  ${status.provider}  ${status.email ?? ''}`,
                `Health  ${status.overall.status}${status.overall.reason ? `: ${status.overall.reason}` : ''}`,
                status.overall.fix === 'reconnect' ? 'Fix     reconnect (a connect session with this accountId, opened in PyasConnect)' : '',
                status.userMessage ? `Tell them: ${status.userMessage}` : '',
            ].filter(Boolean).join('\n'))
        },
    },
    'events list': {
        usage: 'pyas events list --account <accountId> | --subject <subjectId> [--from <iso>] [--to <iso>] [--days 7] [--query <words>]',
        summary: 'Lists events in a time range (from now, a week by default), with recurring events expanded.',
        options: { account: { type: 'string' }, subject: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, days: { type: 'string' }, query: { type: 'string' }, limit: { type: 'string' } },
        async run({ values, out, pyas }) {
            if (!values.account && !values.subject) throw new UsageError('Pass --account or --subject.')
            const from = isoOr(values.from, Date.now())
            const to = isoOr(values.to, Date.parse(from) + Number(values.days ?? 7) * DAY)
            const limit = Number(values.limit ?? 200)
            const events: Event[] = []
            for await (const e of pyas().events.list({ ...(values.account ? { accountId: values.account } : { subjectId: values.subject }), from, to, expand: true, sort: 'start', ...(values.query ? { q: values.query } : {}) } as any)) {
                events.push(e as Event)
                if (events.length >= limit) break
            }
            out.data(events, () => events.length ? table(events.map((event) => eventLine(event)), ['EVENT', 'STARTS', 'LENGTH', 'TITLE']) : 'No events in that time range.')
        },
    },
    'events get': {
        usage: 'pyas events get <eventId> --account <accountId>',
        summary: 'Returns one event with all its details.',
        options: { account: { type: 'string' } },
        async run({ args, values, out, pyas }) {
            const e = await pyas().events.get({ eventId: need(args[0], 'the event id'), accountId: need(values.account, '--account') })
            out.data(e, () => JSON.stringify(e, null, 2))
        },
    },
    'events create': {
        usage: 'pyas events create --account <id> --title <text> --start <iso> (--end <iso> | --duration <minutes>) [--attendee <email>]... [--meeting meet|teams|zoom] [--timezone <zone>] [--location <text>] [--description <text>]',
        summary: 'Creates an event and invites its attendees.',
        options: {
            account: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, duration: { type: 'string' },
            attendee: { type: 'string', multiple: true }, meeting: { type: 'string' }, timezone: { type: 'string' }, location: { type: 'string' },
            description: { type: 'string' }, calendar: { type: 'string' }, 'idempotency-key': { type: 'string' },
        },
        async run({ values, out, pyas }) {
            const startsAt = isoOr(need(values.start, '--start'), 0)
            if (!values.end && !values.duration) throw new UsageError('Pass --end or --duration.')
            const endsAt = values.end ? isoOr(values.end, 0) : new Date(Date.parse(startsAt) + Number(values.duration) * 60_000).toISOString()
            if (values.meeting && !['meet', 'teams', 'zoom'].includes(values.meeting)) throw new UsageError('--meeting must be meet, teams or zoom.')
            const event = await pyas().events.create({
                accountId: need(values.account, '--account'), title: need(values.title, '--title'), startsAt, endsAt,
                ...(values.timezone ? { timezone: values.timezone } : {}),
                ...(values.location ? { location: values.location } : {}),
                ...(values.description ? { description: values.description } : {}),
                ...(values.calendar ? { calendarRef: values.calendar } : {}),
                ...(values.attendee?.length ? { attendees: (values.attendee as string[]).map((email) => ({ email })) } : {}),
                ...(values.meeting ? { conferencing: { provider: values.meeting } } : {}),
            }, values['idempotency-key'] ? { idempotencyKey: values['idempotency-key'] } : {})
            out.data(event, () => `Created ${event.id}: ${event.title}, ${when(event.startsAt)}${event.meetingUrl ? `\nMeeting: ${event.meetingUrl}` : ''}`)
        },
    },
    'events delete': {
        usage: 'pyas events delete <eventId> --account <accountId> [--yes]',
        summary: 'Deletes an event and notifies its attendees that it is cancelled.',
        options: { account: { type: 'string' } },
        async run(ctx) {
            const eventId = need(ctx.args[0], 'the event id')
            const accountId = need(ctx.values.account, '--account')
            if (!(await confirm(ctx, `Delete ${eventId}? Attendees will be notified that it is cancelled.`))) throw new UsageError('The event was not deleted.')
            await ctx.pyas().events.delete({ eventId, accountId })
            ctx.out.data({ deleted: eventId }, () => `Deleted ${eventId}.`)
        },
    },
    times: {
        usage: 'pyas times --accounts <id,id,...> --duration <minutes> [--from <iso>] [--to <iso>] [--days 7] [--timezone <zone>]',
        summary: 'Finds times when everyone is free, within working hours, across Google and Outlook.',
        options: { accounts: { type: 'string' }, duration: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, days: { type: 'string' }, timezone: { type: 'string' }, limit: { type: 'string' } },
        async run({ values, out, pyas }) {
            const accountIds = need(values.accounts, '--accounts').split(',').map((s) => s.trim()).filter(Boolean)
            const from = isoOr(values.from, Date.now())
            const to = isoOr(values.to, Date.parse(from) + Number(values.days ?? 7) * DAY)
            const slots: any[] = await pyas().meetingTimes.find({
                accountIds, from, to, durationMinutes: Number(need(values.duration, '--duration')),
                ...(values.timezone ? { timezone: values.timezone } : {}), limit: Number(values.limit ?? 10),
            } as any)
            out.data(slots, () => slots.length ? table(slots.map((slot) => [when(slot.startsAt, values.timezone), when(slot.endsAt, values.timezone)]), ['FROM', 'TO']) : 'No time when everyone is free in that time range.')
        },
    },
    'webhooks listen': {
        usage: 'pyas webhooks listen [--forward <url>] [--events <types>]',
        summary: 'Streams the sandbox\'s webhook events as they happen. With --forward, posts each event to your local handler, signed as in production.',
        options: { forward: { type: 'string' }, events: { type: 'string' } },
        async run({ values, out, pyas }) {
            const client = pyas()
            if (!client.testMode) throw new UsageError('webhooks listen forwards the sandbox\'s events, so it requires a test key (pyas_sk_test_...). For live events, create an endpoint with POST /v2/webhooks.')
            const forward = values.forward as string | undefined
            if (forward && !/^https?:\/\//.test(forward)) throw new UsageError('--forward must be a URL, for example http://localhost:3000/webhooks.')
            let stop = false
            process.once('SIGINT', () => { stop = true; out.note('\nStopped.'); process.exit(0) })
            let wait = 1000
            while (!stop) {
                const stream = client.webhooks.listen(values.events ? { events: values.events } : {})
                try {
                    for await (const message of stream) {
                        wait = 1000
                        if (message.event === 'ready') {
                            const ready = message.json<{ signingSecret: string; events: string[] }>()
                            out.note(`Listening for ${ready.events.join(', ')}${forward ? `, forwarding to ${forward}` : ''}. Press Ctrl+C to stop.`)
                            out.note(`Signing secret for this session (use it in your handler to verify deliveries during development): ${ready.signingSecret}`)
                            if (out.json) out.line({ type: 'ready', ...ready }, () => '')
                        } else if (message.event === 'delivery') {
                            const d = message.json<{ eventId: string; type: string; headers: Record<string, string>; body: string }>()
                            if (!forward) {
                                out.line({ type: 'delivery', eventId: d.eventId, eventType: d.type, body: JSON.parse(d.body) }, () => `${new Date().toLocaleTimeString()}  ${d.type}  ${d.eventId}`)
                                continue
                            }
                            const started = Date.now()
                            const result = await fetch(forward, { method: 'POST', headers: d.headers, body: d.body }).then((r) => r.status, (e: Error) => e.message)
                            out.line({ type: 'forwarded', eventId: d.eventId, eventType: d.type, status: result, ms: Date.now() - started },
                                () => `${new Date().toLocaleTimeString()}  ${d.type}  ${d.eventId}  -> ${result}${typeof result === 'number' ? ` (${Date.now() - started} ms)` : ''}`)
                        } else if (message.event === 'expired') {
                            out.note('The stream reached its 1-hour limit. Opening a new one.')
                        }
                    }
                } catch (error) {
                    if (error instanceof PyasError && error.status && error.status < 500 && error.status !== 429) throw error
                    out.note(`Disconnected (${(error as Error).message}). Reconnecting in ${Math.round(wait / 1000)} s.`)
                }
                stream.close()
                if (stop) break
                await new Promise((r) => setTimeout(r, wait))
                wait = Math.min(wait * 2, 30_000)
            }
        },
    },
    'logs tail': {
        usage: 'pyas logs tail [--failed] [--account <accountId>]',
        summary: 'Shows requests as they arrive (checked every 2 seconds), newest last.',
        options: { failed: { type: 'boolean' }, account: { type: 'string' } },
        async run({ values, out, pyas }) {
            const client = pyas()
            const seen = new Set<string>()
            let first = true
            process.once('SIGINT', () => process.exit(0))
            out.note('Following requests. Press Ctrl+C to stop.')
            while (true) {
                const page = await client.logs.list({ ...(values.failed ? { outcome: 'failed' } : {}), ...(values.account ? { accountId: values.account } : {}), limit: 50 } as any)
                const fresh = (page.data as any[]).filter((l) => !seen.has(l.traceId)).reverse()
                for (const l of fresh) {
                    seen.add(l.traceId)
                    if (first && fresh.length > 10 && fresh.indexOf(l) < fresh.length - 10) continue
                    out.line(l, () => `${when(l.createdAt)}  ${String(l.status ?? '').padEnd(3)}  ${l.route ?? `${l.method} ${l.path}`}  ${l.traceId}${l.error?.code ? `  ${l.error.code}` : ''}`)
                }
                first = false
                await new Promise((r) => setTimeout(r, 2000))
            }
        },
    },
    'logs get': {
        usage: 'pyas logs get <traceId>',
        summary: 'Shows what one request did, including its response, its error and hint, and the provider calls and webhooks it made.',
        async run({ args, out, pyas }) {
            const log: any = await pyas().logs.get({ traceId: need(args[0], 'the trace id') })
            out.data(log, () => [
                `${log.method} ${log.path}  ->  ${log.status}  (${log.durationMs ?? '?'} ms)`,
                `Trace id  ${log.traceId}`,
                log.error ? `Error     ${log.error.code}: ${log.error.message}\n          ${log.error.hint ?? ''}` : '',
                ...(log.operations ?? []).map((o: any) => `Did       ${o.provider} ${o.operation}${o.error ? ` (failed: ${o.error})` : ''}`),
                ...(log.webhookEvents ?? []).map((w: any) => `Webhook   ${w.type} ${w.eventId}`),
            ].filter(Boolean).join('\n'))
        },
    },
    'errors explain': {
        usage: 'pyas errors explain <CODE>',
        summary: 'Explains what an error code means, what causes it, and how to fix it.',
        async run({ args, out, pyas }) {
            const code = need(args[0], 'the error code').toUpperCase()
            const res = await fetch(`${pyas().baseUrl}/v2/errors/${encodeURIComponent(code)}`)
            if (res.status === 404) throw new UsageError(`There is no error code ${code}. Run pyas errors list to see every code.`)
            const e: any = await res.json()
            out.data(e, () => [
                `${e.code} (${e.status || 'in the browser'}${e.retryable ? ', retryable' : ''})`,
                e.message,
                `\nCommon causes:\n${e.causes.map((c: string) => `  - ${c}`).join('\n')}`,
                `\nFix: ${e.fix}`,
                e.related.length ? `\nSee also: ${e.related.join(', ')}` : '',
                `Docs: ${e.docs}`,
            ].filter(Boolean).join('\n'))
        },
    },
    'errors list': {
        usage: 'pyas errors list',
        summary: 'Lists every error code.',
        async run({ out, pyas }) {
            const { errors } = await (await fetch(`${pyas().baseUrl}/v2/errors`)).json() as { errors: any[] }
            out.data(errors, () => table(errors.map((e) => [e.code, String(e.status), e.message]), ['CODE', 'STATUS', 'MEANING']))
        },
    },
    sandbox: {
        usage: 'pyas sandbox',
        summary: 'Shows the sandbox (test keys only), including its people and the IDs to test requests with.',
        async run({ out, pyas }) {
            const sandbox: any = await pyas().sandbox.get()
            out.data(sandbox, () => JSON.stringify(sandbox, null, 2))
        },
    },
    'sandbox reset': {
        usage: 'pyas sandbox reset [--yes]',
        summary: 'Resets the sandbox to its starting data: its accounts, calendars and events. Webhook endpoints you added are kept.',
        async run(ctx) {
            if (!(await confirm(ctx, 'Reset the sandbox? Its accounts, calendars and events go back to their starting data. Webhook endpoints you added are kept.'))) throw new UsageError('The sandbox was not reset.')
            const result = await ctx.pyas().sandbox.reset()
            ctx.out.data(result, () => 'The sandbox is back to its starting data.')
        },
    },
    request: {
        usage: 'pyas request <operationId> [--params <json>]',
        summary: 'Calls any operation by its ID (pyas request events.list --params \'{"accountId":"..."}\').',
        options: { params: { type: 'string' } },
        async run({ args, values, out, pyas }) {
            const id = need(args[0], 'the operation id')
            let params: Record<string, unknown> = {}
            try { params = values.params ? JSON.parse(values.params) : {} } catch { throw new UsageError('--params must be valid JSON.') }
            const answer: any = await (pyas().request as any)(id, params)
            const data = answer && typeof answer === 'object' && 'data' in answer && 'nextCursor' in answer ? { data: answer.data, nextCursor: answer.nextCursor } : answer
            out.data(data, () => JSON.stringify(data, null, 2))
        },
    },
}

const GLOBAL: Options = {
    json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' }, 'api-url': { type: 'string' },
}

const help = () => [
    'pyas: use the Pyas API from your terminal.',
    '',
    ...Object.values(COMMANDS).map((c) => `  ${c.usage}\n      ${c.summary}`),
    '',
    'Every command accepts --json (only the data, for scripts and coding agents), --yes (skips confirmation prompts) and --api-url <url>.',
    'Sign in with pyas login to set up your apps. For calendar commands, save a key with pyas login --key or set PYAS_API_KEY. A test key (pyas_sk_test_...) works only in the sandbox.',
].join('\n')

export const main = async (argv: string[]): Promise<number> => {
    // The command is the longest run of leading words that names one; a first pass with every
    // option known, so an option's value is never taken for a word.
    const allOptions: Options = Object.assign({}, GLOBAL, ...Object.values(COMMANDS).map((c) => c.options ?? {}))
    let words: string[]
    try {
        words = parseArgs({ args: argv, options: allOptions, allowPositionals: true, strict: false }).positionals
    } catch {
        words = argv.filter((a) => !a.startsWith('-'))
    }
    const name = [2, 1].map((n) => words.slice(0, n).join(' ')).find((n) => COMMANDS[n])
    const command = name ? COMMANDS[name] : undefined
    const out = createOut(argv.includes('--json'))
    try {
        if (argv.includes('--version') || argv.includes('-v')) { out.data({ cli: VERSION, sdk: SDK_VERSION }, () => `pyas ${VERSION} (sdk ${SDK_VERSION})`); return 0 }
        if (!command && words.length && words[0] !== 'help') throw new UsageError(`Unknown command: ${words.slice(0, 2).join(' ')}.`)
        if (!command || argv.includes('--help') || argv.includes('-h') || words[0] === 'help') {
            process.stdout.write(`${command && words[0] !== 'help' ? `${command.usage}\n  ${command.summary}` : help()}\n`)
            return command || words[0] === 'help' || !argv.length ? 0 : 2
        }
        const parsed = parseArgs({ args: argv, options: { ...GLOBAL, ...(command.options ?? {}) }, allowPositionals: true, strict: true })
        const args = parsed.positionals.slice(name!.split(' ').length)
        const values = parsed.values as Record<string, any>
        let manager: Pyas | null = null
        const manage = () => {
            if (manager) return manager
            const session = readConfig().session
            if (session) {
                manager = new Pyas({ accessToken: () => accessToken(), baseUrl: session.apiUrl, appInfo: `pyas-cli/${VERSION}` })
                return manager
            }
            if (resolveAuth().apiKey) return (manager = pyas())
            throw new UsageError('Not signed in. Run pyas login.')
        }
        let client: Pyas | null = null
        const pyas = () => {
            if (client) return client
            const auth = resolveAuth()
            if (!auth.apiKey) throw new UsageError('No API key. Run pyas login --key pyas_sk_..., or set PYAS_API_KEY.')
            client = new Pyas({ apiKey: auth.apiKey, ...(values['api-url'] ?? auth.apiUrl ? { baseUrl: values['api-url'] ?? auth.apiUrl } : {}), appInfo: `pyas-cli/${VERSION}` })
            return client
        }
        await command.run({ args, values, out, pyas, manage })
        return 0
    } catch (error) {
        if (error instanceof LoginError) {
            if (out.json) process.stdout.write(`${JSON.stringify({ error: { code: `LOGIN_${error.reason.toUpperCase()}`, message: error.message } })}\n`)
            else process.stderr.write(`${error.message}\n`)
            return 1
        }
        if (error instanceof TypeError && /Unknown option|Unexpected argument|requires a value/i.test(error.message)) return report(new UsageError(error.message), out)
        return report(error, out)
    }
}

// Run when started as a command (not when a test imports it).
if (process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1])) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
