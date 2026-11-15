# How this project uses Pyas

This is a Next.js app (App Router, TypeScript) with an AI chat that reads and
changes people's calendars through Pyas: Google Calendar, Microsoft Outlook and
Zoom through one API. It uses the Vercel AI SDK, `@pyas/ai-tools` and
PyasConnect (`@pyas/connect-react`). Follow these patterns when you change it.

## Where things are

- `app/page.tsx`: a server component. It loads the signed-in person's calendars
  (`lib/calendars.ts`) and shows the connect screen until they have one, then
  the chat.
- `app/chat.tsx`: the chat (`useChat`). A tool part in the
  `approval-requested` state is a change waiting for the person.
- `app/api/chat/route.ts`: the chat route. The model gets
  `pyasTools({ subjectId })` for the signed-in person.
- `app/approval.tsx` and `app/api/pyas-change/route.ts`: the approval card, and
  the route that reads the event a change is about with `describePyasChange`.
- `app/connect.tsx` and `app/api/pyas/connect-session/route.ts`: PyasConnect,
  and the route that makes a connect session with the person's ID as
  `subjectId`.
- `app/calendars.tsx` and `app/api/pyas/accounts/[accountId]/route.ts`: the
  calendars menu, and disconnecting a calendar after checking it is the
  person's own.
- `lib/user.ts`: the signed-in person's ID, used as the Pyas `subjectId`, and
  their default calendar, passed to the tools as `defaultAccountId`. Replace
  the stubs with the app's own authentication and records (the default is kept
  in a cookie here; Pyas doesn't store it).

## Rules

1. **Keep the keys on the server.** `PYAS_API_KEY` and `OPENAI_API_KEY` are read
   in route handlers only. Never import `@pyas/ai-tools` from a file with
   `'use client'`, and never use a `NEXT_PUBLIC_` name for a key. Never commit
   `.env.local`.
2. **One person's calendars.** Always pass the signed-in person's ID, from the
   app's own session, as `subjectId` (`pyasTools` refuses to build without one,
   and `allAccounts: true` is never for a chat users open): to `pyasTools`, to
   `connect.sessions.create` and to `accounts.list`. Never take it from the
   request body or from what the model says.
3. **Check the owner of an account ID from the page.** Before disconnecting or
   changing an account by an ID the browser sent, read it from Pyas and
   compare its `subjectId` with the signed-in person's.
4. **Keep approval on.** Don't pass `requireApproval: false`. Every change
   waits for the person, and a declined change is never sent.
5. **Show Pyas's data on the card.** Use `describePyasChange` for the event a
   change is about and the calendar it lands on (`calendar`), not the model's
   description of them.
6. **Pass a reason when the person declines.** Without one, the model may ask
   for the same change again.
7. **Offer fewer tools when you can.** `pyasTools({ subjectId, readOnly: true })`
   or `scope: ['events', 'availability']` gives the model less to work with.
8. **Develop against the sandbox.** Use a test key (`pyas_sk_test_...`). It works
   only in the app's sandbox, which has sample people, calendars and events, and
   PyasConnect connects sample accounts there. A live key needs no code change.

## Debugging

- `npx @pyas/cli logs get <traceId>`: what a request did and why it failed. A tool's
  error includes the trace ID.
- `npx @pyas/cli errors explain <CODE>`: what an error code means and how to fix it.
- Docs: https://developer.pyas.io/vercel-ai-sdk (and
  https://developer.pyas.io/llms.txt).

## Commands

```bash
npm run dev        # http://localhost:3000
npm run typecheck
npm run build && npm start
```
