# pyas

The [Pyas](https://pyas.io) CLI. Use it to work with Google and Outlook
calendars and Zoom conferencing from your terminal, by yourself or through
your coding agent.

```bash
npx @pyas/cli login --key pyas_sk_test_...
npx @pyas/cli accounts list
```

Create a test key (`pyas_sk_test_...`) under your app's API keys in the
dashboard. A test key works only in your app's sandbox, which has sample people
on Pyas calendars with a week of events. The sandbox doesn't connect to any
real calendar.

## Commands

```bash
pyas login                                    # signs you in through the dashboard, to set up your apps
pyas apps list                                # lists your apps
pyas apps show <appId>                        # shows an app's settings, its setup checklist and the next step
pyas apps create "Booking page" --origin https://my-app.example.com
pyas apps update <appId> --add-origin https://preview.example.com
pyas keys test <appId>                        # creates a test key and prints it once
pyas webhooks create <appId> <url>            # adds a sandbox webhook endpoint and prints its signing secret once

pyas init --template nextjs|nuxt|express [dir]   # creates a starter app, with your test key in its .env
pyas status                                   # shows the key and API in use, and what the key has access to
pyas accounts list [--subject user_42]        # lists connected calendars
pyas accounts status <accountId>              # checks whether it can sync, and if not, why and the fix
pyas accounts status --needs-attention        # lists every account in the app that needs fixing

pyas events list --account <id> [--days 7] [--query standup]
pyas events get <eventId> --account <id>
pyas events create --account <id> --title "Intro call" --start 2026-10-21T15:00:00Z --duration 30 \
  [--attendee ana@example.com] [--meeting meet|teams|zoom]
pyas events delete <eventId> --account <id> --yes

pyas times --accounts <id>,<id> --duration 30 [--days 5]   # finds times when everyone is free

pyas webhooks listen --forward http://localhost:3000/webhooks
pyas logs tail [--failed]
pyas logs get <traceId>                       # shows what a request did, and why it failed
pyas errors explain CONNECTION_NOT_FOUND
pyas sandbox | pyas sandbox reset

pyas request <operationId> --params '{"accountId":"..."}'   # calls any operation
```

### Start a project

`pyas init --template <name> [dir]` creates a starter app for Next.js, Nuxt or
Express. The app is set up with the SDK, PyasConnect (with connect sessions
created on the app's server) and a webhook endpoint that verifies signatures.
Each starter includes a README and an `AGENTS.md` file for coding agents.

If your saved key (or `PYAS_API_KEY`) is a test key, `init` writes it into the
app's env file, and the app's `.gitignore` keeps that file out of git. The CLI
never writes a live key into a project.

### Webhooks while you develop

`pyas webhooks listen --forward <url>` forwards your sandbox's webhook events to
your local handler as they happen. Each forwarded event has the same headers
and signature as a real delivery. The command prints a signing secret for the
session. Use it to verify signatures during development, so your handler runs
exactly as it will in production.

## For scripts and coding agents

- `--json` works with every command. It writes only the data to stdout.
  `logs tail` and `webhooks listen` write one JSON object per line. Messages
  for people go to stderr.
- `--yes` skips confirmation prompts. Without a terminal and without `--yes`, a
  command that would delete something fails instead of waiting for input.
- Exit codes:
  - `0`: the command succeeded.
  - `1`: the API rejected the request, or the CLI couldn't connect to it. The
    CLI prints the error's code, hint, docs link and trace ID, in JSON with
    `--json`.
  - `2`: the command was invalid.

## Signing in

`pyas login` signs you in to set up your apps:

1. The terminal shows a code, such as `ABCD-EFGH`, and opens the dashboard's
   sign-in page.
2. Sign in if you aren't already, type the code and select **Approve**.
3. The terminal finishes on its own.

Only approve a code from a terminal you're using. Never type a code someone
sent you.

The sign-in lasts until you sign out, and it renews itself while you use it.
It can do what you can do in the dashboard for your apps' setup, in every
organization you belong to: change an app's settings and allowed origins, add
sandbox webhooks and create test keys. Live keys and live webhooks are made in
the dashboard only. To end the sign-in, run `pyas logout`, or select
**Disconnect** next to Pyas CLI under **Connected tools** on your dashboard
profile.

A coding agent that can't wait on a command can sign in in two steps:

```bash
pyas login --no-wait --json   # prints the code and the page to open, then exits
pyas login --wait             # finishes once the code is approved
```

## The key

`pyas login --key <key>` verifies the key and saves it in your config folder,
never in your project. The calendar commands (`accounts`, `events`, `times`,
`logs`, `sandbox`) use the key. The config file is `~/.config/pyas/config.json`,
or `%APPDATA%\pyas\config.json` on Windows. When `PYAS_API_KEY` is set, it
overrides the saved key, which is useful in CI. `pyas logout` deletes the saved
key and the sign-in.

`--api-url` or `PYAS_API_URL` sets the API's address. The default is
`https://api.pyas.io`.

## License

MIT
