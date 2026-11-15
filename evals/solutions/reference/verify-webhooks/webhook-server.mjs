// Pyas webhooks at POST /webhooks: verified on the raw body, each event recorded once.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { constructWebhookEvent } from '@pyas/sdk'

const secret = process.env.PYAS_WEBHOOK_SECRET
const LOG = 'events.log'
const seen = new Set(existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [])

createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks') return res.writeHead(404).end()
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let event
    try {
        // The raw bytes as received: re-serialized JSON would not match the signature.
        event = await constructWebhookEvent(Buffer.concat(chunks), req.headers['pyas-signature'], secret)
    } catch {
        return res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid signature"}')
    }
    // Retries reuse the event's id: record each one once.
    if (!seen.has(event.id)) {
        seen.add(event.id)
        appendFileSync(LOG, `${event.id}\n`)
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}')
}).listen(Number(process.env.PORT ?? 3000))
