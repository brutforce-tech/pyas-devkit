// Broken on purpose: verifies the signature, but on JSON parsed and serialized again, not the raw body.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { verifyWebhook } from '@pyas/sdk'

const secret = process.env.PYAS_WEBHOOK_SECRET
const seen = new Set()

createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let event
    try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return res.writeHead(400).end() }
    if (!(await verifyWebhook(req.headers['pyas-signature'], JSON.stringify(event), secret))) return res.writeHead(400).end()
    if (!seen.has(event.id)) {
        seen.add(event.id)
        appendFileSync('events.log', `${event.id}\n`)
    }
    res.writeHead(200).end('{"received":true}')
}).listen(Number(process.env.PORT ?? 3000))
