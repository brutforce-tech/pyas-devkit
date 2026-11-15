import type { Event } from '@pyas/sdk'

// pyas() comes from server/utils/pyas.ts: Nuxt imports server/utils for every server file.

const DAY = 24 * 60 * 60 * 1000

/** The person's connected calendars. */
export const accountsOf = async (userId: string) => (await pyas().accounts.list({ subjectId: userId })).data

/** The person's events for the next 7 days, across all of their calendars, in start order. */
export const upcomingEvents = async (userId: string): Promise<Event[]> => {
    const now = Date.now()
    const page = await pyas().events.list({
        subjectId: userId,
        from: new Date(now).toISOString(),
        to: new Date(now + 7 * DAY).toISOString(),
        expand: true,
        sort: 'start',
        limit: 50,
    })
    return page.data as Event[]
}

/**
 * Books a 30-minute meeting in the first time tomorrow when all of the person's calendars are
 * free, on their first calendar. Returns null when no time is free.
 */
export const bookFirstFreeSlot = async (userId: string, title: string) => {
    // Zoom accounts hold meetings, not calendars, so they have no free or busy times.
    const accounts = (await accountsOf(userId)).filter((a) => a.provider !== 'zoom')
    if (!accounts.length) throw new Error('Connect a calendar first.')
    const tomorrow = new Date(Date.now() + DAY)
    tomorrow.setUTCHours(0, 0, 0, 0)
    const slots = await pyas().meetingTimes.find({
        accountIds: accounts.map((a) => a.accountId),
        from: tomorrow.toISOString(),
        to: new Date(tomorrow.getTime() + DAY).toISOString(),
        durationMinutes: 30,
    })
    const slot = slots[0]
    if (!slot) return null
    // The SDK sends an idempotency key, so a retried request never creates the event twice.
    return pyas().events.create({ accountId: accounts[0].accountId, title, startsAt: slot.startsAt, endsAt: slot.endsAt })
}
