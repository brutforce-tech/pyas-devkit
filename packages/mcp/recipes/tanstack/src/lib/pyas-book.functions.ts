import { createServerFn } from '@tanstack/react-start'

const DAY = 24 * 60 * 60 * 1000

/**
 * Books a 30-minute meeting called "Meeting" at the first time tomorrow when all of the person's
 * calendars are free, on their first calendar.
 */
export const bookMeeting = createServerFn({ method: 'POST' }).handler(async ({ context }) => {
    // Loaded here, on the server: this file is also part of the browser's code.
    const { errorResult, pyas, signInRequired, subjectFor } = await import('./pyas.server')
    const subjectId = subjectFor(context)
    if (!subjectId) return signInRequired()
    try {
        const client = pyas()
        // Zoom accounts hold meetings, not calendars, so they have no free or busy times.
        const accounts = (await client.accounts.list({ subjectId })).data.filter((account) => account.provider !== 'zoom')
        if (!accounts.length) return { error: { code: 'NO_CALENDAR', message: 'Connect a calendar first.' } }
        const tomorrow = new Date(Date.now() + DAY)
        tomorrow.setUTCHours(0, 0, 0, 0)
        const slots = await client.meetingTimes.find({
            accountIds: accounts.map((account) => account.accountId),
            from: tomorrow.toISOString(),
            to: new Date(tomorrow.getTime() + DAY).toISOString(),
            durationMinutes: 30,
        })
        if (!slots[0]) return { error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } }
        // The SDK sends an idempotency key, so a retried request never creates the event twice.
        const event = await client.events.create({ accountId: accounts[0].accountId, title: 'Meeting', startsAt: slots[0].startsAt, endsAt: slots[0].endsAt })
        return { event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt } }
    } catch (error) {
        return errorResult(error)
    }
})
