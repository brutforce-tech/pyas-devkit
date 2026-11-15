import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54'
import { secrets } from 'base44:runtime'
import { isPyasError, Pyas } from 'npm:@pyas/sdk@^1.0.0'

/**
 * Whose calendars a request is about. Pyas keeps each person's calendars under your app's ID for
 * them (the subjectId). With a test key, that is the sandbox's sample person, so everything works
 * before anyone signs in. With a live key, it is the signed-in Base44 user, or null.
 */
async function subjectFor(req: Request, apiKey: string): Promise<string | null> {
    if (apiKey.startsWith('pyas_sk_test_')) return 'sandbox_user_1'
    const base44 = createClientFromRequest(req)
    const user = await base44.auth.me().catch((error: { status?: number }) => (error.status === 401 ? null : Promise.reject(error)))
    return user?.id ?? null
}

/**
 * A connect session for PyasConnect. The page asks for a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes. With a test key,
 * the person connects a sample account from the Pyas sandbox; with a live key, a real calendar.
 */
export default async function (req: Request): Promise<Response> {
    // PYAS_API_KEY is a Base44 secret: it stays on the server and never reaches the browser.
    const apiKey = secrets.get('PYAS_API_KEY')
    if (!apiKey) return Response.json({ error: { code: 'NO_API_KEY', message: 'Set the PYAS_API_KEY secret to your Pyas key.' } }, { status: 500 })
    const subjectId = await subjectFor(req, apiKey)
    if (!subjectId) return Response.json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } }, { status: 401 })
    try {
        const pyas = new Pyas({ apiKey, baseUrl: secrets.get('PYAS_API_URL') || undefined, appInfo: 'pyas-recipe-base44' })
        const session = await pyas.connect.sessions.create({ subjectId, providers: ['google', 'microsoft'] })
        return Response.json({ token: session.token })
    } catch (error) {
        // A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support).
        if (!isPyasError(error)) throw error
        return Response.json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, { status: error.status || 502 })
    }
}
