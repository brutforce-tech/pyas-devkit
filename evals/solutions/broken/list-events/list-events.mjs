// Broken on purpose: one calendar only (her Pyas one), and recurring events not expanded.
import { Pyas } from '@pyas/sdk'

const pyas = new Pyas()
const DAY = 24 * 60 * 60 * 1000

const { data: accounts } = await pyas.accounts.list({ limit: 100 })
const avery = accounts.find((a) => a.name === 'Avery Brooks' && a.provider === 'pyas')

const now = Date.now()
const { data: events } = await pyas.events.list({ accountId: avery.accountId, from: new Date(now).toISOString(), to: new Date(now + 7 * DAY).toISOString() })
for (const event of events) console.log(JSON.stringify({ id: event.id, title: event.title, startsAt: event.startsAt }))
