import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scaffold, TEMPLATES } from '../src/init'
import { UsageError } from '../src/output'

const TEST_KEY = 'pyas_sk_test_abcdefghijklmnop1234'
const fresh = () => join(mkdtempSync(join(tmpdir(), 'pyas-init-')), 'my-app')

describe('pyas init --template', () => {
    it.each(TEMPLATES)('scaffolds %s with its .gitignore, its own name and the test key in its env file', (template) => {
        const dir = fresh()
        const result = scaffold({ template, dir, apiKey: TEST_KEY })
        expect(result).toMatchObject({ template, dir, keyWritten: 'pyas_sk_test_...1234', liveKeySkipped: false })
        expect(existsSync(join(dir, '.gitignore'))).toBe(true)
        expect(existsSync(join(dir, '_gitignore'))).toBe(false)
        expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
        expect(existsSync(join(dir, 'README.md'))).toBe(true)
        expect(existsSync(join(dir, 'node_modules'))).toBe(false)
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe('my-app')
        const env = readFileSync(join(dir, result.envFile), 'utf8')
        expect(env).toContain(`PYAS_API_KEY=${TEST_KEY}`)
        if (template === 'nextjs-ai-chat') {
            // A chat, not a starter: the model's key to set, and no webhook endpoint to forward to.
            expect(env).toContain('OPENAI_API_KEY=')
            expect(result.next.join('\n')).toContain('OPENAI_API_KEY')
            expect(result.next.join('\n')).not.toContain('webhooks listen')
        } else {
            expect(env).toContain('PYAS_WEBHOOK_SECRET=')
            expect(result.next.join('\n')).toContain('npx @pyas/cli webhooks listen --forward')
        }
    })

    it('puts the env file where the framework reads it', () => {
        expect(scaffold({ template: 'nextjs', dir: fresh() }).envFile).toBe('.env.local')
        expect(scaffold({ template: 'nuxt', dir: fresh() }).envFile).toBe('.env')
    })

    it('never writes a live key into a project', () => {
        const dir = fresh()
        const result = scaffold({ template: 'express', dir, apiKey: 'pyas_sk_live1234567890' })
        expect(result).toMatchObject({ keyWritten: null, liveKeySkipped: true })
        expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain('pyas_sk_live')
    })

    it('sets the API address when one is given', () => {
        const dir = fresh()
        scaffold({ template: 'express', dir, apiKey: TEST_KEY, apiUrl: 'http://localhost:3030' })
        expect(readFileSync(join(dir, '.env'), 'utf8')).toMatch(/^PYAS_API_URL=http:\/\/localhost:3030$/m)
    })

    it('refuses a folder that is not empty, and a template that does not exist', () => {
        const dir = fresh()
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'keep.txt'), 'mine')
        expect(() => scaffold({ template: 'express', dir })).toThrow(UsageError)
        expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('mine')
        expect(() => scaffold({ template: 'rails', dir: fresh() })).toThrow(/No template named rails/)
    })
})
