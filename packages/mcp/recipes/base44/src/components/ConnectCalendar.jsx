import { PyasConnect } from '@pyas/connect-react'
import { useState } from 'react'
import { base44 } from '@/api/base44Client'

/** A "Connect an account" button: Google or Outlook, through Pyas. */
export function ConnectCalendar({ onConnected }) {
    const [status, setStatus] = useState('')

    // A new session for every attempt: a session works once and expires after 10 minutes.
    async function getSessionToken() {
        const response = await base44.functions.invoke('pyasConnectSession', {}).catch((error) => error.response)
        const body = response?.data ?? {}
        if (!body.token) {
            // Pyas's error says what went wrong, and its hint what to do.
            const message = body.error ? `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ''}` : 'Could not start connecting a calendar.'
            setStatus(message)
            throw new Error(message)
        }
        return body.token
    }

    function connected(account) {
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
