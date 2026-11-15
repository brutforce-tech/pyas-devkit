import { isPyasError, Pyas } from '@pyas/sdk'

/**
 * The Pyas client. PYAS_API_KEY is a Lovable secret: server code reads it, and it never reaches the
 * browser. Read it inside each request, not when the file loads: on Lovable's servers, a secret
 * read at load time is undefined.
 */
export const pyas = () => new Pyas({ apiKey: process.env.PYAS_API_KEY, baseUrl: process.env.PYAS_API_URL || undefined, appInfo: 'pyas-recipe-tanstack' })

/**
 * Whose calendars a request is about. Pyas keeps each person's calendars under your app's ID for
 * them (the subjectId). With a test key, that is the sandbox's sample person, so everything works
 * before anyone signs in. With a live key, it is the signed-in person from the server function's
 * context (Lovable's sign-in middleware adds userId), or null.
 */
export const subjectFor = (context: unknown): string | null => {
    if (process.env.PYAS_API_KEY?.startsWith('pyas_sk_test_')) return 'sandbox_user_1'
    return (context as { userId?: string } | undefined)?.userId ?? null
}

export const signInRequired = () => ({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } })

/** A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support). */
export const errorResult = (error: unknown) => {
    if (!isPyasError(error)) throw error
    return { error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }
}
