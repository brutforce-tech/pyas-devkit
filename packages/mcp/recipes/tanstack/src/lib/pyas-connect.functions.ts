import { createServerFn } from '@tanstack/react-start'

/**
 * A connect session for PyasConnect. The page asks for a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes. With a test key,
 * the person connects a sample account from the Pyas sandbox; with a live key, a real calendar.
 */
export const getConnectSession = createServerFn({ method: 'POST' }).handler(async ({ context }) => {
    // Loaded here, on the server: this file is also part of the browser's code.
    const { errorResult, pyas, signInRequired, subjectFor } = await import('./pyas.server')
    const subjectId = subjectFor(context)
    if (!subjectId) return signInRequired()
    try {
        const session = await pyas().connect.sessions.create({ subjectId, providers: ['google', 'microsoft'] })
        return { token: session.token }
    } catch (error) {
        return errorResult(error)
    }
})
