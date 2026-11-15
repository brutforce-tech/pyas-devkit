/**
 * The MCP server over Streamable HTTP, one request at a time: a server made for the request,
 * with that request's client, answering it and gone. Nothing is kept between requests (no
 * session id), so any process behind a load balancer can answer any request. Used by
 * `pyas-mcp --http`, and by anyone hosting the server behind their own sign-in.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createPyasMcpServer, type PyasMcpOptions } from './server'

/**
 * Answers one MCP request. `body` is the parsed JSON body when a framework has read it already
 * (Express's `express.json()`); otherwise the transport reads it.
 */
export const handleHttpRequest = async (req: IncomingMessage, res: ServerResponse, options: PyasMcpOptions & { body?: unknown }) => {
    const { body, ...serverOptions } = options
    const server = createPyasMcpServer(serverOptions)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
        void transport.close()
        void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
}
