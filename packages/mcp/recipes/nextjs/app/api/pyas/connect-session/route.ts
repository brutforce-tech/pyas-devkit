import { errorResponse, pyas, signInRequired, subjectId } from '@/lib/pyas'

/**
 * A connect session for PyasConnect. The page asks for a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes. With a test key,
 * the person connects a sample account from the Pyas sandbox; with a live key, a real calendar.
 */
export async function POST() {
    const subject = await subjectId()
    if (!subject) return signInRequired()
    try {
        const session = await pyas().connect.sessions.create({ subjectId: subject, providers: ['google', 'microsoft'] })
        return Response.json({ token: session.token })
    } catch (error) {
        return errorResponse(error)
    }
}
