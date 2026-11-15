// Broken on purpose: books at the start of Avery's next meeting, without checking anyone is free.
import { Pyas } from '@pyas/sdk'

const pyas = new Pyas()
const DAY = 24 * 60 * 60 * 1000

const { data: accounts } = await pyas.accounts.list({ limit: 100 })
const avery = accounts.find((a) => a.name === 'Avery Brooks' && a.provider === 'pyas')
const jordan = accounts.find((a) => a.name === 'Jordan Lee' && a.provider === 'pyas')

const now = Date.now()
const { data: events } = await pyas.events.list({ accountId: avery.accountId, from: new Date(now + 3_600_000).toISOString(), to: new Date(now + 7 * DAY).toISOString(), expand: true, sort: 'start' })
const busy = events.find((e) => !e.isAllDay && e.showAs !== 'free' && Date.parse(e.startsAt) > now)
const start = Date.parse(busy.startsAt)

const event = await pyas.events.create({
    accountId: avery.accountId,
    title: 'Eval sync',
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 30 * 60 * 1000).toISOString(),
    attendees: [{ email: jordan.email }],
})
console.log(event.id)
