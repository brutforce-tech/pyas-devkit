# @pyas/mcp

The [Pyas](https://pyas.io) MCP server. It gives AI agents access to Google
and Outlook calendars and Zoom conferencing through one API. It also gives
coding agents that build on Pyas the API reference, error codes and request
logs.

Start with a test key (`pyas_sk_test_...`). A test key works only in your app's
sandbox, which has sample people on Pyas calendars with a week of events. The
sandbox doesn't connect to any real calendar.

## Add it to your agent

**Claude Code**

```bash
claude mcp add pyas --env PYAS_API_KEY=pyas_sk_test_... -- npx -y @pyas/mcp
```

**Claude Desktop, Cursor, Windsurf** (their MCP settings file)

```json
{
  "mcpServers": {
    "pyas": {
      "command": "npx",
      "args": ["-y", "@pyas/mcp"],
      "env": { "PYAS_API_KEY": "pyas_sk_test_..." }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "pyas": {
      "command": "npx",
      "args": ["-y", "@pyas/mcp"],
      "env": { "PYAS_API_KEY": "pyas_sk_test_..." }
    }
  }
}
```

To offer only the tools that don't create, update or delete anything, add
`--read-only` to the arguments.

## Tools

| Tool | Description |
|---|---|
| `list_accounts` | Lists connected calendars, with their `accountId`, email and `subjectId` |
| `account_status` | Checks whether a calendar can sync, and if not, returns the reason and the fix |
| `accounts_needing_attention` | Lists every calendar in the app that needs to be fixed |
| `list_calendars` | Lists one account's calendars |
| `list_events` | Lists events between two times, for one account or every account of a person, with search |
| `get_event` | Returns one event with all its details |
| `create_event` | Creates an event with attendees and a Google Meet, Microsoft Teams or Zoom link |
| `update_event` | Updates an event, so attendees get an update, not a new invitation. It can add a video meeting to the event or remove it. With its version, the update is rejected if someone else changed the event first. |
| `delete_event` | Deletes an event and notifies its attendees |
| `respond_to_event` | Accepts, declines or tentatively accepts an invitation |
| `find_meeting_times` | Finds times when everyone is free, within each person's working hours, across Google, Outlook and Pyas calendars, and says whose hours were used |
| `get_free_busy` | Returns busy times without event details |
| `explain_error` | Explains what an error code means, its causes and the fix |
| `get_request` | Explains what a request did, by its trace ID |
| `list_recent_requests` | Lists the latest requests, optionally only the failed ones |
| `api_reference` | Searches the API's operations |
| `sandbox` | Returns the sandbox's people and IDs (test key only) |

Each tool tells the host whether it only reads data, or creates, updates or
deletes it, so your agent can ask you before it makes a change. With a live
key, the server also tells the agent that changes affect real people's
calendars.

Event titles, descriptions and attendees are written by other people. The
server marks that text as data in each answer, so the agent doesn't follow
instructions that someone put in an invitation.

### Setting up an app

| Tool | Description |
|---|---|
| `setup_status` | Shows what is done in the app's setup, what is left, and the next step |
| `go_live_checklist` | Lists what is left before the app works with real calendars, with the dashboard link where you finish it |
| `create_app` | Creates an app, with the addresses it runs at |
| `update_app` | Changes the app's name, description or website, or adds addresses it runs at, such as a preview URL |
| `get_test_key` | Creates a test key for the app's sandbox and returns it once |
| `create_webhook` | Adds a webhook endpoint in the sandbox, returns its signing secret once, and sends it a test delivery |
| `get_recipe` | Returns the code for one task on the platform the app is built on: each file and where it goes, the packages, the secret to set, and the steps |

`get_recipe` covers Lovable (TanStack Start server functions, or Supabase Edge
Functions in older projects), Bolt (Supabase Edge Functions), Replit and
Express, v0 and Next.js, and Base44 (backend functions). Its tasks are connecting a calendar, listing
upcoming events, booking a meeting at a free time, and receiving webhooks. The
key always stays in server code. With a test key, the code works on the
sandbox's sample person right away. With a live key, it uses the signed-in
person and asks people to sign in otherwise.

With an API key, the server offers `setup_status`, `go_live_checklist` and
`get_recipe` for the key's own app. Creating and changing need a person signed
in to Pyas.
Every answer ends with the next step. Plans, payment, live keys and live
webhooks are always done by you in the Pyas dashboard.

The same tools, built from the same definitions, are available in
[`@pyas/ai-tools`](../ai-tools) for agents built on the Vercel AI SDK,
LangChain, OpenAI or Anthropic.

The server also provides two resources, `pyas://api-reference` and
`pyas://errors`, and three prompts, `schedule-meeting`, `summarize-day` and
`debug-failed-request`.

## Over HTTP

```bash
npx @pyas/mcp --http --port 3333
```

The server accepts Streamable HTTP at `/mcp`. Each request sends its own key
in the `Authorization` header:

```
Authorization: Bearer pyas_sk_...
```

To serve it from your own HTTP server, behind your own sign-in, call
`handleHttpRequest` for each request to your MCP endpoint. Each request gets a
new server, so nothing is kept between requests:

```ts
import express from 'express'
import { Pyas } from '@pyas/sdk'
import { handleHttpRequest } from '@pyas/mcp'

const app = express()
app.post('/mcp', express.json(), async (req, res) => {
  const pyas = new Pyas({ apiKey: keyForThisRequest(req) })
  await handleHttpRequest(req, res, { pyas, body: req.body })
})
```

To have a person approve changes, pass `beforeChange`. It is called before
every tool that changes a calendar (create, update or delete an event, or reply
to an invitation), with the tool's name and input. Return
`{ proceed: true }` to make the change, or `{ proceed: false, text }` to send
the agent `text` instead:

```ts
await handleHttpRequest(req, res, {
  pyas,
  body: req.body,
  beforeChange: async ({ tool, input }) => (await approvedByUser(tool, input))
    ? { proceed: true }
    : { proceed: false, text: 'Not made yet. Ask the user to approve it, then try again.' },
})
```

The package works with both `import` and `require`.

## Configuration

| Variable | Description |
|---|---|
| `PYAS_API_KEY` | Your Pyas API key |
| `PYAS_API_URL` | The API's address. Default: `https://api.pyas.io` |
| `PYAS_MCP_READ_ONLY=1` | Offers only the read-only tools |

## License

MIT
