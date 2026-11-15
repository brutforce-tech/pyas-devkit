#!/usr/bin/env node
/**
 * `npx @pyas/mcp`: the server over stdio, as Claude Desktop, Claude Code, Cursor and VS Code
 * start it, with the key in PYAS_API_KEY.
 *
 *   pyas-mcp                      stdio
 *   pyas-mcp --read-only          only the tools that change nothing
 *   pyas-mcp --http --port 3333   Streamable HTTP: each request brings its own key
 *                                 (Authorization: Bearer pyas_sk_..., or x-api-key)
 */
import { createServer, type IncomingMessage } from 'node:http'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Pyas, PyasError } from '@pyas/sdk'
import { createPyasMcpServer, SERVER_VERSION } from './server'
import { handleHttpRequest } from './http'

/** Names the MCP server in each request's User-Agent, so Pyas can count requests that come from AI agents. */
const APP_INFO = `pyas-mcp/${SERVER_VERSION}`

const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const readOnly = has('--read-only') || process.env.PYAS_MCP_READ_ONLY === '1'

const keyOf = (req: IncomingMessage) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]
    const header = req.headers['x-api-key']
    return bearer ?? (typeof header === 'string' ? header : undefined)
}

const readBody = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 4_000_000) req.destroy(new Error('Body too large')) })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : undefined) } catch (e) { reject(e) } })
    req.on('error', reject)
})

const main = async () => {
    if (has('--http')) {
        const port = Number(valueOf('--port') ?? process.env.PORT ?? 3333)
        createServer(async (req, res) => {
            if (req.url !== '/mcp') { res.writeHead(404).end(); return }
            const apiKey = keyOf(req)
            if (!apiKey) {
                res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Send your Pyas API key as Authorization: Bearer pyas_sk_...' }))
                return
            }
            try {
                // Stateless: a server per request, with that request's key.
                await handleHttpRequest(req, res, { pyas: new Pyas({ apiKey, appInfo: APP_INFO }), readOnly, body: req.method === 'POST' ? await readBody(req) : undefined })
            } catch (error) {
                if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }))
            }
        }).listen(port, () => console.error(`Pyas MCP server listening on http://localhost:${port}/mcp${readOnly ? ' (read-only)' : ''}`))
        return
    }
    let pyas: Pyas
    try {
        pyas = new Pyas({ appInfo: APP_INFO })
    } catch (error) {
        console.error(error instanceof PyasError ? `${error.message} ${error.hint ?? ''}` : error)
        process.exit(1)
    }
    const server = createPyasMcpServer({ pyas, readOnly })
    await server.connect(new StdioServerTransport())
    // stdout is the protocol: anything for people goes to stderr.
    console.error(`Pyas MCP server ready (${pyas.testMode ? 'test key, sandbox only' : 'live key'}${readOnly ? ', read-only' : ''})`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
