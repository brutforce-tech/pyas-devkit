import { corsHeaders, errorResponse, json, pyas, signInRequired, subjectFor } from '../_shared/pyas.ts'

/**
 * A connect session for PyasConnect. The page asks for a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes. With a test key,
 * the person connects a sample account from the Pyas sandbox; with a live key, a real calendar.
 */
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    const subjectId = await subjectFor(req)
    if (!subjectId) return signInRequired()
    try {
        const session = await pyas.connect.sessions.create({ subjectId, providers: ['google', 'microsoft'] })
        return json({ token: session.token })
    } catch (error) {
        return errorResponse(error)
    }
})
