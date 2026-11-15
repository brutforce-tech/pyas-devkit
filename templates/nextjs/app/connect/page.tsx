import { ConnectCalendar } from './connect-calendar'

export default function ConnectPage() {
    return (
        <>
            <h1>Connect a calendar</h1>
            <p>
                Connect your Google or Outlook calendar. Each attempt uses a new connect session from this app&apos;s server, so
                your API key never reaches the browser.
            </p>
            {/* PyasConnect uses https://api.pyas.io unless PYAS_API_URL is set. */}
            <ConnectCalendar apiUrl={process.env.PYAS_API_URL} />
        </>
    )
}
