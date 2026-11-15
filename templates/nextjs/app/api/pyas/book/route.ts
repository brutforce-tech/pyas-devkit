import { isPyasError } from '@pyas/sdk'
import { bookFirstFreeSlot } from '@/lib/calendar'
import { currentUserId } from '@/lib/user'

/** Books the first free 30 minutes tomorrow on the person's calendar. */
export async function POST(request: Request) {
    const { title } = await request.json().catch(() => ({ title: undefined }))
    try {
        const event = await bookFirstFreeSlot(await currentUserId(), String(title || 'Meeting'))
        if (!event) return Response.json({ error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } }, { status: 409 })
        return Response.json({ event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt } }, { status: 201 })
    } catch (error) {
        if (!isPyasError(error)) throw error
        return Response.json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, { status: error.status || 502 })
    }
}
