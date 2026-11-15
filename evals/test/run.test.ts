import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The runner calls a real model only when asked to: never in a test. */
const TSX = createRequire(import.meta.url).resolve('tsx/cli')
const RUN = join(__dirname, '..', 'run.ts')

describe('the evaluation runner', () => {
    it('does nothing without ANTHROPIC_API_KEY, and says so', () => {
        const env: NodeJS.ProcessEnv = { ...process.env, PYAS_API_KEY: 'pyas_sk_test_x' }
        delete env.ANTHROPIC_API_KEY
        const r = spawnSync(process.execPath, [TSX, RUN, '--task', 'list-events'], { env, encoding: 'utf8', timeout: 60_000 })
        expect(r.status).toBe(0)
        expect(r.stdout).toContain('ANTHROPIC_API_KEY is not set, so no agent was run')
    })
})
