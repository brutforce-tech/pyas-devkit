import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { pageRoutes } from './routes/pages.js'
import { pyasRoutes } from './routes/pyas.js'

// Settings from .env, when there is one (PYAS_API_KEY, PYAS_WEBHOOK_SECRET).
if (existsSync('.env')) process.loadEnvFile('.env')

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const app = express()

// The webhook route reads the raw body itself, so no body parser runs before the routes.
app.use(pyasRoutes)
app.use(pageRoutes)
app.use(express.static(join(root, 'public')))
// PyasConnect's <pyas-connect> element, served from the installed package.
app.use('/pyas-connect', express.static(dirname(require.resolve('@pyas/connect/dist/pyas-connect/pyas-connect.esm.js'))))

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
    console.log(`Pyas starter on http://localhost:${port}`)
    if (!process.env.PYAS_API_KEY) console.log('Set PYAS_API_KEY in .env (a test key, pyas_sk_test_..., works in your sandbox).')
})
