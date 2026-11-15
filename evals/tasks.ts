/**
 * The integration tasks a coding agent is given, each with a checker that verifies
 * the result against the sandbox, never by reading the code: the events the script listed are
 * the sandbox's, the meeting it booked is in the calendar at a free time, the webhook server
 * refuses what doesn't verify.
 *
 * A task's prompt names the files, inputs and outputs exactly, so the checker can run what the
 * agent wrote. Every prompt assumes @pyas/sdk is installed and PYAS_API_KEY holds a test key.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { Pyas, signWebhookForTest, type Event } from '@pyas/sdk'

export interface CheckContext {
    /** The folder the solution is in (scripts run there). */
    dir: string
    apiUrl: string
    /** A test key for the sandbox. */
    apiKey: string
}

export interface Check { name: string; pass: boolean; detail?: string }
export interface CheckResult { pass: boolean; checks: Check[] }

export interface Task {
    id: string
    title: string
    prompt: string
    check(ctx: CheckContext): Promise<CheckResult>
}

const DAY = 86_400_000
const COMMON = 'The @pyas/sdk package is installed. PYAS_API_KEY holds a Pyas test key for this app\'s sandbox, and PYAS_API_URL is set when the API is not the default one. Run your code against the sandbox to make sure it works.'

/** Collects named checks; the result passes when all of them do. */
const checks = () => {
    const list: Check[] = []
    const add = (name: string, pass: boolean, detail?: string) => { list.push({ name, pass, ...(detail && !pass ? { detail } : {}) }); return pass }
    return { add, result: (): CheckResult => ({ pass: list.length > 0 && list.every((c) => c.pass), checks: list }) }
}

const runNode = (ctx: CheckContext, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, args, {
        cwd: ctx.dir, encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, PYAS_API_KEY: ctx.apiKey, PYAS_API_URL: ctx.apiUrl, ...env },
    })
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const client = (ctx: CheckContext) => new Pyas({ apiKey: ctx.apiKey, baseUrl: ctx.apiUrl })

/** The sandbox's people the tasks name, with their accounts. */
const people = async (pyas: Pyas) => {
    const sandbox: any = await pyas.sandbox.get()
    const all: any[] = []
    for await (const a of pyas.accounts.list({ limit: 100 })) all.push(a)
    const person = (name: string) => {
        const own = all.find((a) => a.name === name && a.provider === 'pyas')
        if (!own) throw new Error(`No sandbox person named ${name}`)
        return { pyasAccount: own, subjectId: own.subjectId as string, accounts: all.filter((a) => a.subjectId === own.subjectId) }
    }
    return { avery: person('Avery Brooks'), jordan: person('Jordan Lee'), examples: sandbox.examples as Record<string, string> }
}

const allEvents = async (pyas: Pyas, params: Record<string, unknown>) => {
    const out: Event[] = []
    for await (const e of pyas.events.list({ ...params, expand: true, limit: 100 } as any)) out.push(e as Event)
    return out
}

const jsonLines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return undefined } })

const freePort = () => new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)) })
    server.on('error', reject)
})

/* ------------------------------- The tasks ------------------------------- */

const listEvents: Task = {
    id: 'list-events',
    title: 'List a person\'s events across all of their calendars',
    prompt: `Write list-events.mjs, a Node script that prints Avery Brooks's events for the next 7 days, from all of her connected calendars, with recurring events expanded into their occurrences. Avery Brooks is one of the people in this app's Pyas sandbox. Print one JSON object per line with the event's id, title and startsAt, in start order, and print nothing else on stdout. ${COMMON}`,
    async check(ctx) {
        const c = checks()
        const pyas = client(ctx)
        const { avery } = await people(pyas)
        const t0 = Date.now()
        const run = runNode(ctx, ['list-events.mjs'])
        if (!c.add('the script exits with 0', run.code === 0, run.stderr.slice(0, 500))) return c.result()
        const lines = jsonLines(run.stdout)
        if (!c.add('every line is a JSON object with id, title and startsAt', lines.length > 0 && lines.every((l) => l && typeof l.id === 'string' && typeof l.startsAt === 'string'), run.stdout.slice(0, 500))) return c.result()
        // Events wholly inside the window must all be there; nothing may come from outside a wider one.
        const inner = (await allEvents(pyas, { subjectId: avery.subjectId, from: new Date(t0 + 3_600_000).toISOString(), to: new Date(t0 + 7 * DAY - 3_600_000).toISOString() }))
            .filter((e) => Date.parse(e.startsAt) >= t0 + 3_600_000 && Date.parse(e.endsAt) <= t0 + 7 * DAY - 3_600_000)
        const outer = await allEvents(pyas, { subjectId: avery.subjectId, from: new Date(t0 - DAY).toISOString(), to: new Date(t0 + 8 * DAY).toISOString() })
        const listed = new Set(lines.map((l) => l.id))
        const missing = inner.filter((e) => !listed.has(e.id))
        c.add('it lists every event of the 7 days, from every calendar, with occurrences expanded', missing.length === 0, `missing: ${missing.slice(0, 5).map((e) => `${e.title} (${e.startsAt})`).join(', ')}`)
        const known = new Set(outer.map((e) => e.id))
        const foreign = lines.filter((l) => !known.has(l.id))
        c.add('it lists nothing that is not Avery\'s', foreign.length === 0, `not hers: ${foreign.slice(0, 5).map((l) => l.id).join(', ')}`)
        const starts = lines.map((l) => Date.parse(l.startsAt))
        c.add('in start order', starts.every((s, i) => i === 0 || s >= starts[i - 1]))
        return c.result()
    },
}

