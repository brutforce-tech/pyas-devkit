---
name: pyas
description: Integrate the Pyas calendar API (Google Calendar, Microsoft Outlook, Zoom and virtual calendars through one API) into an app. Use when the user wants to connect people's calendars, list or create events, find free times, book meetings, or receive calendar webhooks, or when the project already uses @pyas/sdk, PyasConnect or a PYAS_API_KEY.
---

# Integrating Pyas

Pyas is one API for Google Calendar, Microsoft Outlook, Zoom and virtual
calendars. An app connects people's calendars once. It can then read and write
events, find free times and receive webhooks the same way for every provider.
Follow this guide in order, and test each step against the sandbox before you
move on.

## 1. Start in the sandbox, with a test key

- Ask the user for a **test key** (`pyas_sk_test_...`). They can create one
  under their app's API keys in the Pyas dashboard. Never ask for a live key
  during development.
- Check that `.gitignore` covers the project's env file. Then add the key to
  the env file as `PYAS_API_KEY`. Never write a key into source code.
- A test key works only in the app's sandbox. The sandbox has sample people
  (Avery Brooks, Sam Patel and others) with calendars and a week of events,
  plus simulated Google, Outlook and Zoom accounts. The sandbox doesn't connect
  to any real calendar.
- To see the sandbox's people and IDs, run `npx @pyas/cli sandbox` or call
  `await pyas.sandbox.get()`. The CLI command requires
  `npx @pyas/cli login --key <test key>` first, or `PYAS_API_KEY` set. Use these
  real IDs when you test your code.
- `npx @pyas/cli sandbox reset --yes` resets the sandbox to its sample data.

For a new project, the CLI creates a working starter with everything below
already set up, including an `AGENTS.md` file:

```bash
npx @pyas/cli init --template nextjs|nuxt|express <dir>
```

## 2. Call the API through the SDK, on the server

```bash
npm install @pyas/sdk
```

```ts
import { Pyas } from '@pyas/sdk'

// Reads PYAS_API_KEY from the environment.
const pyas = new Pyas()
```

- Create one client and reuse it. Use it only in server code, because the API
  key must never be sent to the browser.
- Every method returns the response's `data`. Awaiting a list method returns
  one page. To iterate over every item, use `for await`:

  ```ts
  for await (const item of pyas.events.list(...))
  ```

- See [reference/sdk.md](reference/sdk.md) for the calls most apps need:
  people and accounts, events, free times and booking, and keeping a copy in
  sync.

## 3. People are subjects, and calendars are accounts

- Each connected calendar is an **account** (`accountId`). Each person in the
  app is a **subject**. The subject is the app's own user ID, sent as
  `subjectId` when the person connects.
- To look up a person's calendars, and their events across every calendar,
  use these calls:

  ```ts
  pyas.accounts.list({ subjectId })
  pyas.events.list({ subjectId, from, to, expand: true })
  ```

  Store the user's ID, not lists of account IDs.
- Zoom accounts hold meetings, not calendars. Leave them out of free/busy and
  meeting-time requests (`account.provider === 'zoom'`).

## 4. Connect accounts

There are two ways to connect accounts: PyasConnect, or the app's own screens.

### With PyasConnect

1. The app's server adds one endpoint, created with
   `pyas.connect.sessionHandler()`. The endpoint creates a connect session and
   returns its token. To save the signed-in person's ID on the account, pass a
   function that returns it:

   ```ts
   app.post('/api/pyas-session', pyas.connect.sessionHandler((req) => req.user?.id))
   ```

   When the framework passes no `res`, as in a Next.js route handler, the
   handler returns a Response. The user ID comes from the app's own login,
   never from the page.
2. The page shows PyasConnect (`@pyas/connect-react`, `@pyas/connect-vue`, or
   the `<pyas-connect>` element from `@pyas/connect`). Give it a
   `getSessionToken` function that requests a new token for each attempt. A
   session works once and expires after 10 minutes.
3. On `connected`, the event's data includes the new `accountId`, `provider`
   and `email`.

With a test key, PyasConnect opens the Pyas sandbox's sign-in instead of
Google's or Microsoft's and connects a sample account in the sandbox, so the
whole flow can be built and tested before going live. With a live key, the same
code connects real calendars. Account imports and connecting
without PyasConnect need a live key: with a test key they return
`AUTH_SANDBOX_MISMATCH`. Never put the API key in the page.

