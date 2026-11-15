import express, { Router } from 'express'
import { pyas, sendError, signInRequired, subjectId } from '../pyas.js'

const DAY = 24 * 60 * 60 * 1000

/**
 * Books a 30-minute meeting at the first time tomorrow when all of the person's calendars are
 * free, on their first calendar. The body may name the meeting: { "title": "Intro call" }.
 */
export const pyasBook = Router().post('/api/pyas/book', express.json(), async (req, res) => {
    const subject = subjectId(req)
    if (!subject) {
        signInRequired(res)
        return
    }
    try {
        // Zoom accounts hold meetings, not calendars, so they have no free or busy times.
        const accounts = (await pyas().accounts.list({ subjectId: subject })).data.filter((account) => account.provider !== 'zoom')
        if (!accounts.length) {
            res.status(409).json({ error: { code: 'NO_CALENDAR', message: 'Connect a calendar first.' } })
            return
        }
        const tomorrow = new Date(Date.now() + DAY)
        tomorrow.setUTCHours(0, 0, 0, 0)
        const slots = await pyas().meetingTimes.find({
            accountIds: accounts.map((account) => account.accountId),
            from: tomorrow.toISOString(),
            to: new Date(tomorrow.getTime() + DAY).toISOString(),
            durationMinutes: 30,
        })
        if (!slots[0]) {
            res.status(409).json({ error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } })
            return
        }
        // The SDK sends an idempotency key, so a retried request never creates the event twice.
        const event = await pyas().events.create({ accountId: accounts[0].accountId, title: String(req.body?.title || 'Meeting'), startsAt: slots[0].startsAt, endsAt: slots[0].endsAt })
        res.status(201).json({ event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt } })
    } catch (error) {
        sendError(res, error)
    }
})
