/**
 * A starter template as a developer gets it, against the real API's sandbox (the SDK suite's
 * setup starts the API and makes the keys): scaffolded with `pyas init`, installed, built and
 * started, then each of its routes is checked.
 *
 * @pyas/sdk is packed from this repo. PyasConnect 2.0 comes from tarballs in
 * PYAS_CONNECT_PACKAGES (templates/scripts/pack-connect.mjs makes them from a built pyas-connect
 * checkout), until both are on npm.
 */
import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Pyas, signWebhookForTest } from '@pyas/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_URL, keys as settingsKeys } from '../../packages/sdk/e2e/target'

const ROOT = resolve(__dirname, '..', '..')
export { API_URL }
const state = settingsKeys
const WEBHOOK_SECRET = 'whsec_template_e2e_0123456789abcdef'

export const sh = (command: string, cwd: string, env: NodeJS.ProcessEnv = {}) => {
    const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 900_000 })
    if (r.status !== 0) throw new Error(`${command} failed in ${cwd} (exit ${r.status}):\n${(r.stdout ?? '').slice(-4000)}\n${(r.stderr ?? '').slice(-4000)}`)
    return r.stdout
}

/** A package of this repo, packed now into `work`: its tarball's path. */
const pack = (work: string, pkg: string) => join(work, sh(`npm pack --ignore-scripts --pack-destination "${work}"`, join(ROOT, 'packages', pkg)).trim().split(/\r?\n/).pop()!)

/** The local packages a template installs, by name: the SDK packed now, PyasConnect's tarballs. */
export const localPackages = (work: string, { connect = true, aiTools = false } = {}): Record<string, string> => {
    const out: Record<string, string> = {}
    out['@pyas/sdk'] = pack(work, 'sdk')
    if (aiTools) out['@pyas/ai-tools'] = pack(work, 'ai-tools')
    if (!connect) return out
    const dir = process.env.PYAS_CONNECT_PACKAGES
    if (!dir) throw new Error('Set PYAS_CONNECT_PACKAGES to a folder with PyasConnect 2.0\'s tarballs (node templates/scripts/pack-connect.mjs <folder> makes them).')
    for (const file of readdirSync(dir)) {
        const m = /^pyas-(connect(?:-core|-react|-vue)?)-\d.*\.tgz$/.exec(file)
        if (m) out[`@pyas/${m[1]}`] = join(dir, file)
    }
    for (const name of ['@pyas/connect', '@pyas/connect-core']) if (!out[name]) throw new Error(`No ${name} tarball in ${dir}.`)
    return out
}

export interface App { url: string; stop(): void }