const bookMeeting: Task = {
    id: 'book-meeting',
    title: 'Find a time two people are free and book it',
    prompt: `Write book-meeting.mjs, a Node script that books a 30-minute meeting titled "Eval sync" on Avery Brooks's Pyas calendar and invites Jordan Lee. Book it at the first time in the next 7 days when both of them are free on all of their calendars, within both people's working hours. Both are people in this app's Pyas sandbox. Print the created event's id as the only line on stdout. ${COMMON}`,
    async check(ctx) {
        const c = checks()
        const pyas = client(ctx)
        const { avery, jordan } = await people(pyas)
        // The answer, worked out before the script runs: the first slot free on every calendar of both.
        const calendars = [...avery.accounts, ...jordan.accounts].filter((a: any) => a.provider !== 'zoom').map((a: any) => a.accountId)
        const now = Date.now()
        const slots = await pyas.meetingTimes.find({ accountIds: calendars, from: new Date(now).toISOString(), to: new Date(now + 7 * DAY).toISOString(), durationMinutes: 30, limit: 50 })
        const ranAt = Date.now()
        const run = runNode(ctx, ['book-meeting.mjs'])
        if (!c.add('the script exits with 0', run.code === 0, run.stderr.slice(0, 500))) return c.result()
        const id = run.stdout.trim().split(/\r?\n/).pop()?.trim() ?? ''
        let event: Event
        try {
            event = await pyas.events.get({ accountId: avery.pyasAccount.accountId, eventId: id })
        } catch (error) {
            c.add('the printed id is an event on Avery\'s Pyas calendar', false, `${id}: ${(error as Error).message}`)
            return c.result()
        }
        c.add('the printed id is an event on Avery\'s Pyas calendar', true)
        try {
            c.add('titled "Eval sync"', event.title === 'Eval sync', event.title)
            const start = Date.parse(event.startsAt)
            const end = Date.parse(event.endsAt)
            c.add('30 minutes long', end - start === 30 * 60_000, `${event.startsAt} to ${event.endsAt}`)
            const jordanEmails = jordan.accounts.map((a: any) => String(a.email ?? '').toLowerCase()).filter(Boolean)
            c.add('Jordan Lee is invited', (event.attendees ?? []).some((a) => jordanEmails.includes(String(a.email).toLowerCase())), JSON.stringify(event.attendees))
            // Busy on any calendar of either person, except the meeting itself.
            const busyFor = async (subjectId: string) => (await allEvents(pyas, { subjectId, from: event.startsAt, to: event.endsAt }))
                .filter((e) => e.id !== event.id && e.iCalUID !== event.iCalUID && e.title !== 'Eval sync' && e.status !== 'cancelled' && e.showAs !== 'free' && !e.isAllDay)
                .filter((e) => Date.parse(e.startsAt) < end && Date.parse(e.endsAt) > start)
            const averyBusy = await busyFor(avery.subjectId)
            const jordanBusy = await busyFor(jordan.subjectId)
            c.add('Avery was free then', averyBusy.length === 0, averyBusy.map((e) => `${e.title} ${e.startsAt}`).join(', '))
            c.add('Jordan was free then', jordanBusy.length === 0, jordanBusy.map((e) => `${e.title} ${e.startsAt}`).join(', '))
            // The first slot when the script ran (one in progress then counts too).
            const firsts = [slots.find((s) => Date.parse(s.endsAt) > ranAt), slots.find((s) => Date.parse(s.startsAt) >= ranAt)].filter(Boolean).map((s) => Date.parse(s!.startsAt))
            c.add('at the first such time, within working hours', firsts.includes(start), `booked ${event.startsAt}, first free ${slots[0]?.startsAt}`)
        } finally {
            await pyas.events.delete({ accountId: avery.pyasAccount.accountId, eventId: event.id }).catch(() => undefined)
        }
        return c.result()
    },
}

