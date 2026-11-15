// Broken on purpose: trusts every delivery without checking its signature.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const seen = new Set()

createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let event
    try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return res.writeHead(400).end() }
    if (event.id && !seen.has(event.id)) {
        seen.add(event.id)
        appendFileSync('events.log', `${event.id}\n`)
    }
    res.writeHead(200).end('{"received":true}')
}).listen(Number(process.env.PORT ?? 3000))
