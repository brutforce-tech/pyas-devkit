import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54'
import { secrets } from 'base44:runtime'
import { isPyasError, Pyas } from 'npm:@pyas/sdk@^1.0.0'

const DAY = 24 * 60 * 60 * 1000

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
 * Books a 30-minute meeting at the first time tomorrow when all of the person's calendars are
 * free, on their first calendar. The payload may set the meeting's title: { "title": "Intro call" }.
 */
export default async function (req: Request): Promise<Response> {
    // PYAS_API_KEY is a Base44 secret: it stays on the server and never reaches the browser.
    const apiKey = secrets.get('PYAS_API_KEY')
    if (!apiKey) return Response.json({ error: { code: 'NO_API_KEY', message: 'Set the PYAS_API_KEY secret to your Pyas key.' } }, { status: 500 })
    const subjectId = await subjectFor(req, apiKey)
    if (!subjectId) return Response.json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } }, { status: 401 })
    const { title } = await req.json().catch(() => ({ title: undefined }))
    try {
        const pyas = new Pyas({ apiKey, baseUrl: secrets.get('PYAS_API_URL') || undefined, appInfo: 'pyas-recipe-base44' })
        // Zoom accounts hold meetings, not calendars, so they have no free or busy times.
        const accounts = (await pyas.accounts.list({ subjectId })).data.filter((account) => account.provider !== 'zoom')
        if (!accounts.length) return Response.json({ error: { code: 'NO_CALENDAR', message: 'Connect a calendar first.' } }, { status: 409 })
        const tomorrow = new Date(Date.now() + DAY)
        tomorrow.setUTCHours(0, 0, 0, 0)
        const slots = await pyas.meetingTimes.find({
            accountIds: accounts.map((account) => account.accountId),
            from: tomorrow.toISOString(),
            to: new Date(tomorrow.getTime() + DAY).toISOString(),
            durationMinutes: 30,
        })
        if (!slots[0]) return Response.json({ error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } }, { status: 409 })
        // The SDK sends an idempotency key, so a retried request never creates the event twice.
        const event = await pyas.events.create({ accountId: accounts[0].accountId, title: String(title || 'Meeting'), startsAt: slots[0].startsAt, endsAt: slots[0].endsAt })
        return Response.json({ event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt } }, { status: 201 })
    } catch (error) {
        // A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support).
        if (!isPyasError(error)) throw error
        return Response.json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, { status: error.status || 502 })
    }
}
