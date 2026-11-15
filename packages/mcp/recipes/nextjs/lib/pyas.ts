import { isPyasError, Pyas } from '@pyas/sdk'

let client: Pyas | undefined

/**
 * The Pyas client, created once. It reads PYAS_API_KEY from the environment. Import it from
 * server code only (route handlers and server components): the key must never reach the browser.
 */
export const pyas = () => (client ??= new Pyas({ appInfo: 'pyas-recipe-nextjs' }))

/**
 * The signed-in person's ID in your app. Before you switch to a live key, make this return the
 * ID your sign-in gives the current user (for example, from your auth library's session). Until
 * then it returns null, so live requests answer "Sign in" instead of mixing people's calendars.
 */
async function currentUserId(): Promise<string | null> {
    return null
}

/**
 * Whose calendars a request is about. Pyas keeps each person's calendars under your app's ID for
 * them (the subjectId). With a test key, that is the sandbox's sample person, so everything works
 * before sign-in is connected. With a live key, it is the signed-in person, or null.
 */
export async function subjectId(): Promise<string | null> {
    if (process.env.PYAS_API_KEY?.startsWith('pyas_sk_test_')) return 'sandbox_user_1'
    return currentUserId()
}

export const signInRequired = () => Response.json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } }, { status: 401 })

/** A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support). */
export function errorResponse(error: unknown) {
    if (!isPyasError(error)) throw error
    return Response.json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, { status: error.status || 502 })
}
