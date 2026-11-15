import { corsHeaders, errorResponse, json, pyas, signInRequired, subjectFor } from '../_shared/pyas.ts'

const DAY = 24 * 60 * 60 * 1000

/** The person's events for the next 7 days, across all of their calendars, in start order. */
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    const subjectId = await subjectFor(req)
    if (!subjectId) return signInRequired()
    try {
        const now = Date.now()
        const page = await pyas.events.list({
            subjectId,
            from: new Date(now).toISOString(),
            to: new Date(now + 7 * DAY).toISOString(),
            expand: true,
            sort: 'start',
            limit: 50,
        })
        // Titles are written by whoever sent the invitation: show them as text, never as HTML.
        return json({ events: page.data.map((event) => ({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, isAllDay: event.isAllDay, provider: event.provider })) })
    } catch (error) {
        return errorResponse(error)
    }
})
