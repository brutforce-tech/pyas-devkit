# Pyas starter for Next.js

A Next.js app (App Router) that uses [Pyas](https://pyas.io) to connect Google
and Outlook calendars, list a person's events, book meetings and receive
webhooks.

## Start

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

The app reads its settings from `.env.local` (see `.env.example`). If you
created it with `npx @pyas/cli init --template nextjs`, your test key is already
there. Otherwise, copy `.env.example` to `.env.local` and set `PYAS_API_KEY` to
a test key (`pyas_sk_test_...`) from your app's API keys in the Pyas dashboard.

A test key works only in your app's sandbox. The sandbox has sample people with
calendars and a week of events, and it doesn't affect any real calendar. In
this starter, the signed-in person is `sandbox_user_1` (Avery Brooks), so the
calendar page shows her events. Replace `lib/user.ts` with your own
authentication.

## What's here

| Path | What it does |
|---|---|
| `lib/pyas.ts` | The Pyas client, created once from `PYAS_API_KEY` (server code only) |
| `lib/calendar.ts` | A person's calendars and events, and booking the first free 30 minutes |
| `app/calendar/page.tsx` | The next 7 days, rendered on the server |
| `app/connect/` | The page with PyasConnect, the dialog people connect their calendar in |
| `app/api/pyas/connect-session/route.ts` | Creates a connect session for PyasConnect |
| `app/api/pyas/book/route.ts` | Books the first free 30 minutes tomorrow |
| `app/api/pyas/webhooks/route.ts` | Receives webhooks and checks their signature |

## Connect a calendar

The `/connect` page shows PyasConnect. Each attempt requests a new connect session from this app's
server (`POST /api/pyas/connect-session`), so the API key never leaves the
server.

With a test key, PyasConnect opens the Pyas sandbox's sign-in instead of
Google's or Microsoft's, and connects a sample account in your sandbox, so you
can build and test the whole flow before you go live. With a live key, the same
page connects real calendars.

## Webhooks

Pyas sends webhooks to `POST /api/pyas/webhooks`. The route verifies each
delivery's `Pyas-Signature` header against the raw body before it reads the
event. It rejects a delivery whose signature doesn't match with
`400 Bad Request`.

During development, forward your sandbox's webhooks to the app with the Pyas
CLI:

```bash
npx @pyas/cli webhooks listen --forward http://localhost:3000/api/pyas/webhooks
```

The command prints a signing secret. Set `PYAS_WEBHOOK_SECRET` in `.env.local`
to that secret, then restart the app.

In production, create the webhook endpoint in the dashboard, or with the CLI
and a live key:

```bash
npx @pyas/cli request webhooks.create --params '{"url":"https://your.app/api/pyas/webhooks"}'
```

Then use the signing secret from the response.

## Production

```bash
npm run build
npm start
```

Set `PYAS_API_KEY` and `PYAS_WEBHOOK_SECRET` in your host's environment. Use a
live key only there, never in a file you commit.

## Learn more

- Docs: https://developer.pyas.io
- `AGENTS.md`: how this project uses Pyas, for you and your coding agent
- `npx @pyas/cli help`: the CLI, for the sandbox, logs and webhooks
