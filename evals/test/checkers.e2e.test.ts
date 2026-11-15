import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASKS, type CheckResult } from '../tasks'
import { API_URL, keys } from '../../packages/sdk/e2e/target'

/**
 * The checkers, proven on known solutions against the real API's sandbox (the SDK suite's setup
 * starts it): each passes the reference solution and fails every broken one. Without this, a
 * checker that passes everything would make any agent look good.
 */
const ROOT = resolve(__dirname, '..', '..')
const SOLUTIONS = join(ROOT, 'evals', 'solutions')
const testKey = () => keys().testKey

/** A solution in a folder of its own, as an agent leaves it, with @pyas/sdk installed. */
const workdir = (kind: string, task: string) => {
    const dir = join(mkdtempSync(join(tmpdir(), `pyas-eval-${task}-`)), 'work')
    cpSync(join(SOLUTIONS, kind, task), dir, { recursive: true })
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    symlinkSync(join(ROOT, 'node_modules', '@pyas'), join(dir, 'node_modules', '@pyas'), 'junction')
    return dir
}

const failed = (r: CheckResult) => r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`)

const brokenKinds = readdirSync(SOLUTIONS).filter((k) => k.startsWith('broken'))

describe('the evaluation checkers against the sandbox', () => {
    for (const task of TASKS) {
        it(`${task.id}: the reference solution passes`, async () => {
            const result = await task.check({ dir: workdir('reference', task.id), apiUrl: API_URL, apiKey: testKey() })
            expect(failed(result)).toEqual([])
            expect(result.pass).toBe(true)
        })

        for (const kind of brokenKinds.filter((k) => existsSync(join(SOLUTIONS, k, task.id)))) {
            it(`${task.id}: the ${kind} solution fails`, async () => {
                const result = await task.check({ dir: workdir(kind, task.id), apiUrl: API_URL, apiKey: testKey() })
                // What caught it, in the test output.
                console.log(`${task.id} (${kind}): ${failed(result).join('; ')}`)
                expect(result.pass).toBe(false)
                expect(failed(result).length).toBeGreaterThan(0)
            })
        }
    }

    it('every task has a reference and at least one broken solution', () => {
        for (const task of TASKS) {
            expect(existsSync(join(SOLUTIONS, 'reference', task.id)), task.id).toBe(true)
            expect(brokenKinds.some((k) => existsSync(join(SOLUTIONS, k, task.id))), task.id).toBe(true)
        }
    })
})
