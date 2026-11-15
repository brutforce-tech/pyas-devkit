'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function BookButton() {
    const router = useRouter()
    const [status, setStatus] = useState('')

    async function book() {
        const res = await fetch('/api/pyas/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Intro call' }) })
        const body = await res.json()
        setStatus(res.ok ? `Booked ${new Date(body.event.startsAt).toUTCString()}` : body.error.message)
        if (res.ok) router.refresh()
    }

    return (
        <p>
            <button onClick={book}>Book the first free 30 minutes tomorrow</button> <span role="status">{status}</span>
        </p>
    )
}
