# The calls most apps need

All examples use one client, created on the server:

```ts
import { Pyas } from '@pyas/sdk'
const pyas = new Pyas() // PYAS_API_KEY from the environment
```

Times are ISO 8601 strings with a zone (`2026-10-21T15:00:00Z`).

## People and their calendars

```ts
// Every calendar a person connected (Google, Outlook, Zoom, virtual).
const { data: accounts } = await pyas.accounts.list({ subjectId: user.id })

// Whether an account works, and what to tell its owner if it doesn't.
const status = await pyas.accounts.status.get({ accountId })
// status.overall is 'healthy', 'attention' or 'broken'

// The sandbox's people, accounts and example IDs (test keys only).
const sandbox = await pyas.sandbox.get()
```

## Events

```ts
// A person's events across all of their calendars, recurring events expanded, in start order.
const page = await pyas.events.list({ subjectId: user.id, from, to, expand: true, sort: 'start', limit: 100 })
page.data        // this page's events
page.nextCursor  // null on the last page

// Every event, page after page.
for await (const event of pyas.events.list({ accountId, from, to, expand: true })) {
    console.log(event.title, event.startsAt)
}

const event = await pyas.events.get({ accountId, eventId })

const created = await pyas.events.create({
    accountId,
    title: 'Intro call',
    startsAt: '2026-10-21T15:00:00Z',
    endsAt: '2026-10-21T15:30:00Z',
    attendees: [{ email: 'sam@example.com', name: 'Sam Patel' }],
    conferencing: { provider: 'meet' }, // 'teams' on Outlook; Zoom on any calendar, below
})

// Zoom needs the connected Zoom account to create the meeting with.
conferencing: { provider: 'zoom', accountId: zoomAccountId }

// Only if nobody changed it since you read it.
await pyas.events.update({ accountId, eventId, title: 'Intro call (moved)' }, { ifMatch: event.version })

await pyas.events.delete({ accountId, eventId })
```

`accountId` identifies the calendar account for every read and write of one
event. `calendarRef` picks a calendar within the account (default: `primary`).

## Free times and booking

```ts
// Slots when every account is free, within working hours.
const slots = await pyas.meetingTimes.find({
    accountIds: [averyAccountId, samAccountId],
    from: '2026-10-21T00:00:00Z',
    to: '2026-10-22T00:00:00Z',
    durationMinutes: 30,
})
// slots[0].startsAt, slots[0].endsAt

// Busy intervals without event details.
const busy = await pyas.freeBusy.query({ accountIds: [averyAccountId], from, to })
```

Leave Zoom accounts out of `accountIds`: they hold meetings, not calendars.
To book, create the event in the slot you chose, on the organizer's account,
with the others as attendees.

## Keeping a copy in sync

```ts
// First: the whole window, with a sync token.
const first = await pyas.events.list({ accountId, from, to, sync: true, limit: 250 })
let syncToken = first.response.meta.syncToken as string
// Read every page of the first sync before you store the token.

// Later: only what changed since.
const changes = await pyas.events.list({ accountId, syncToken })
```

If the token expired, the API returns `RESOURCE_SYNC_TOKEN_EXPIRED` (`410`):
list the window again without a token. Webhooks (`event.created`,
`event.updated`, `event.deleted`) tell you when to read changes.

## Any operation

Every operation of the API reference is a method, named by its operation ID
(`events.list` is `pyas.events.list`). For one without a method yet:
`pyas.request('operation.id', params)`.

## Request options

The last argument of every method:

| Option | What it does |
|---|---|
| `idempotencyKey` | For creates: the same key never creates twice. The SDK makes one when you pass none. |
| `ifMatch` | For updates and deletes: only if the event is still at this `version`. |
| `timeoutMs`, `maxRetries` | Override the client's (30 seconds, 2 retries). |
| `signal` | An `AbortSignal` to cancel the request. |
