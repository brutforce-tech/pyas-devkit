import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
    title: 'Pyas starter',
    description: 'Calendars in a Next.js app with Pyas',
}

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <nav>
                    <Link href="/">Home</Link>
                    <Link href="/calendar">Calendar</Link>
                    <Link href="/connect">Connect a calendar</Link>
                </nav>
                <main>{children}</main>
            </body>
        </html>
    )
}
