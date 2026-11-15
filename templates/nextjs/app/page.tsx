import Link from 'next/link'

export default function Home() {
    return (
        <>
            <h1>Pyas starter for Next.js</h1>
            <p>This app lists your calendar, books meetings and connects calendars with Pyas.</p>
            <ul>
                <li><Link href="/calendar">Your next 7 days</Link>, from every calendar you connected</li>
                <li><Link href="/connect">Connect a calendar</Link> with PyasConnect</li>
                <li>Webhooks arrive at <code>POST /api/pyas/webhooks</code></li>
            </ul>
        </>
    )
}
