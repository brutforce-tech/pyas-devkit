# How this project uses Pyas

This is a Next.js app (App Router, TypeScript) that uses Pyas for calendars:
Google Calendar, Microsoft Outlook and Zoom through one API. Follow these
patterns when you change it.

## Where things are

- `lib/pyas.ts`: the only place a Pyas client is created. Import `pyas()` from
  there, in route handlers and server components only.
- `lib/user.ts`: the signed-in person's ID, used as the Pyas `subjectId`.
  Replace the stub with the app's own authentication.
- `lib/calendar.ts`: calendar logic (accounts, events, booking).
- `app/api/pyas/`: the route handlers for PyasConnect, booking and webhooks.
- `app/connect/connect-calendar.tsx`: the client component with PyasConnect.

## Rules

1. **Keep the API key on the server.** Never import `lib/pyas.ts` from a file
   with `'use client'`, and never expose `PYAS_API_KEY` with a `NEXT_PUBLIC_`
   name. Never commit `.env.local`.
2. **Develop against the sandbox.** Use a test key (`pyas_sk_test_...`). It works
   only in the app's sandbox, which has sample people, calendars and events.
   `npx @pyas/cli sandbox` lists them with their IDs. A live key is for production only.
3. **People are subjects.** Pass the app's own user ID as `subjectId` when you
   create a connect session, and list a person's accounts or events with
   `subjectId` rather than storing account IDs per user.
4. **Connect calendars with connect sessions.** PyasConnect gets a session token
   from `POST /api/pyas/connect-session` through `getSessionToken`, a new one for
   every attempt (a session works once and expires after 10 minutes). With a test
   key, the session connects a sample account in the sandbox; with a live key, a
   real calendar.
5. **Verify every webhook.** Call `constructWebhookEvent(await request.text(), signature, secret)`
   from `@pyas/sdk` on the raw body, before any JSON parsing. Respond with a 2xx
   status quickly, and skip duplicates by `event.id` (retries reuse it).
6. **Write safely.** The SDK sends an `Idempotency-Key` with every create, so a
   retry never creates twice. To change an event only if nobody else changed it,
   pass `{ ifMatch: event.version }` as the request options.
7. **Handle errors by code.** The SDK throws `PyasError` (and subclasses such as
   `NotFoundError`) with `code`, `hint`, `docs` and `traceId`. Branch on `code`,
   never on `message`. Show the hint to the developer, and log the trace ID.
8. **Read calendars on every request.** Pages that show calendar data use
   `export const dynamic = 'force-dynamic'`, so they are never cached at build.

## Debugging

- `npx @pyas/cli logs get <traceId>`: what a request did and why it failed.
- `npx @pyas/cli errors explain <CODE>`: what an error code means and how to fix it.
- `npx @pyas/cli webhooks listen --forward http://localhost:3000/api/pyas/webhooks`:
  the sandbox's webhooks, signed as in production, sent to this app.
- The Pyas MCP server gives a coding agent the same tools:
  `claude mcp add pyas --env PYAS_API_KEY=pyas_sk_test_... -- npx -y @pyas/mcp`.
- Docs: https://developer.pyas.io (and https://developer.pyas.io/llms.txt).

## Commands

```bash
npm run dev        # http://localhost:3000
npm run typecheck
npm run build && npm start
```
