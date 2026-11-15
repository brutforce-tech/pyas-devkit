/**
 * Copies the devkit's starter templates (../../templates) into the CLI's package, so
 * `pyas init --template <name>` works from npm. Run by `npm run build`; the copy is not committed.
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(cli, '..', '..', 'templates')
const target = join(cli, 'templates')
const TEMPLATES = ['nextjs', 'nuxt', 'express', 'nextjs-ai-chat']
/** What a template folder holds after someone ran it, never part of a template. */
const SKIP = new Set(['node_modules', '.next', '.nuxt', '.output', 'dist', '.env', '.env.local', 'next-env.d.ts'])

rmSync(target, { recursive: true, force: true })
for (const name of TEMPLATES) {
    if (!existsSync(join(source, name, 'package.json'))) throw new Error(`Missing template: ${join(source, name)}`)
    cpSync(join(source, name), join(target, name), { recursive: true, filter: (from) => !SKIP.has(basename(from)) })
}
console.log(`Templates copied: ${TEMPLATES.join(', ')}`)
