import { isPyasError } from '@pyas/sdk'
import { pyas } from '@/lib/pyas'
import { currentUserId } from '@/lib/user'

/**
 * A connect session for PyasConnect. The page requests a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes.
 */
export async function POST() {
    try {
        const session = await pyas().connect.sessions.create({ subjectId: await currentUserId(), providers: ['google', 'microsoft'] })
        return Response.json({ token: session.token })
    } catch (error) {
        if (!isPyasError(error)) throw error
        // The API's error, with its code, hint and trace ID (quote the trace ID to support).
        return Response.json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, { status: error.status || 502 })
    }
}
