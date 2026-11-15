import { isPyasError } from '@pyas/sdk'
import { Router } from 'express'
import { accountsOf, upcomingEvents } from '../lib/calendar.js'
import { currentUserId } from '../lib/user.js'

export const pageRoutes = Router()

const escape = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (title: string, body: string, head = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/styles.css">
${head}
</head>
<body>
<nav><a href="/">Home</a> <a href="/calendar">Calendar</a> <a href="/connect">Connect a calendar</a></nav>
<main>${body}</main>
</body>
</html>`

pageRoutes.get('/', (_req, res) => {
    res.send(page('Pyas starter', `
<h1>Pyas starter for Express</h1>
<p>This app lists your calendar, books meetings and connects calendars with Pyas.</p>
<ul>
  <li><a href="/calendar">Your next 7 days</a>, from every calendar you connected</li>
  <li><a href="/connect">Connect a calendar</a> with PyasConnect</li>
  <li>Webhooks arrive at <code>POST /api/pyas/webhooks</code></li>
</ul>`))
})

pageRoutes.get('/calendar', async (req, res) => {
    const userId = currentUserId(req)
    try {
        const [accounts, events] = await Promise.all([accountsOf(userId), upcomingEvents(userId)])
        const rows = events.map((e) => `<li data-event-id="${escape(e.id)}"><time>${escape(e.isAllDay ? e.startsAt.slice(0, 10) : new Date(e.startsAt).toUTCString())}</time> ${escape(e.title || '(no title)')}</li>`).join('\n')
        res.send(page('Calendar', `
<h1>Your next 7 days</h1>
<p>Calendars: ${accounts.map((a) => escape(a.email || a.name)).join(', ') || 'none yet. <a href="/connect">Connect one</a>.'}</p>
<p><button id="book">Book the first free 30 minutes tomorrow</button> <span id="booked" role="status"></span></p>
<ol class="events">${rows || '<li>No events in the next 7 days.</li>'}</ol>
<script>
document.getElementById('book').addEventListener('click', async () => {
  const res = await fetch('/api/pyas/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Intro call' }) })
  const body = await res.json()
  document.getElementById('booked').textContent = res.ok ? 'Booked ' + new Date(body.event.startsAt).toUTCString() : body.error.message
  if (res.ok) setTimeout(() => location.reload(), 800)
})
</script>`))
    } catch (error) {
        // Show the API's error, with its hint and trace ID, instead of a blank page.
        const e = isPyasError(error) ? error : null
        res.status(502).send(page('Calendar', `
<h1>The calendar could not be loaded</h1>
<p>${escape(e ? `${e.code}: ${e.message}` : (error as Error).message)}</p>
${e?.hint ? `<p>${escape(e.hint)}</p>` : ''}
${e?.traceId ? `<p>Trace ID: <code>${escape(e.traceId)}</code></p>` : ''}`))
    }
})

pageRoutes.get('/connect', (_req, res) => {
    const apiUrl = process.env.PYAS_API_URL
    res.send(page('Connect a calendar', `
<h1>Connect a calendar</h1>
<p>Connect your Google or Outlook calendar. Each attempt uses a new connect session from this app's server, so your API key never reaches the browser.</p>
<pyas-connect theme="auto"${apiUrl ? ` api-url="${escape(apiUrl)}"` : ''}></pyas-connect>
<p id="status" role="status"></p>
<script type="module">
const element = document.querySelector('pyas-connect')
const status = document.getElementById('status')
element.getSessionToken = async () => {
  const res = await fetch('/api/pyas/connect-session', { method: 'POST' })
  const body = await res.json()
  if (!res.ok) {
    // The API's error and its hint, such as a page origin missing from your app's allowed origins.
    status.textContent = body.error.message + (body.error.hint ? ' ' + body.error.hint : '')
    throw new Error(body.error.message)
  }
  return body.token
}
element.addEventListener('connected', (event) => { status.textContent = 'Connected ' + event.detail.email })
</script>`, '<script type="module" src="/pyas-connect/pyas-connect.esm.js"></script>'))
})
