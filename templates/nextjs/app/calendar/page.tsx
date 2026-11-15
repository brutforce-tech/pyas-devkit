import { isPyasError } from '@pyas/sdk'
import Link from 'next/link'
import { accountsOf, upcomingEvents } from '@/lib/calendar'
import { currentUserId } from '@/lib/user'
import { BookButton } from './book-button'

// Read on every request: calendars change.
export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
    const userId = await currentUserId()
    try {
        const [accounts, events] = await Promise.all([accountsOf(userId), upcomingEvents(userId)])
        return (
            <>
                <h1>Your next 7 days</h1>
                <p>
                    Calendars: {accounts.length ? accounts.map((a) => a.email || a.name).join(', ') : <>none yet. <Link href="/connect">Connect one</Link>.</>}
                </p>
                <BookButton />
                <ol className="events">
                    {events.map((e) => (
                        <li key={e.id} data-event-id={e.id}>
                            <time>{e.isAllDay ? e.startsAt.slice(0, 10) : new Date(e.startsAt).toUTCString()}</time> {e.title || '(no title)'}
                        </li>
                    ))}
                    {!events.length && <li>No events in the next 7 days.</li>}
                </ol>
            </>
        )
    } catch (error) {
        // Show the API's error, with its hint and trace ID, instead of a blank page.
        if (!isPyasError(error)) throw error
        return (
            <>
                <h1>The calendar could not be loaded</h1>
                <p>{error.code}: {error.message}</p>
                {error.hint && <p>{error.hint}</p>}
                {error.traceId && <p>Trace ID: <code>{error.traceId}</code></p>}
            </>
        )
    }
}
