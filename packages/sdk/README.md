# @pyas/sdk

The Node.js and TypeScript client for the [Pyas](https://pyas.io) API v2. Pyas
gives you Google, Outlook and Zoom calendars through one API. The SDK's types
are generated from the API's own OpenAPI document, so every request and
response is typed end to end.

```bash
npm install @pyas/sdk
```

The SDK requires Node.js 20 or later and has no dependencies.

## Start in the sandbox

Create a test key (`pyas_sk_test_...`) under your app's API keys in the
dashboard. A test key works only in your app's sandbox. The sandbox has sample
people on Pyas calendars with a week of events, and it's ready the first time
you call the API. The sandbox doesn't connect to any real calendar.

```ts
import { Pyas } from '@pyas/sdk'

const pyas = new Pyas({ apiKey: process.env.PYAS_API_KEY })

for await (const account of pyas.accounts.list()) {
  console.log(account.accountId, account.name)
}

const event = await pyas.events.create({
  accountId: 'acc_...',
  title: 'Intro call',
  startsAt: '2026-10-21T15:00:00Z',
  endsAt: '2026-10-21T15:30:00Z',
})
```

The SDK's resources match the API, for example `pyas.events.list`,
`pyas.calendars.permissions.create` and `pyas.webhooks.deliveries.replay`. Each
method accepts one object that holds the path, query and body parameters, and
the SDK provides types for every field, so your editor can autocomplete them.

## Lists

Awaiting a list method returns one page. Use `for await` to iterate over every
page.

```ts
const page = await pyas.events.list({ accountId, from, to, limit: 50 })
page.data          // this page's events
page.nextCursor    // null on the last page
await page.next()  // the next page, or null

for await (const event of pyas.events.list({ subjectId: 'user_42', from, to })) {
  // every event, across every page
}
```

ID filters also accept arrays (`accountIds: ['a', 'b']`). You can also find
events by your own metadata:

```ts
pyas.events.list({ metadata: { orderId: '123' } })
```

## Errors

Every failed request throws a `PyasError`. The error includes the API's error
code, a hint that explains how to fix the problem, a link to the error's
documentation and the request's trace ID.

```ts
import { NotFoundError, RateLimitError, PyasError } from '@pyas/sdk'

try {
  await pyas.accounts.get({ accountId })
} catch (err) {
  if (err instanceof NotFoundError) {
    // err.code === 'CONNECTION_NOT_FOUND'
  }
  if (err instanceof PyasError) console.error(err.code, err.hint, err.docs, err.traceId)
}
```

| Class | Status | Meaning |
|---|---|---|
| `ValidationError` | 400, 422 | The request is invalid. The message explains what to correct. |
| `AuthenticationError` | 401 | The key is missing, invalid, revoked or expired. |
| `PermissionError` | 403 | The key isn't allowed to make this request. Either its scopes don't cover it, or a test key was used on live data (or a live key on test data). |
| `NotFoundError` | 404, 410 | |
| `ConflictError` | 409, 412 | The resource changed since you read it, or it already exists. |
| `RateLimitError` | 429 | The SDK already waited and retried. `retryAfter` is in seconds. |
| `ApiError` | 5xx | Pyas or the provider failed. |
| `ConnectionError` | | The SDK couldn't connect to the API, or the request timed out. |

## Retries, idempotency and concurrent changes

The SDK retries requests after rate limits, provider outages and network
failures. It waits as long as the API's `Retry-After` header specifies. Every
request that creates, changes or deletes something is safe to retry, because
the SDK sends an idempotency key with each one, so the API never makes the same
change twice. If you retry from your own code, for example from a job queue or
after a worker crashes, pass your own key:

```ts
await pyas.events.create(booking, { idempotencyKey: `booking-${booking.id}` })
```

To update an event only if nobody else has changed it since you read it, pass
its version:

```ts
const current = await pyas.events.get({ eventId, accountId })
await pyas.events.update({ eventId, accountId, title: 'Moved' }, { ifMatch: current.version })
// throws a ConflictError if the event changed in between
```

Every method also accepts `signal` (to cancel the request), `timeoutMs` and
`maxRetries`.

## Webhooks

Verify each delivery with your endpoint's signing secret. Verify the raw
request body, before you parse it:

```ts
import express from 'express'

app.post('/pyas/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await pyas.webhooks.constructEvent(req.body, req.header('Pyas-Signature'), process.env.PYAS_WEBHOOK_SECRET!)
    // event.id is the same on every retry, so skip events you have already processed
    console.log(event.type, event.data)
    res.sendStatus(200)
  } catch {
    res.sendStatus(400)
  }
})
```

`verifyWebhook` and `constructWebhookEvent` also work without a client. For
your own tests, `signWebhookForTest` signs a body the same way Pyas does.

## Connecting accounts

You can connect your users' accounts in two ways. You can use PyasConnect, the
connect component, or you can build your own screens.

**With PyasConnect**, the component on your page requests a connect session
from your backend each time someone connects an account. Your backend needs
one endpoint, created with `pyas.connect.sessionHandler()`. It works without a
login in your app.

```ts
// Express, or Node's own http server
app.post('/pyas/session', pyas.connect.sessionHandler())

// Next.js route handlers, Hono, Bun, Cloudflare Workers: it returns a Response
export const POST = pyas.connect.sessionHandler()
```

**Optional: save your own user ID on the account.** If your app has its own ID
for each user, pass a function that returns it. Pyas saves it on the account as
`subjectId`, so you can find that user's accounts later:

```ts
app.post('/pyas/session', pyas.connect.sessionHandler((req) => req.user.id))
```

In this example, `req.user.id` represents wherever your app stores the ID of
the user who is connecting. The function can also return the session's options
instead of an ID: `{ subjectId, providers, loginHint }`.

**With your own screens**, you show your own provider buttons and run the
sign-in flow from your server. This works like v1's `/{provider}/oauth` and
`/{provider}/connect` endpoints. First, call `pyas.connect.oauth` to get the
sign-in URL:

```ts
pyas.connect.oauth({ provider, state })
```

When the person returns, call `pyas.connect.accounts.create` with the code they
return with:

```ts
pyas.connect.accounts.create({ provider, code, subjectId })
```

Together, the flow looks like this:

```ts
const { url } = await pyas.connect.oauth({ provider: 'google', state: 'your-state' })
// Redirect the person to url. They return with code and state. With Pyas Auth, they return to the
// provider's Redirect URL set under Provider setup. With Native Auth, they return to your own callback URL.
const account = await pyas.connect.accounts.create({ provider: 'google', code, subjectId: user.id })
```

## Files

```ts
// upload: the bytes, a Blob or a stream
await pyas.events.attachments.upload({ eventId, accountId, name: 'agenda.pdf' }, file)

// download
const file = await pyas.events.attachments.content({ eventId, attachmentId, accountId })
file.data      // ArrayBuffer
file.location  // set instead of data when the file is stored elsewhere (Google Drive), so fetch it yourself
```

The SDK never follows redirects, so your API key is only ever sent to Pyas.

## Everything else

- Response details: every object the SDK returns has a non-enumerable
  `lastResponse` property (`status`, `traceId`, `provider`, `meta`, `headers`).
  A page has the same details in `page.response`.
- `pyas.webhooks.listen()` streams the sandbox's webhook events as they happen.
- `pyas.request` calls any operation by its ID:

  ```ts
  pyas.request('events.list', { ... })
  ```

- `pyas.manage` sets up an app: its settings and allowed origins, sandbox
  webhooks and test keys. It needs a person's access token (the CLI's
  `pyas login` gets one). With an API key, it can only read the key's own app.

  ```ts
  const pyas = new Pyas({ accessToken: () => getAccessToken() })
  const app = await pyas.manage.apps.get({ appId })
  app.setup.nextStep // what to do next, in plain words
  ```

- Types include `Event`, `Calendar` and `Schemas['WebhookEndpoint']`. For any
  operation, use `Params<'events.create'>` or `Data<'events.create'>`.

The client accepts these options:

| Option | Default |
|---|---|
| `apiKey` | `PYAS_API_KEY` |
| `accessToken` | None. A person's access token, or a function that returns one, used instead of a key for `pyas.manage`. |
| `baseUrl` | `PYAS_API_URL`, otherwise `https://api.pyas.io` |
| `timeoutMs` | 30 000 |
| `maxRetries` | 2 |
| `fetch` | The global `fetch` |
| `appInfo` | None. When set, it's added to the `User-Agent` header. |

## License

MIT
