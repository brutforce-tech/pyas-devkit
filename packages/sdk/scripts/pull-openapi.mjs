/**
 * Refreshes the committed snapshot of the API's OpenAPI document, then run
 * `npm run generate`. From a running API (local by default):
 *
 *   npm run openapi:pull                       http://localhost:3030
 *   PYAS_API_URL=https://api.pyas.io npm run openapi:pull
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = (process.env.PYAS_API_URL || 'http://localhost:3030').replace(/\/+$/, '')
const res = await fetch(`${base}/v2/openapi.json`)
if (!res.ok) throw new Error(`${base}/v2/openapi.json answered ${res.status}`)
const doc = await res.json()
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi', 'v2.json')
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`)
const count = Object.values(doc.paths).reduce((n, item) => n + Object.values(item).filter((op) => op?.operationId).length, 0)
console.log(`${count} operations from ${base} written to openapi/v2.json. Now: npm run generate`)
