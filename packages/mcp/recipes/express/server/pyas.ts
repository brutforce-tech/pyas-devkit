import { isPyasError, Pyas } from '@pyas/sdk'
import type { Request, Response } from 'express'

let client: Pyas | undefined

/**
 * The Pyas client, created once. It reads PYAS_API_KEY from the environment. Use it in server
 * code only: the key must never reach the browser.
 */
export const pyas = () => (client ??= new Pyas({ appInfo: 'pyas-recipe-express' }))

/**
 * The signed-in person's ID in your app. Before you switch to a live key, make this return the ID
 * your sign-in gives the current user (for example, req.user.id with Passport). Until then it
 * returns null, so live requests answer "Sign in" instead of mixing people's calendars.
 */
function currentUserId(_req: Request): string | null {
    return null
}

/**
 * Whose calendars a request is about. Pyas keeps each person's calendars under your app's ID for
 * them (the subjectId). With a test key, that is the sandbox's sample person, so everything works
 * before sign-in is connected. With a live key, it is the signed-in person, or null.
 */
export function subjectId(req: Request): string | null {
    if (process.env.PYAS_API_KEY?.startsWith('pyas_sk_test_')) return 'sandbox_user_1'
    return currentUserId(req)
}

export const signInRequired = (res: Response) => res.status(401).json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } })

/** A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support); anything else as a 500. */
export function sendError(res: Response, error: unknown) {
    if (isPyasError(error)) {
        res.status(error.status || 502).json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } })
        return
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: (error as Error)?.message ?? 'Something went wrong.' } })
}
