'use client'

import { PyasConnect } from '@pyas/connect-react'
import { useState } from 'react'

export function ConnectCalendar({ apiUrl }: { apiUrl?: string }) {
    const [status, setStatus] = useState('')

    // A new session for every attempt: a session works once and expires after 10 minutes.
    async function getSessionToken() {
        const res = await fetch('/api/pyas/connect-session', { method: 'POST' })
        const body = await res.json()
        if (!res.ok) {
            // The API's error and its hint, such as a page origin missing from your app's allowed origins.
            setStatus(`${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ''}`)
            throw new Error(body.error.message)
        }
        return body.token as string
    }

    return (
        <>
            <PyasConnect
                getSessionToken={getSessionToken}
                apiUrl={apiUrl}
                theme="auto"
                onConnected={(account) => setStatus(`Connected ${account.email}`)}
                onError={(error) => setStatus(error.message)}
            />
            <p role="status">{status}</p>
        </>
    )
}
