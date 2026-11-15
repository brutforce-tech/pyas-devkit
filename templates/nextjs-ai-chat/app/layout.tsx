import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Calendar assistant', description: 'A chat that reads and books calendars with Pyas, asking before every change.' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}
