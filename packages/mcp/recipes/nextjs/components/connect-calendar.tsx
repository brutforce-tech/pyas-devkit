'use client'

import { PyasConnect } from '@pyas/connect-react'
import { useState } from 'react'

/** A "Connect an account" button: Google or Outlook, through Pyas. */
export function ConnectCalendar({ onConnected }: { onConnected?: (accountId: string) => void }) {
    const [status, setStatus] = useState('')

    // A new session for every attempt: a session works once and expires after 10 minutes.
    async function getSessionToken() {
        const res = await fetch('/api/pyas/connect-session', { method: 'POST' })
        const body = await res.json()
        if (!res.ok) {
            // Pyas's error says what went wrong, and its hint what to do.
            const message = `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ''}`
            setStatus(message)
            throw new Error(message)
        }
        return body.token as string
    }

    function connected(account: { accountId: string; email: string }) {
        setStatus(`Connected ${account.email}`)
        onConnected?.(account.accountId)
    }

    return (
        <div>
            <PyasConnect getSessionToken={getSessionToken} theme="auto" onConnected={connected} onError={(error) => setStatus(error.message)} />
            <p role="status">{status}</p>
        </div>
    )
}
