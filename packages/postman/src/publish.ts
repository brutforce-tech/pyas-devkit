/**
 * Publishes the committed collection to Pyas's public Postman workspace (brutforce-tech/pyas-api),
 * beside v1's, through the Postman API: it updates "Pyas API v2" there, or creates it the first
 * time. Forks pull the changes from it.
 *
 *   POSTMAN_API_KEY=PMAK-... npm run publish:postman -w @pyas/postman
 *
 * Without POSTMAN_API_KEY it does nothing and says so. POSTMAN_WORKSPACE_ID picks the workspace
 * when its name is not "Pyas API" (its address is postman.com/brutforce-tech/pyas-api).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLLECTION_NAME } from './collection'

const API = 'https://api.getpostman.com'
/** The workspace's name, lowercased; its address says pyas-api. */
const WORKSPACE_NAME = 'pyas api'
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'pyas-api-v2.postman_collection.json')

const key = process.env.POSTMAN_API_KEY
if (!key) {
    console.log('POSTMAN_API_KEY is not set: nothing published. Set it to an API key of the brutforce-tech Postman team to publish the collection.')
    process.exit(0)
}

const postman = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => null) as any
    if (!res.ok) throw new Error(`Postman API ${method} ${path} responded ${res.status}: ${JSON.stringify(json?.error ?? json)}`)
    return json
}

const workspaceId = async (): Promise<string> => {
    if (process.env.POSTMAN_WORKSPACE_ID) return process.env.POSTMAN_WORKSPACE_ID
    const { workspaces = [] } = await postman('GET', '/workspaces')
    const found = workspaces.filter((w: any) => String(w.name).toLowerCase() === WORKSPACE_NAME)
    if (found.length !== 1) {
        throw new Error(`${found.length ? 'Several workspaces' : 'No workspace'} named "${WORKSPACE_NAME}" for this key. Set POSTMAN_WORKSPACE_ID to the ID of brutforce-tech/pyas-api.`)
    }
    return found[0].id
}

// Postman's API takes only string, boolean, number and any as a collection variable's type, and
// refuses the file's "secret" (the API key). The file keeps it for people who import it.
const file = JSON.parse(readFileSync(FILE, 'utf8'))
const collection = {
    ...file,
    variable: (file.variable ?? []).map((variable: any) => (variable.type === 'secret' ? { ...variable, type: 'string' } : variable)),
}
const id = await workspaceId()
const { workspace } = await postman('GET', `/workspaces/${id}`)
const existing = (workspace.collections ?? []).find((c: any) => c.name === COLLECTION_NAME)
if (existing) {
    // Postman keeps the published copy's own id: the file's is only for the file.
    const { _postman_id: _, ...info } = collection.info
    await postman('PUT', `/collections/${existing.uid}`, { collection: { ...collection, info: { ...info, _postman_id: existing.id } } })
    console.log(`Updated "${COLLECTION_NAME}" (${existing.uid}) in ${workspace.name}.`)
} else {
    const { _postman_id: _, ...info } = collection.info
    const made = await postman('POST', `/collections?workspace=${encodeURIComponent(id)}`, { collection: { ...collection, info } })
    console.log(`Created "${COLLECTION_NAME}" (${made.collection?.uid}) in ${workspace.name}.`)
}
