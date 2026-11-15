import { isPyasError } from '@pyas/sdk'
import { calendarsOf, type Calendar } from '@/lib/calendars'
import { isSandbox } from '@/lib/pyas'
import { currentUserId, defaultCalendarOf } from '@/lib/user'
import { Chat } from './chat'
import { ConnectScreen } from './connect'

// The person's calendars are read on every visit, so a calendar they connect shows at once.
export const dynamic = 'force-dynamic'

/** The chat once the person has a calendar, and the connect screen until then. */
export default async function Home() {
    const userId = await currentUserId()
    if (!userId) return <Notice title="Sign in to use your calendar" />

    let calendars: Calendar[]
    try {
        calendars = await calendarsOf(userId)
    } catch (error) {
        if (!isPyasError(error)) throw error
        return <Notice title="Your calendars couldn't be loaded" text={`${error.message}${error.hint ? ` ${error.hint}` : ''}`} />
    }

    const sandbox = isSandbox()
    // Only set to point PyasConnect at the same API as the server.
    const apiUrl = process.env.PYAS_API_URL
    if (!calendars.length) return <ConnectScreen sandbox={sandbox} apiUrl={apiUrl} />
    // Only a default that is still one of their calendars.
    const chosen = await defaultCalendarOf(userId)
    const defaultAccountId = calendars.some((calendar) => calendar.accountId === chosen) ? chosen : null
    return <Chat calendars={calendars} defaultAccountId={defaultAccountId} sandbox={sandbox} apiUrl={apiUrl} />
}

function Notice({ title, text }: { title: string; text?: string }) {
    return (
        <main className="center">
            <div className="card">
                <h1>{title}</h1>
                {text && <p className="muted">{text}</p>}
            </div>
        </main>
    )
}
