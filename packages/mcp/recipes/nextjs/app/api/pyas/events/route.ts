import { errorResponse, pyas, signInRequired, subjectId } from '@/lib/pyas'

const DAY = 24 * 60 * 60 * 1000

/** The person's events for the next 7 days, across all of their calendars, in start order. */
export async function GET() {
    const subject = await subjectId()
    if (!subject) return signInRequired()
    try {
        const now = Date.now()
        const page = await pyas().events.list({
            subjectId: subject,
            from: new Date(now).toISOString(),
            to: new Date(now + 7 * DAY).toISOString(),
            expand: true,
            sort: 'start',
            limit: 50,
        })
        // Titles are written by whoever sent the invitation: show them as text, never as HTML.
        return Response.json({ events: page.data.map((event) => ({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, isAllDay: event.isAllDay, provider: event.provider })) })
    } catch (error) {
        return errorResponse(error)
    }
}
