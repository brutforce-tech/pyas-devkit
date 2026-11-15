import { Router } from 'express'
import { pyas, sendError, signInRequired, subjectId } from '../pyas.js'

/**
 * A connect session for PyasConnect. The page asks for a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes. With a test key,
 * the person connects a sample account from the Pyas sandbox; with a live key, a real calendar.
 */
export const pyasConnectSession = Router().post('/api/pyas/connect-session', async (req, res) => {
    const subject = subjectId(req)
    if (!subject) {
        signInRequired(res)
        return
    }
    try {
        const session = await pyas().connect.sessions.create({ subjectId: subject, providers: ['google', 'microsoft'] })
        res.json({ token: session.token })
    } catch (error) {
        sendError(res, error)
    }
})
