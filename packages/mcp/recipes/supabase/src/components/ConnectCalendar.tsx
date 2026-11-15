import { PyasConnect } from '@pyas/connect-react'
import { useState } from 'react'
import { supabase } from '@/integrations/supabase/client'

/** A "Connect an account" button: Google or Outlook, through Pyas. */
export function ConnectCalendar({ onConnected }: { onConnected?: (accountId: string) => void }) {
    const [status, setStatus] = useState('')

    // A new session for every attempt: a session works once and expires after 10 minutes.
    async function getSessionToken() {
        const { data, error } = await supabase.functions.invoke('pyas-connect-session')
        if (error) {
            // Pyas's error says what went wrong, and its hint what to do.
            const body = await error.context?.json?.().catch(() => null)
            const message = body?.error ? `${body.error.message}${body.error.hint ? ` ${body.error.hint}` : ''}` : error.message
            setStatus(message)
            throw new Error(message)
        }
        return data.token as string
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
