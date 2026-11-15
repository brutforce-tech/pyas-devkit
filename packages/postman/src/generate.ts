/**
 * Writes the Postman collection from the SDK's committed snapshot of the OpenAPI document:
 *
 *   npm run generate -w @pyas/postman
 *
 * CI runs it and fails when the committed file differs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCollection, operationIdsIn } from './collection'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OPENAPI = join(root, '..', 'sdk', 'openapi', 'v2.json')
const COLLECTION_FILE = join(root, 'pyas-api-v2.postman_collection.json')

const collection = buildCollection(JSON.parse(readFileSync(OPENAPI, 'utf8')))
writeFileSync(COLLECTION_FILE, `${JSON.stringify(collection, null, 2)}\n`)
const ids = operationIdsIn(collection)
console.log(`${new Set(ids).size} operations, ${collection.item.at(-1).item.length - 1} scenarios: written to pyas-api-v2.postman_collection.json`)
