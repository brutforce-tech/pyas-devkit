/**
 * Packs PyasConnect 2.0 (@pyas/connect-core, @pyas/connect, @pyas/connect-react,
 * @pyas/connect-vue) from a built pyas-connect checkout, for the templates' tests while 2.0 is not
 * on npm:
 *
 *   node templates/scripts/pack-connect.mjs <out folder>
 *
 * PYAS_CONNECT_DIR is the checkout (default: pyas-connect next to this repo). Build it first
 * (`npm ci` and `npm run build` there). Nothing in the checkout is changed: no scripts run.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const connect = resolve(process.env.PYAS_CONNECT_DIR || join(root, '..', 'pyas-connect'))
const out = resolve(process.argv[2] || join(root, 'templates', '.connect-packages'))
const PACKAGES = { 'connect-core': 'dist/index.js', connect: 'dist/pyas-connect/pyas-connect.esm.js', 'connect-react': 'dist/index.esm.js', 'connect-vue': 'dist/index.js' }

mkdirSync(out, { recursive: true })
for (const [name, built] of Object.entries(PACKAGES)) {
    const dir = join(connect, 'packages', name)
    if (!existsSync(join(dir, built))) throw new Error(`${dir} is not built (${built} is missing): run npm ci and npm run build in ${connect}.`)
    execSync(`npm pack --ignore-scripts --loglevel=error --pack-destination "${out}"`, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] })
}
console.log(`PyasConnect packed into ${out}. Set PYAS_CONNECT_PACKAGES=${out}`)
