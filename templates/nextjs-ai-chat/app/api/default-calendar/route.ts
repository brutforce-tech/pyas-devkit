import { isPyasError } from '@pyas/sdk'
import { cookies } from 'next/headers'
import { pyas, pyasErrorResponse } from '@/lib/pyas'
import { currentUserId, DEFAULT_CALENDAR_COOKIE } from '@/lib/user'

/**
 * Sets the person's default calendar: the assistant then uses it without asking which. The
 * account ID comes from the page, so it is checked against the person's own ID first.
 */
export async function PUT(req: Request) {
    const userId = await currentUserId()
    if (!userId) return Response.json({ error: { message: 'Sign in to choose a default calendar.' } }, { status: 401 })
    const { accountId } = await req.json().catch(() => ({}))
    if (typeof accountId !== 'string' || !accountId) return Response.json({ error: { message: 'Choose one of your calendars.' } }, { status: 400 })
    try {
        const account = await pyas().accounts.get({ accountId })
        if (account.subjectId !== userId) return Response.json({ error: { message: 'No calendar with that ID is connected for you.' } }, { status: 404 })
    } catch (error) {
        if (isPyasError(error) && error.status === 404) return Response.json({ error: { message: 'No calendar with that ID is connected for you.' } }, { status: 404 })
        return pyasErrorResponse(error)
    }
    // Kept with the user in your database in your own app.
    ;(await cookies()).set(DEFAULT_CALENDAR_COOKIE, accountId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 })
    return new Response(null, { status: 204 })
}

/** No default: the assistant asks which calendar again when the person has several. */
export async function DELETE() {
    const userId = await currentUserId()
    if (!userId) return Response.json({ error: { message: 'Sign in to manage your calendars.' } }, { status: 401 })
    ;(await cookies()).delete(DEFAULT_CALENDAR_COOKIE)
    return new Response(null, { status: 204 })
}