/** Starts the built app and waits until it responds. */
export const start = async (command: string, cwd: string, port: number, env: NodeJS.ProcessEnv): Promise<App> => {
    const child: ChildProcess = spawn(command, { cwd, shell: true, env: { ...process.env, ...env, PORT: String(port), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let output = ''
    child.stdout?.on('data', (d) => { output += d })
    child.stderr?.on('data', (d) => { output += d })
    const stop = () => {
        if (!child.pid) return
        try {
            if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
            else process.kill(-child.pid)
        } catch { /* already gone */ }
    }
    const url = `http://localhost:${port}`
    const until = Date.now() + 120_000
    while (true) {
        if (child.exitCode !== null) throw new Error(`${command} exited with ${child.exitCode}:\n${output.slice(-4000)}`)
        try { if ((await fetch(url)).status < 500) return { url, stop } } catch { /* not yet */ }
        if (Date.now() > until) { stop(); throw new Error(`${command} did not respond within two minutes:\n${output.slice(-4000)}`) }
        await new Promise((r) => setTimeout(r, 1000))
    }
}

export interface TemplateSpec {
    template: 'nextjs' | 'nuxt' | 'express'
    /** Starts the built app; PORT is set. */
    startCommand: string
    port: number
}

/** The checks every template passes. */
export const describeTemplate = ({ template, startCommand, port }: TemplateSpec) => describe(`the ${template} template against the sandbox`, () => {
    let dir: string
    let app: App
    let keys: { apiKey: string; testKey: string }
    const pyas = () => new Pyas({ apiKey: keys.testKey, baseUrl: API_URL })
    const env = (apiKey: string) => ({ PYAS_API_KEY: apiKey, PYAS_API_URL: API_URL, PYAS_WEBHOOK_SECRET: WEBHOOK_SECRET })

    beforeAll(async () => {
        keys = state()
        const work = mkdtempSync(join(tmpdir(), `pyas-${template}-`))
        dir = join(work, 'app')
        // Scaffolded by the built CLI, as `npx @pyas/cli init` does, with the test key in the environment.
        const init = JSON.parse(sh(`node "${join(ROOT, 'packages', 'cli', 'dist', 'cli.js')}" init --template ${template} "${dir}" --json`, work, { PYAS_API_KEY: keys.testKey, PYAS_API_URL: API_URL, PYAS_CONFIG: join(work, 'config.json') }))
        expect(init).toMatchObject({ template, keyWritten: expect.stringMatching(/^pyas_sk_test_/) })
        expect(readFileSync(join(dir, init.envFile), 'utf8')).toContain(`PYAS_API_KEY=${keys.testKey}`)

        const local = localPackages(work)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        for (const name of Object.keys(pkg.dependencies)) if (local[name]) pkg.dependencies[name] = `file:${local[name]}`
        // The wrappers depend on the element and the core at their own version: the same tarballs.
        if (Object.keys(pkg.dependencies).some((n) => n.startsWith('@pyas/connect'))) {
            pkg.dependencies['@pyas/connect'] = `file:${local['@pyas/connect']}`
            pkg.dependencies['@pyas/connect-core'] = `file:${local['@pyas/connect-core']}`
        }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
        sh('npm install --no-audit --no-fund --loglevel=error', dir)
        sh('npm run build', dir, env(keys.testKey))
        app = await start(startCommand, dir, port, env(keys.testKey))
    }, 900_000)

    afterAll(() => app?.stop())

    it('serves its home page', async () => {
        const res = await fetch(app.url)
        expect(res.status).toBe(200)
        expect(await res.text()).toContain('Pyas')
    })

    it('lists the signed-in person\'s events for the next 7 days', async () => {
        const res = await fetch(`${app.url}/calendar`)
        const html = await res.text()
        expect(res.status, html.slice(0, 500)).toBe(200)
        expect(html).toContain('avery')
        expect(html).toMatch(/data-event-id="[^"]+"/)
    })

    it('books the first free 30 minutes tomorrow, on the person\'s calendar', async () => {
        const res = await fetch(`${app.url}/api/pyas/book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `Booked by the ${template} template` }) })
        const body = await res.json() as any
        expect(res.status, JSON.stringify(body)).toBe(201)
        expect(body.event).toMatchObject({ id: expect.any(String), title: `Booked by the ${template} template` })
        const accounts = (await pyas().accounts.list({ subjectId: 'sandbox_user_1' })).data.filter((a) => a.provider !== 'zoom')
        const event = await pyas().events.get({ accountId: accounts[0].accountId, eventId: body.event.id })
        expect(event.title).toBe(`Booked by the ${template} template`)
        expect(Date.parse(event.startsAt)).toBeGreaterThan(Date.now())
        await pyas().events.delete({ accountId: accounts[0].accountId, eventId: body.event.id })
    })

    it('serves the connect page with PyasConnect', async () => {
        const res = await fetch(`${app.url}/connect`)
        expect(res.status).toBe(200)
        expect(await res.text()).toMatch(/<pyas-connect[\s>]/)
    })

    it('with a test key, a connect session is made for the sandbox', async () => {
        const res = await fetch(`${app.url}/api/pyas/connect-session`, { method: 'POST' })
        expect(res.status).toBe(200)
        expect((await res.json() as any).token).toMatch(/^pcs_/)
    })

    it('accepts a signed webhook delivery and refuses one that does not verify', async () => {
        const body = JSON.stringify({ id: 'evt_template_e2e', type: 'event.updated', apiVersion: '2', createdAt: new Date().toISOString(), livemode: false, appId: 'app', accountId: null, subjectId: null, provider: null, data: {}, request: null })
        const signed = await fetch(`${app.url}/api/pyas/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json', 'pyas-signature': await signWebhookForTest(body, WEBHOOK_SECRET) }, body })
        expect(signed.status).toBe(200)
        expect(await signed.json()).toEqual({ received: true })
        const tampered = await fetch(`${app.url}/api/pyas/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json', 'pyas-signature': await signWebhookForTest(body, WEBHOOK_SECRET) }, body: body.replace('event.updated', 'event.deleted') })
        expect(tampered.status).toBe(400)
        const unsigned = await fetch(`${app.url}/api/pyas/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        expect(unsigned.status).toBe(400)
    })

    it('with a live key, makes a connect session whose token PyasConnect uses', async () => {
        app.stop()
        app = await start(startCommand, dir, port, env(keys.apiKey))
        const res = await fetch(`${app.url}/api/pyas/connect-session`, { method: 'POST' })
        const body = await res.json() as any
        expect(res.status, JSON.stringify(body)).toBe(200)
        expect(body.token).toMatch(/^pcs_/)
    }, 180_000)
})
