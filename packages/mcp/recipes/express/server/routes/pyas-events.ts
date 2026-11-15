import { Router } from 'express'
import { pyas, sendError, signInRequired, subjectId } from '../pyas.js'

const DAY = 24 * 60 * 60 * 1000

/** The person's events for the next 7 days, across all of their calendars, in start order. */
export const pyasEvents = Router().get('/api/pyas/events', async (req, res) => {
    const subject = subjectId(req)
    if (!subject) {
        signInRequired(res)
        return
    }
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
        res.json({ events: page.data.map((event) => ({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, isAllDay: event.isAllDay, provider: event.provider })) })
    } catch (error) {
        sendError(res, error)
    }
})