const verifyWebhooks: Task = {
    id: 'verify-webhooks',
    title: 'Receive webhooks, verifying their signatures',
    prompt: `Write webhook-server.mjs, a Node HTTP server that receives Pyas webhooks at POST /webhooks, on the port in the PORT environment variable. Verify each delivery's signature with the signing secret in PYAS_WEBHOOK_SECRET. Respond with status 200 to a delivery that verifies, and 400 to one that doesn't. Append the id of each verified event to events.log, one per line, and only once, even when the same event is delivered again. ${COMMON}`,
    async check(ctx) {
        const c = checks()
        const secret = 'whsec_eval_0123456789abcdef0123456789'
        const port = await freePort()
        const server = spawn(process.execPath, ['webhook-server.mjs'], {
            cwd: ctx.dir, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PORT: String(port), PYAS_WEBHOOK_SECRET: secret, PYAS_API_KEY: ctx.apiKey, PYAS_API_URL: ctx.apiUrl },
        })
        let output = ''
        server.stdout?.on('data', (d) => { output += d })
        server.stderr?.on('data', (d) => { output += d })
        const url = `http://localhost:${port}/webhooks`
        const post = (body: string, signature?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'pyas-signature': signature } : {}) }, body }).then((r) => r.status).catch(() => 0)
        try {
            const until = Date.now() + 15_000
            let up = false
            while (!up && Date.now() < until && server.exitCode === null) {
                up = (await post('{}')) !== 0
                if (!up) await new Promise((r) => setTimeout(r, 250))
            }
            if (!c.add('the server starts and listens on PORT', up, output.slice(-500))) return c.result()

            const delivery = (id: string, type = 'event.updated') => ({ id, type, apiVersion: '2', createdAt: new Date().toISOString(), livemode: false, appId: 'app_eval', accountId: 'acc_eval', subjectId: null, provider: 'pyas', data: { object: { id: 'evt_x', calendarId: 'primary', seriesId: null, isSeries: false } }, request: null })
            const a = JSON.stringify(delivery('evt_eval_a'))
            // Pretty-printed: a server that verifies re-serialized JSON instead of the raw body fails it.
            const b = JSON.stringify(delivery('evt_eval_b', 'event.created'), null, 2)
            c.add('a signed delivery gets 200', await post(a, await signWebhookForTest(a, secret)) === 200)
            c.add('the same delivery again gets 200', await post(a, await signWebhookForTest(a, secret)) === 200)
            c.add('a signed delivery verifies on its raw body, whitespace and all', await post(b, await signWebhookForTest(b, secret)) === 200)
            c.add('a changed body gets 400', await post(a.replace('event.updated', 'event.deleted'), await signWebhookForTest(a, secret)) === 400)
            c.add('a delivery without a signature gets 400', await post(a) === 400)
            c.add('a signature by another secret gets 400', await post(a, await signWebhookForTest(a, 'whsec_someone_else')) === 400)
            c.add('a signature older than 5 minutes gets 400', await post(a, await signWebhookForTest(a, secret, Math.floor(Date.now() / 1000) - 600)) === 400)
            const log = join(ctx.dir, 'events.log')
            const ids = existsSync(log) ? readFileSync(log, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
            c.add('events.log has each verified event once, and nothing else', ids.length === 2 && ids.includes('evt_eval_a') && ids.includes('evt_eval_b'), JSON.stringify(ids))
        } finally {
            server.kill()
        }
        return c.result()
    },
}

const handleErrors: Task = {
    id: 'handle-errors',
    title: 'Report the API\'s errors with their code, hint and trace ID',
    prompt: `Write get-event.mjs, a Node script run as \`node get-event.mjs <accountId> <eventId>\`. When the event exists, print it as JSON with its id, title and startsAt, and exit with code 0. When the Pyas API returns an error, print the error's code, its hint and the request's trace ID to stderr, and exit with code 1. ${COMMON}`,
    async check(ctx) {
        const c = checks()
        const pyas = client(ctx)
        const { avery, examples } = await people(pyas)
        const accountId = avery.pyasAccount.accountId
        const ok = runNode(ctx, ['get-event.mjs', accountId, examples['event.avery.design']])
        const shown = (() => { try { return JSON.parse(ok.stdout) } catch { return null } })()
        c.add('an event that exists: its JSON on stdout, exit 0', ok.code === 0 && shown?.title === 'Design Review' && shown?.id === examples['event.avery.design'], `${ok.code} ${ok.stdout.slice(0, 300)} ${ok.stderr.slice(0, 300)}`)
        const missing = runNode(ctx, ['get-event.mjs', accountId, 'evt_does_not_exist'])
        let expected: { code: string; hint: string | null } = { code: '', hint: null }
        try { await pyas.events.get({ accountId, eventId: 'evt_does_not_exist' }) } catch (e: any) { expected = { code: e.code, hint: e.hint } }
        c.add('an event that doesn\'t exist: exit 1', missing.code === 1, String(missing.code))
        c.add('the error\'s code on stderr', !!expected.code && missing.stderr.includes(expected.code), missing.stderr.slice(0, 300))
        c.add('the error\'s hint on stderr', !!expected.hint && missing.stderr.includes(expected.hint), missing.stderr.slice(0, 300))
        c.add('the trace ID on stderr', /trc_[0-9a-z]+/i.test(missing.stderr), missing.stderr.slice(0, 300))
        const badKey = runNode(ctx, ['get-event.mjs', accountId, examples['event.avery.design']], { PYAS_API_KEY: 'pyas_sk_test_not_a_real_key' })
        c.add('a wrong key: exit 1 with AUTH_INVALID_KEY on stderr', badKey.code === 1 && badKey.stderr.includes('AUTH_INVALID_KEY'), `${badKey.code} ${badKey.stderr.slice(0, 300)}`)
        return c.result()
    },
}

export const TASKS: Task[] = [listEvents, bookMeeting, verifyWebhooks, handleErrors]
