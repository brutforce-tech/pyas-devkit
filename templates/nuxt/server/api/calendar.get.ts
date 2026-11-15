/** The signed-in person's calendars and their events for the next 7 days, for the calendar page. */
export default defineEventHandler(async (event) => {
    const userId = currentUserId(event)
    try {
        const [accounts, events] = await Promise.all([accountsOf(userId), upcomingEvents(userId)])
        return {
            accounts: accounts.map((a) => ({ accountId: a.accountId, label: a.email || a.name })),
            events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, isAllDay: e.isAllDay })),
        }
    } catch (error) {
        return pyasErrorResponse(event, error)
    }
})
