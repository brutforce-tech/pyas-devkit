/**
 * `pyas init --template <name> [dir]`: a starter app from the devkit's templates,
 * with a test key in its env file when one is known. A live key is never written into a project.
 *
 * The templates ship inside the CLI's package (copied by scripts/copy-templates.mjs at build).
 * From the repo's source (tests, development) they are read from the repo's templates folder.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { masked } from './config'
import { UsageError } from './output'

export const TEMPLATES = ['nextjs', 'nuxt', 'express', 'nextjs-ai-chat']

/** Where each template keeps its settings, as its framework expects. */
const ENV_FILE: Record<string, string> = { nextjs: '.env.local', nuxt: '.env', express: '.env', 'nextjs-ai-chat': '.env.local' }
const DEV_URL: Record<string, string> = { nextjs: 'http://localhost:3000', nuxt: 'http://localhost:3000', express: 'http://localhost:3000', 'nextjs-ai-chat': 'http://localhost:3000' }
/** Templates without a webhook endpoint: no `webhooks listen` step. */
const NO_WEBHOOKS = new Set(['nextjs-ai-chat'])
/** Never copied: what a template folder holds after someone ran it. */
const SKIP = new Set(['node_modules', '.next', '.nuxt', '.output', 'dist', '.env', '.env.local', 'next-env.d.ts'])

const here = dirname(fileURLToPath(import.meta.url))
export const templatesDir = () => (import.meta.url.endsWith('.ts') ? join(here, '..', '..', '..', 'templates') : join(here, '..', 'templates'))

export interface ScaffoldResult {
    template: string
    dir: string
    envFile: string
    /** The masked test key written into envFile, or null. */
    keyWritten: string | null
    liveKeySkipped: boolean
    next: string[]
}

const setLine = (text: string, name: string, value: string) => {
    const line = new RegExp(`^#?\\s*${name}=.*$`, 'm')
    return line.test(text) ? text.replace(line, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`
}

export const scaffold = (opts: { template: string; dir: string; apiKey?: string; apiUrl?: string }): ScaffoldResult => {
    const source = join(templatesDir(), opts.template)
    if (!existsSync(join(source, 'package.json'))) throw new UsageError(`No template named ${opts.template}.`)
    const dir = resolve(opts.dir)
    if (existsSync(dir) && readdirSync(dir).length) throw new UsageError(`${dir} already exists and is not empty. Choose another folder.`)

    cpSync(source, dir, { recursive: true, filter: (from) => !SKIP.has(basename(from)) })
    // npm drops .gitignore from published packages, so the templates carry it as _gitignore.
    if (existsSync(join(dir, '_gitignore'))) renameSync(join(dir, '_gitignore'), join(dir, '.gitignore'))
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || pkg.name
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

    // The env file, from .env.example, once .gitignore is known to keep it out of git.
    const envFile = ENV_FILE[opts.template]
    const ignored = readFileSync(join(dir, '.gitignore'), 'utf8').split(/\r?\n/).some((l) => l.trim() === '.env' || l.trim() === '.env*' || l.trim() === '.env.*' || l.trim() === envFile)
    if (!ignored) throw new Error(`The ${opts.template} template's .gitignore does not ignore ${envFile}.`)
    let env = readFileSync(join(dir, '.env.example'), 'utf8')
    const testKey = !!opts.apiKey?.startsWith('pyas_sk_test_')
    if (testKey) env = setLine(env, 'PYAS_API_KEY', opts.apiKey!)
    if (opts.apiUrl) env = setLine(env, 'PYAS_API_URL', opts.apiUrl)
    writeFileSync(join(dir, envFile), env, { mode: 0o600 })

    const shown = opts.dir.replace(/\\/g, '/')
    return {
        template: opts.template,
        dir,
        envFile,
        keyWritten: testKey ? masked(opts.apiKey!) : null,
        liveKeySkipped: !!opts.apiKey && !testKey,
        next: [
            `cd ${shown}`,
            ...(NO_WEBHOOKS.has(opts.template) ? [`set OPENAI_API_KEY in ${envFile}`] : []),
            'npm install',
            'npm run dev',
            ...(NO_WEBHOOKS.has(opts.template) ? [] : [`npx @pyas/cli webhooks listen --forward ${DEV_URL[opts.template]}/api/pyas/webhooks   (in another terminal, then set PYAS_WEBHOOK_SECRET to the secret it prints)`]),
        ],
    }
}
