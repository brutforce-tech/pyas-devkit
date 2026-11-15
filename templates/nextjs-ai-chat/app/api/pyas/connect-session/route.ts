import { pyas, pyasErrorResponse } from '@/lib/pyas'
import { currentUserId } from '@/lib/user'

/**
 * A connect session for PyasConnect, for the signed-in person: the calendar they connect is
 * saved under their ID. The page asks for a new one each time someone starts connecting, since a
 * session works once and expires after 10 minutes. With a test key, the person connects a sample
 * account from the Pyas sandbox; with a live key, their real Google or Outlook calendar.
 */
export async function POST() {
    const userId = await currentUserId()
    if (!userId) return Response.json({ error: { message: 'Sign in to connect a calendar.' } }, { status: 401 })
    try {
        const session = await pyas().connect.sessions.create({ subjectId: userId, providers: ['google', 'microsoft'] })
        return Response.json({ token: session.token })
    } catch (error) {
        return pyasErrorResponse(error)
    }
}
