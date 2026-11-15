/** Books the first free 30 minutes tomorrow on the person's calendar. */
export default defineEventHandler(async (event) => {
    const body = await readBody<{ title?: string }>(event).catch(() => null)
    try {
        const booked = await bookFirstFreeSlot(currentUserId(event), String(body?.title || 'Meeting'))
        if (!booked) {
            setResponseStatus(event, 409)
            return { error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } }
        }
        setResponseStatus(event, 201)
        return { event: { id: booked.id, title: booked.title, startsAt: booked.startsAt, endsAt: booked.endsAt } }
    } catch (error) {
        return pyasErrorResponse(event, error)
    }
})
