// Books "Eval sync" at the first 30 minutes in the next 7 days when Avery Brooks and Jordan Lee are both free.
import { Pyas } from '@pyas/sdk'

const pyas = new Pyas()
const DAY = 24 * 60 * 60 * 1000

const accounts = []
for await (const account of pyas.accounts.list({ limit: 100 })) accounts.push(account)
const person = (name) => {
    const own = accounts.find((a) => a.name === name && a.provider === 'pyas')
    if (!own) throw new Error(`${name} is not in this sandbox.`)
    // Busy on any of their calendars means busy. Zoom accounts hold meetings, not calendars.
    return { own, calendars: accounts.filter((a) => a.subjectId === own.subjectId && a.provider !== 'zoom') }
}
const avery = person('Avery Brooks')
const jordan = person('Jordan Lee')

// Meeting times respect each person's working hours by default.
const now = Date.now()
const slots = await pyas.meetingTimes.find({
    accountIds: [...avery.calendars, ...jordan.calendars].map((a) => a.accountId),
    from: new Date(now).toISOString(),
    to: new Date(now + 7 * DAY).toISOString(),
    durationMinutes: 30,
})
if (!slots.length) throw new Error('No 30 minutes are free for both in the next 7 days.')

const event = await pyas.events.create({
    accountId: avery.own.accountId,
    title: 'Eval sync',
    startsAt: slots[0].startsAt,
    endsAt: slots[0].endsAt,
    attendees: [{ email: jordan.own.email, name: jordan.own.name }],
})
console.log(event.id)
