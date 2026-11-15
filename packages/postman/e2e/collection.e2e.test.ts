import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BROWSER_ONLY, operationIdsIn, runOrder } from '../src/collection'
import { API_URL, keys } from '../../sdk/e2e/target'

/**
 * The committed collection, run with the Postman CLI against the real API's sandbox (the SDK
 * suite's setup starts the API and makes a test key): every request and every scenario must
 * pass its tests, and every operation the API documents must be in the collection.
 *
 * Needs the Postman CLI: `postman` on the PATH, or its path in POSTMAN_CLI. It runs a local
 * collection without signing in to Postman.
 */
const state = keys()
const collection = JSON.parse(readFileSync(join(__dirname, '..', 'pyas-api-v2.postman_collection.json'), 'utf8'))
const POSTMAN = process.env.POSTMAN_CLI || 'postman'
const quote = (s: string) => (process.platform === 'win32' ? `"${s}"` : `'${s}'`)

const postman = (args: string[]) => spawnSync([quote(POSTMAN), ...args.map(quote)].join(' '), {
    shell: true, encoding: 'utf8', timeout: 540_000, maxBuffer: 64 * 1024 * 1024,
})

describe('the Postman collection against the sandbox', () => {
    it('has every operation the API documents, but the browser-only ones', async () => {
        const doc = await (await fetch(`${API_URL}/v2/openapi.json`)).json()
        const documented = Object.values(doc.paths as Record<string, Record<string, any>>)
            .flatMap((item) => Object.values(item).map((op) => op?.operationId))
            .filter((id) => id && !BROWSER_ONLY.has(id))
        const missing = documented.filter((id) => !operationIdsIn(collection).includes(id))
        expect(missing, 'missing from the collection: regenerate the SDK\'s snapshot, then the collection').toEqual([])
    })

    it('passes every test of every request and scenario, run with the Postman CLI', () => {
        const version = postman(['--version'])
        if (version.status !== 0) {
            throw new Error(`The Postman CLI did not start (${POSTMAN}). Install it (npm install --global --ignore-scripts postman-cli), or set POSTMAN_CLI to its path.\n${version.stderr}`)
        }
        const file = join(mkdtempSync(join(tmpdir(), 'pyas-postman-')), 'run.json')
        writeFileSync(file, JSON.stringify(runOrder(collection).collection))
        const run = postman([
            'collection', 'run', file,
            '--env-var', `baseUrl=${API_URL}`,
            '--env-var', `apiKey=${state.testKey}`,
            '--timeout-request', '30000',
        ])
        // The run's own report says which request failed, and why.
        if (run.status !== 0) console.log(run.stdout, run.stderr)
        expect(run.status).toBe(0)
        expect(run.stdout).toMatch(/requests\s*\|\s*\d+\s*\|\s*0\s*\|/)
        expect(run.stdout).toMatch(/assertions\s*\|\s*\d+\s*\|\s*0\s*\|/)
    })

    it('sends the streams a runner cannot (the webhook relay), as the collection has them', async () => {
        const { streams } = runOrder(collection)
        expect(streams.length).toBeGreaterThan(0)
        for (const item of streams) {
            const url = new URL(item.request.url.raw.replace('{{baseUrl}}', API_URL))
            const headers = Object.fromEntries(item.request.header.filter((h: any) => !h.disabled).map((h: any) => [h.key, h.value]))
            const controller = new AbortController()
            const res = await fetch(url, { headers: { ...headers, 'x-api-key': state.testKey }, signal: controller.signal })
            expect(res.status).toBe(200)
            expect(res.headers.get('content-type')).toContain('text/event-stream')
            expect(res.headers.get('x-trace-id')).toBeTruthy()
            // The first event arrives, then hang up.
            const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
            let text = ''
            while (!text.includes('\n\n')) {
                const { value, done } = await reader.read()
                if (done) break
                text += value
            }
            controller.abort()
            expect(text).toMatch(/^(event|data|id|:)/m)
        }
    })
})
