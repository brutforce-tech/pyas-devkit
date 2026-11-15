# Webhook handlers

Pyas signs every delivery with the `Pyas-Signature` header:

```
Pyas-Signature: t=1760788800,v1=5257a869e7...
```

`v1` is an HMAC-SHA256 of `<t>.<raw body>` with the endpoint's signing secret
(`whsec_...`). `constructWebhookEvent` from `@pyas/sdk` checks it, refuses
signatures older than 5 minutes, and returns the parsed event. It throws a
`PyasError` with the code `WEBHOOK_SIGNATURE_INVALID` when the delivery doesn't
verify. `verifyWebhook(header, rawBody, secret)` returns `true` or `false`
instead.

In every framework, read the raw body. Never verify `JSON.stringify(req.body)`.

## Express

```ts
import { constructWebhookEvent } from '@pyas/sdk'
import express from 'express'

// express.raw on this route only, registered before any express.json() that would parse it.
app.post('/webhooks/pyas', express.raw({ type: '*/*' }), async (req, res) => {
    let event
    try {
        event = await constructWebhookEvent(req.body, req.get('pyas-signature'), process.env.PYAS_WEBHOOK_SECRET!)
    } catch {
        return res.status(400).json({ error: 'invalid signature' })
    }
    if (await alreadyProcessed(event.id)) return res.json({ received: true })
    queue.add(event) // slow work in the background
    res.json({ received: true })
})
```

## Next.js (App Router)

```ts
// app/api/pyas/webhooks/route.ts
import { constructWebhookEvent } from '@pyas/sdk'

export async function POST(request: Request) {
    let event
    try {
        event = await constructWebhookEvent(await request.text(), request.headers.get('pyas-signature'), process.env.PYAS_WEBHOOK_SECRET!)
    } catch {
        return Response.json({ error: 'invalid signature' }, { status: 400 })
    }
    // ...
    return Response.json({ received: true })
}
```

## Nuxt (Nitro)

```ts
// server/api/pyas/webhooks.post.ts
import { constructWebhookEvent } from '@pyas/sdk'

export default defineEventHandler(async (event) => {
    try {
        const delivery = await constructWebhookEvent((await readRawBody(event, 'utf8')) ?? '', getHeader(event, 'pyas-signature'), process.env.PYAS_WEBHOOK_SECRET!)
        // ...
        return { received: true }
    } catch {
        setResponseStatus(event, 400)
        return { error: 'invalid signature' }
    }
})
```

## Node's http module

```ts
import { createServer } from 'node:http'
import { constructWebhookEvent } from '@pyas/sdk'

createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    try {
        const event = await constructWebhookEvent(Buffer.concat(chunks), req.headers['pyas-signature'] as string, process.env.PYAS_WEBHOOK_SECRET!)
        // ...
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}')
    } catch {
        res.writeHead(400).end()
    }
}).listen(3000)
```

## The event

```ts
{
    id: 'evt_...',          // the same on every retry of this event: skip duplicates by it
    type: 'event.updated',  // event.created, event.deleted, connection.broken, ...
    createdAt: '2026-10-21T15:00:00Z',
    livemode: false,        // false in the sandbox
    accountId: 'acc_...',
    subjectId: 'user_42',
    data: { object: { id: '6v1q8b3k2m9t0c4p7r5s', calendarId: 'primary', seriesId: null, isSeries: false } },
    request: { traceId: 'trc_...' } // when your own request caused it
}
```

`data.object` holds IDs only, never the event's title, times or attendees. Read
what changed:

- `event.created`, `event.updated`: `pyas.events.get({ accountId, eventId: id, calendarRef: calendarId })`.
  When `isSeries` is true the whole series changed: refresh its occurrences
  with `pyas.events.instances({ accountId, eventId: id, calendarRef: calendarId, from, to })`.
- `event.deleted`: remove the event (and, when `isSeries`, its occurrences).
- `calendar.*`: `data.object` is `{ id }`; read it with `pyas.calendars.get({ accountId, calendarRef: id })`.

To know what an event was before a change, keep your own copy of what you sync.

`pyas.webhooks.eventTypes()` lists every type with a sample.

## Testing

- `npx @pyas/cli webhooks listen --forward http://localhost:3000/webhooks/pyas` relays
  the sandbox's events to your handler, signed as in production. Use the secret
  it prints.
- `signWebhookForTest(rawBody, secret)` from `@pyas/sdk` returns a valid
  `Pyas-Signature` header for a unit test of your handler.
- `pyas.webhooks.test({ webhookId, type: 'event.updated' })` sends a sample
  delivery to a registered endpoint.
