import { isPyasError } from '@pyas/sdk'
import { cookies } from 'next/headers'
import { pyas, pyasErrorResponse } from '@/lib/pyas'
import { currentUserId, DEFAULT_CALENDAR_COOKIE } from '@/lib/user'

const notFound = () => Response.json({ error: { message: 'No calendar with that ID is connected for you.' } }, { status: 404 })

/**
 * Disconnects one of the signed-in person's calendars. The account ID comes from the page, so
 * it is checked against the person's own ID first: nobody can disconnect someone else's calendar.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ accountId: string }> }) {
    const userId = await currentUserId()
    if (!userId) return Response.json({ error: { message: 'Sign in to manage your calendars.' } }, { status: 401 })
    const { accountId } = await params
    try {
        const account = await pyas().accounts.get({ accountId })
        if (account.subjectId !== userId) return notFound()
        await pyas().accounts.delete({ accountId })
        // A default calendar that's gone: the assistant asks which again.
        const jar = await cookies()
        if (jar.get(DEFAULT_CALENDAR_COOKIE)?.value === accountId) jar.delete(DEFAULT_CALENDAR_COOKIE)
        return new Response(null, { status: 204 })
    } catch (error) {
        if (isPyasError(error) && error.status === 404) return notFound()
        return pyasErrorResponse(error)
    }
}
