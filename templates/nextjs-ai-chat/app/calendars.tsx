'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { Calendar } from '@/lib/calendars'
import { AddCalendar } from './connect'

const PROVIDERS: Record<string, string> = { google: 'Google', microsoft: 'Outlook', pyas: 'Hosted by Pyas' }

// A calendar Pyas hosts has a made-up address, so its name says more; Google and Outlook are known by the address.
const label = (calendar: Calendar) =>
    (calendar.provider === 'pyas' ? calendar.name ?? calendar.email : calendar.email ?? calendar.name) ?? 'Calendar'

/** The person's calendars, in the header: which ones the assistant uses, and adding or disconnecting one. */
export function CalendarsMenu({ calendars, defaultAccountId, sandbox, apiUrl }: { calendars: Calendar[]; defaultAccountId: string | null; sandbox: boolean; apiUrl?: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [problem, setProblem] = useState('')
    // A default only means something when there is more than one to choose from.
    const choosing = calendars.filter((calendar) => calendar.status === 'active').length > 1

    /** Makes a calendar the default, or clears it (null) so the assistant asks which again. */
    async function setDefault(accountId: string | null) {
        setProblem('')
        const res = await fetch('/api/default-calendar', accountId
            ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) }
            : { method: 'DELETE' })
        if (!res.ok) {
            const body = await res.json().catch(() => null)
            setProblem(body?.error?.message ?? "That didn't save. Try again.")
            return
        }
        router.refresh()
    }
    const menu = useRef<HTMLDivElement>(null)
    const needsAttention = calendars.some((calendar) => calendar.status !== 'active')

    // Closes on a click outside the menu or on Escape.
    useEffect(() => {
        if (!open) return
        const onClick = (event: MouseEvent) => {
            // composedPath sees into PyasConnect's dialog, which is part of the menu.
            if (menu.current && !event.composedPath().includes(menu.current)) setOpen(false)
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const summary = calendars.length === 1 ? label(calendars[0]) : `${calendars.length} calendars`
    return (
        <div className="menu" ref={menu}>
            <button className="button ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
                <span className={`dot ${needsAttention ? 'dot-attention' : ''}`} aria-hidden="true" />
                {summary}
            </button>
            {open && (
                <div className="menu-panel" role="dialog" aria-label="Your calendars">
                    <div className="menu-heading">The assistant uses these calendars</div>
                    {choosing && (
                        <p className="menu-intro">
                            {defaultAccountId
                                ? 'New events go on your default calendar unless you name another. '
                                : 'The assistant asks which calendar to use for new events. Choose a default to skip the question.'}
                            {defaultAccountId && <button className="link-button" onClick={() => setDefault(null)}>Ask me each time</button>}
                        </p>
                    )}
                    <ul className="calendar-list">
                        {calendars.map((calendar) => (
                            <CalendarRow
                                key={calendar.accountId}
                                calendar={calendar}
                                isDefault={calendar.accountId === defaultAccountId}
                                onMakeDefault={choosing && calendar.status === 'active' ? () => setDefault(calendar.accountId) : undefined}
                            />
                        ))}
                    </ul>
                    {problem && <p className="form-error menu-problem" role="alert">{problem}</p>}
                    <div className="menu-footer">
                        <AddCalendar apiUrl={apiUrl} display="dialog" />
                        {sandbox && <p className="menu-note">Test key: these are sample accounts from the Pyas sandbox.</p>}
                    </div>
                </div>
            )}
        </div>
    )
}

function CalendarRow({ calendar, isDefault, onMakeDefault }: { calendar: Calendar; isDefault: boolean; onMakeDefault?: () => void }) {
    const router = useRouter()
    const [confirming, setConfirming] = useState(false)
    const [working, setWorking] = useState(false)
    const [problem, setProblem] = useState('')

    async function disconnect() {
        setWorking(true)
        setProblem('')
        const res = await fetch(`/api/pyas/accounts/${encodeURIComponent(calendar.accountId)}`, { method: 'DELETE' })
        if (!res.ok) {
            const body = await res.json().catch(() => null)
            setProblem(body?.error?.message ?? "It couldn't be disconnected. Try again.")
            setWorking(false)
            return
        }
        router.refresh()
    }

    function cancel() {
        setConfirming(false)
        setProblem('')
    }

    return (
        <li className="calendar-row">
            <div className="calendar-main">
                <div className="calendar-name">
                    {label(calendar)}
                    {isDefault && <span className="badge default-badge">Default</span>}
                </div>
                <div className="calendar-meta">
                    {PROVIDERS[calendar.provider] ?? calendar.provider}
                    {calendar.status !== 'active' && <span className="attention"> · Access was revoked. Connect it again to use it.</span>}
                </div>
            </div>
            {!confirming && (
                <div className="row-actions">
                    {!isDefault && onMakeDefault && (
                        <button className="button small ghost" onClick={onMakeDefault}>
                            Make default
                        </button>
                    )}
                    <button className="button small" onClick={() => setConfirming(true)}>
                        Disconnect
                    </button>
                </div>
            )}
            {confirming && (
                <div className="confirm">
                    <p>The assistant will no longer see or change events on this calendar.</p>
                    <div className="buttons">
                        <button className="button small danger" onClick={disconnect} disabled={working}>
                            {working ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                        <button className="button small" onClick={cancel} disabled={working}>
                            Cancel
                        </button>
                    </div>
                    {problem && <p className="form-error" role="alert">{problem}</p>}
                </div>
            )}
        </li>
    )
}
