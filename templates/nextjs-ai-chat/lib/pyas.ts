import { isPyasError, Pyas } from '@pyas/sdk'

let client: Pyas | undefined

/**
 * The Pyas client, created once. It reads PYAS_API_KEY from the environment. Import it from
 * server code only (route handlers and server components): the API key must never reach the
 * browser.
 */
export const pyas = () => (client ??= new Pyas({ appInfo: 'pyas-starter-nextjs-ai-chat' }))

/**
 * Whether the key is a test key. A test key reaches only the app's sandbox: sample people with
 * calendars, and PyasConnect connects sample accounts there instead of real ones.
 */
export const isSandbox = () => (process.env.PYAS_API_KEY ?? '').startsWith('pyas_sk_test_')

/** Pyas's error as JSON for the page: its code, message, hint and trace ID (quote the trace ID to support). */
export const pyasErrorResponse = (error: unknown) => {
    if (!isPyasError(error)) throw error
    return Response.json(
        { error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } },
        { status: error.status || 502 },
    )
}
