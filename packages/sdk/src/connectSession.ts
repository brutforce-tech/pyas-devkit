/**
 * Your backend's one step for PyasConnect: an endpoint that makes a connect session with your API
 * key and answers its token, which PyasConnect's `getSessionToken` asks for on each attempt.
 *
 *   // Express (or anything with res.status().json(), or Node's own http server)
 *   app.post('/pyas/session', pyas.connect.sessionHandler())
 *
 *   // Next.js route handlers, Hono, Bun, Cloudflare Workers: no res, so it answers a Response
 *   export const POST = pyas.connect.sessionHandler()
 *
 * Optionally, a function names your own id for the user (`subjectId`, kept on the account) or
 * returns the session's options (providers, loginHint). Nothing about the user is required: a
 * test page with no login works as it is.
 *
 *   app.post('/pyas/session', pyas.connect.sessionHandler((req) => req.user?.id))
 */
import { isPyasError } from './errors'
import type { Data, Params } from './types'

/** Your id for the user (the account's `subjectId`), or the session's options; nothing for a session without either. */
export type SessionFor = string | Params<'connect.sessions.create'> | null | undefined | false
export type SessionResolver<Req> = (req: Req) => SessionFor | Promise<SessionFor>

/** The response objects it can answer on, beside returning a Response. */
type ExpressLike = { status(code: number): { json(body: unknown): unknown }; setHeader?(name: string, value: string): unknown }
type NodeLike = { writeHead(code: number, headers: Record<string, string>): unknown; end(body: string): unknown }

const answer = (res: unknown, status: number, body: unknown): Response | undefined => {
    if (res && typeof (res as ExpressLike).status === 'function') {
        (res as ExpressLike).setHeader?.('cache-control', 'no-store')
        ;(res as ExpressLike).status(status).json(body)
        return undefined
    }
    if (res && typeof (res as NodeLike).writeHead === 'function') {
        (res as NodeLike).writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        ;(res as NodeLike).end(JSON.stringify(body))
        return undefined
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export const sessionHandler = <Req = any>(
    create: (params: Params<'connect.sessions.create'>) => Promise<Data<'connect.sessions.create'>>,
    resolve?: SessionResolver<Req>,
) => async (req: Req, res?: unknown): Promise<Response | undefined> => {
    let options: SessionFor
    try {
        options = resolve ? await resolve(req) : undefined
    } catch {
        // The resolver is the developer's own code; what went wrong in it stays on their server.
        return answer(res, 500, { error: { code: 'SESSION_OPTIONS_FAILED', message: 'The session could not be prepared.' } })
    }
    try {
        const session = await create(typeof options === 'string' ? { subjectId: options } : (options || {}))
        return answer(res, 200, { token: session.token })
    } catch (error) {
        // Pyas's error code and message help the developer; nothing else about the request goes back.
        if (isPyasError(error)) return answer(res, error.status >= 400 && error.status < 500 ? error.status : 502, { error: { code: error.code, message: error.message } })
        return answer(res, 502, { error: { code: 'CONNECTION_ERROR', message: 'Pyas could not be reached.' } })
    }
}