PyasConnect works with both Pyas Auth and Native Auth. Its own endpoints
(`/v2/connect/info`, `/authorize`, `/complete`) are for the component only.

### With the app's own screens

The app shows its own provider buttons, and its server runs the sign-in flow
with the API key. This flow uses no session and no token. It works like v1's
`/{provider}/oauth` and `/connect` endpoints.

1. Get the sign-in URL, then redirect the person to `url`:

   ```ts
   const { url } = await pyas.connect.oauth({ provider, state })
   ```

2. The person returns with `code` and the same `state`. With **Pyas Auth**,
   they return to the provider's Redirect URL, set under Provider setup in the
   dashboard. With **Native Auth** (the app's own OAuth app), they return to
   the app's own callback URL.
3. Save the account. The call returns the account, so store
   `account.accountId`:

   ```ts
   const account = await pyas.connect.accounts.create({ provider, code, subjectId: user.id })
   ```

## 5. Verify every webhook

```ts
import { constructWebhookEvent } from '@pyas/sdk'

// rawBody: the request body exactly as received (a string or bytes), never re-serialized JSON.
const event = await constructWebhookEvent(rawBody, request.headers['pyas-signature'], process.env.PYAS_WEBHOOK_SECRET)
```

- Verify the **raw body** before you parse it. A body that was parsed and
  serialized again no longer matches its signature.
- Reject a delivery that fails verification with `400`. Signatures older than
  5 minutes fail verification, so replayed deliveries are rejected.
- Respond with a 2xx status quickly, then do slow work in the background.
- A delivery can arrive more than once. `event.id` is the same on every retry,
  so skip IDs you already processed.
- During development, this command forwards the sandbox's events to the local
  handler, signed as in production, and prints the signing secret to use:

  ```bash
  npx @pyas/cli webhooks listen --forward http://localhost:3000/<your webhook path>
  ```

See [reference/webhooks.md](reference/webhooks.md) for handlers in Express,
Next.js, Nuxt and Node's `http` module.

## 6. Write safely

- Creates that accept an `Idempotency-Key` (`events.create`, `events.import`,
  `events.quickAdd`) get one from the SDK automatically, so the SDK's own
  retries never create anything twice. When the app itself may retry (a job
  queue, a double click), pass a key that stays the same for the same booking:

  ```ts
  pyas.events.create(params, { idempotencyKey: 'booking-' + booking.id })
  ```

- To update or delete an event only if nobody changed it since you read it,
  pass its version:

  ```ts
  pyas.events.update(params, { ifMatch: event.version })
  ```

  A conflict returns `RESOURCE_CONFLICT`. Read the event again and decide what
  to do.

## 7. Handle errors by code, and keep the trace ID

Every failure is a `PyasError`. Its subclasses are `ValidationError`,
`AuthenticationError`, `PermissionError`, `NotFoundError`, `ConflictError`,
`RateLimitError`, `ApiError` and `ConnectionError`. Each error includes these
properties:

- `code` is stable, such as `RESOURCE_NOT_FOUND`. Branch on it, never on
  `message`.
- `hint` explains how to fix the problem. Show it to the developer, or log it.
- `docs` is a link to the code's documentation page.
- `traceId` identifies the request. Log it with every failure.

The SDK already retries the requests that are safe to retry, and follows
`Retry-After` on `429`. See [reference/errors.md](reference/errors.md) for the
codes you will see and what to do about each one.

## 8. Debug with the CLI or the MCP server

- `npx @pyas/cli logs get <traceId>` shows what a request did and why it failed.
- `npx @pyas/cli logs tail --failed` shows the latest failures.
- `npx @pyas/cli errors explain <CODE>` explains what a code means and how to fix
  it.
- To call any operation and check a hypothesis without writing code, run:

  ```bash
  npx @pyas/cli request <operationId> --params '<json>'
  ```

- The MCP server provides the same features as tools:

  ```bash
  claude mcp add pyas --env PYAS_API_KEY=pyas_sk_test_... -- npx -y @pyas/mcp
  ```

- Docs: https://developer.pyas.io, and https://developer.pyas.io/llms.txt for
  a condensed version.

## Before you finish

- [ ] The key is read from the environment, only on the server, and the env
      file is git-ignored.
- [ ] You ran the code against the sandbox, and it worked with real sandbox
      IDs.
- [ ] Webhook handlers verify the raw body and skip duplicate `event.id`s.
- [ ] Errors are handled by `code`, and their `traceId` is logged.
- [ ] Connect sessions are created on the server, one per attempt.
