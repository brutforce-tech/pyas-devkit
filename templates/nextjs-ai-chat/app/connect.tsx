'use client'

import { PyasConnect } from '@pyas/connect-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * Connects a calendar for the signed-in person with PyasConnect: they choose Google or Outlook and
 * sign in. With a test key, the sign-in is the Pyas sandbox's, which connects a sample account
 * instead of a real one, so the same code works before and after you go live. Once connected, the
 * page reloads its data and the new calendar shows at once.
 */
export function AddCalendar({ apiUrl, display }: { apiUrl?: string; display: 'inline' | 'dialog' }) {
    const router = useRouter()
    const [problem, setProblem] = useState('')
    const [refreshing, startRefresh] = useTransition()

    // A new session for every attempt: a session works once and expires after 10 minutes.
    async function getSessionToken() {
        setProblem('')
        const res = await fetch('/api/pyas/connect-session', { method: 'POST' })
        const body = await res.json()
        if (!res.ok) {
            setProblem(`${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ''}`)
            throw new Error(body.error.message)
        }
        return body.token as string
    }

    return (
        <div className="add-calendar">
            <PyasConnect
                getSessionToken={getSessionToken}
                apiUrl={apiUrl}
                display={display}
                theme="auto"
                onConnected={() => startRefresh(() => router.refresh())}
                onError={(error) => setProblem(error.message)}
            >
                Connect a calendar
            </PyasConnect>
            {refreshing && <p className="muted" role="status">Loading your calendar...</p>}
            {problem && <p className="form-error" role="alert">{problem}</p>}
        </div>
    )
}

/** What the person sees before they have a calendar. */
export function ConnectScreen({ sandbox, apiUrl }: { sandbox: boolean; apiUrl?: string }) {
    return (
        <main className="center">
            <div className="card connect-card">
                <h1>Connect your calendar</h1>
                <p className="muted">
                    The assistant reads your calendar to answer questions, and books, moves or cancels events when you ask.
                    It shows you each change and waits for your approval.
                </p>
                <AddCalendar apiUrl={apiUrl} display="inline" />
                {sandbox && (
                    <p className="note">
                        This app uses a test key, so it connects sample Google and Outlook accounts from the Pyas sandbox. No real
                        calendar is used. Switch to a live key to connect real ones.
                    </p>
                )}
            </div>
        </main>
    )
}
