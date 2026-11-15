/**
 * A connect session for PyasConnect. The page requests a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes.
 */
export default defineEventHandler(async (event) => {
    try {
        const session = await pyas().connect.sessions.create({ subjectId: currentUserId(event), providers: ['google', 'microsoft'] })
        return { token: session.token }
    } catch (error) {
        return pyasErrorResponse(event, error)
    }
})
