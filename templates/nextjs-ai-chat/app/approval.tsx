'use client'

import { useEffect, useState } from 'react'
import type { Calendar } from '@/lib/calendars'

interface PyasEvent { title: string; startsAtLocal: string; endsAtLocal: string }

interface PyasAccount { accountId: string; provider: string; email: string | null; name: string | null }

interface Change {
    ok: boolean
    title?: string
    event?: PyasEvent
    /** The calendar the change is made on, from Pyas. */
    calendar?: PyasAccount
    /** The Zoom account that makes the meeting, when the change adds one. */
    zoomAccount?: PyasAccount
    error?: { message: string }
}

const PROVIDERS: Record<string, string> = { google: 'Google', microsoft: 'Outlook', pyas: 'Hosted by Pyas', zoom: 'Zoom' }

/** An account as the person knows it: its address (a calendar Pyas hosts by its name), and the provider. */
const accountLabel = (account: PyasAccount) => {
    const who = (account.provider === 'pyas' ? account.name ?? account.email : account.email ?? account.name) ?? 'A calendar'
    return `${who} (${PROVIDERS[account.provider] ?? account.provider})`
}

const when = (startsAt: string, endsAt: string) => {
    const start = new Date(startsAt)
    const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time(start)} to ${time(new Date(endsAt))}`
}

/** One change waiting for the person: what it is, read from Pyas, and their answer. */
export function Approval({ tool, input, calendars, onAnswer }: {
    tool: string
    input: Record<string, any>
    /** The person's calendars, to offer another one for a new event. */
    calendars: Calendar[]
    onAnswer: (approved: boolean, reason?: string) => void
}) {
    const [change, setChange] = useState<Change | null>(null)
    useEffect(() => {
        fetch('/api/pyas-change', { method: 'POST', body: JSON.stringify({ tool, input }) })
            .then((res) => res.json())
            .then(setChange)
            .catch(() => setChange({ ok: false, error: { message: "The calendar couldn't be checked." } }))
    }, [tool, input])

    if (!change) return <div className="approval approval-loading">Checking this change...</div>

    // A change that can't be made still needs an answer, or the chat waits for one.
    if (!change.ok) {
        return (
            <div className="approval">
                <div className="approval-title">This change can&apos;t be made</div>
                <div className="approval-when">{change.error?.message}</div>
                <div className="buttons">
                    <button className="button" onClick={() => onAnswer(false)}>Dismiss</button>
                </div>
            </div>
        )
    }

    const { event, calendar, zoomAccount } = change
    const moves = event && input.startsAt && input.endsAt
    // A new event can go on another of their calendars; a change to an event stays where the event is.
    const others = tool === 'create_event' && calendar ? calendars.filter((other) => other.accountId !== calendar.accountId) : []

    // Declines this one, telling the assistant to make the same event on the calendar they picked.
    function chooseCalendar(accountId: string) {
        const picked = calendars.find((other) => other.accountId === accountId)
        if (!picked) return
        onAnswer(false, `The user wants this event on another calendar: accountId ${picked.accountId} (${accountLabel(picked)}). Create the same event there instead, and ask for approval again.`)
    }
    return (
        <div className="approval">
            <div className="approval-title">{change.title}</div>
            {calendar && <div className="approval-calendar">On {accountLabel(calendar)}</div>}
            {event && <div className="approval-event">{event.title}</div>}
            {event && <div className="approval-when">{moves ? 'Now: ' : ''}{when(event.startsAtLocal, event.endsAtLocal)}</div>}
            {moves && <div className="approval-when approval-new">New: {when(input.startsAt, input.endsAt)}</div>}
            {!event && input.title && <div className="approval-event">{input.title}</div>}
            {!event && input.startsAt && <div className="approval-when">{when(input.startsAt, input.endsAt)}</div>}
            {zoomAccount && <div className="approval-when">Zoom meeting from {accountLabel(zoomAccount)}</div>}
            <div className="buttons">
                <button className="button primary" onClick={() => onAnswer(true)}>Approve</button>
                <button className="button" onClick={() => onAnswer(false)}>Decline</button>
                {others.length > 0 && (
                    <select className="button calendar-switch" aria-label="Use another calendar" value="" onChange={(changed) => chooseCalendar(changed.target.value)}>
                        <option value="" disabled>Use another calendar</option>
                        {others.map((other) => <option key={other.accountId} value={other.accountId}>{accountLabel(other)}</option>)}
                    </select>
                )}
            </div>
        </div>
    )
}
