# Pyas starter templates

These are small apps set up with [Pyas](https://pyas.io). The starters
(`nextjs`, `nuxt` and `express`) each include:

- The SDK on the server.
- PyasConnect for connecting calendars, with connect sessions created on the
  app's server.
- A webhook endpoint that verifies signatures.
- A calendar page and a booking endpoint.

`nextjs-ai-chat` is an AI chat instead: a calendar assistant built with the
Vercel AI SDK and `@pyas/ai-tools`, which reads the signed-in person's calendars
and asks them before every change.

Each template works with a test key against your sandbox from the first run.
Each one also includes its own README and an `AGENTS.md` file for coding
agents.

| Template | Stack |
|---|---|
| [`nextjs`](nextjs) | Next.js (App Router), React, `@pyas/connect-react` |
| [`nuxt`](nuxt) | Nuxt, Vue, `@pyas/connect-vue` |
| [`express`](express) | Express 5, TypeScript, the `<pyas-connect>` element |
| [`nextjs-ai-chat`](nextjs-ai-chat) | Next.js, the Vercel AI SDK and `@pyas/ai-tools`: a calendar assistant that asks before every change |

To create one, use the CLI:

```bash
npx @pyas/cli init --template nextjs my-app
```

If you saved a test key with `pyas login` (or set `PYAS_API_KEY`), `init`
writes it into the app's env file.

## Tests

Each template has an end-to-end test in [`test/`](test). The test creates the
app with `pyas init`, then installs, builds and starts it. It then checks every
endpoint against the API's sandbox:

- The calendar page.
- Booking.
- The connect page.
- Connect sessions, made with a test key for the sandbox and with a live key
  for real calendars.
- Webhook signatures.

With the end-to-end settings set (the repository README):

```bash
npm run build
node templates/scripts/pack-connect.mjs <folder>   # PyasConnect 2.0, from a built pyas-connect checkout
PYAS_CONNECT_PACKAGES=<folder> npm run test:templates
```
