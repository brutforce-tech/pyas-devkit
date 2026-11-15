// Avery Brooks's events for the next 7 days, across all of her calendars, one JSON object per line.
import { Pyas } from '@pyas/sdk'

const pyas = new Pyas()
const DAY = 24 * 60 * 60 * 1000

// People are subjects: find Avery's, then list across every account she has.
const accounts = []
for await (const account of pyas.accounts.list({ limit: 100 })) accounts.push(account)
const avery = accounts.find((a) => a.name === 'Avery Brooks')
if (!avery?.subjectId) throw new Error('Avery Brooks is not in this sandbox.')

const now = Date.now()
for await (const event of pyas.events.list({
    subjectId: avery.subjectId,
    from: new Date(now).toISOString(),
    to: new Date(now + 7 * DAY).toISOString(),
    expand: true,
    sort: 'start',
    limit: 100,
})) {
    console.log(JSON.stringify({ id: event.id, title: event.title, startsAt: event.startsAt }))
}
