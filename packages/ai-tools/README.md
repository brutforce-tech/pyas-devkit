# @pyas/ai-tools

Calendar tools for AI agents, from [Pyas](https://pyas.io). Pyas gives you
Google, Outlook and Zoom calendars through one API. This package provides
ready-made tools for the Vercel AI SDK, LangChain and LangGraph, OpenAI
function calling and Anthropic tool use.

These are the same tools as the [Pyas MCP server](../mcp), built from the same
definitions. They list accounts and events, create, update and delete events,
respond to invitations, and find times when everyone is free. If your agent
supports MCP, you can use the server. Otherwise, use this package.

```bash
npm install @pyas/ai-tools
```

Start with a test key (`pyas_sk_test_...`). A test key works only in your app's
sandbox, which doesn't connect to any real calendar. The tools read the key
from `PYAS_API_KEY` unless you pass `apiKey`.

## Changes wait for the person's approval

A tool that changes a calendar (creates, updates or deletes an event, or answers
an invitation) runs only after the person you act for approves it. Until then,
nothing is sent to Pyas. Each framework asks in its own way, as shown below. The
tools that only read run at once.

Show the person what they approve from Pyas's own data, not from what the model
says. For an update, a deletion or an answer to an invitation, the change comes
with `event`: the event as it is now in Pyas. A change that could never run,
such as one on another person's account or for an event that doesn't exist, is
refused at once, and the person isn't asked.

If your app already asks the person before a change runs, turn this off with
`requireApproval: false`.

## Vercel AI SDK

Requires the AI SDK 6 or later.

```ts
import { streamText } from 'ai'
import { pyasTools } from '@pyas/ai-tools/vercel'

const result = streamText({ model, messages, tools: pyasTools({ subjectId: 'user_42' }) })
```

A change stops with the tool part in the `approval-requested` state. Show it to
the person, and send their answer with `addToolApprovalResponse` from `useChat`.
With `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`,
the chat continues once every change has an answer. A declined change never runs.
When the person declines, pass a `reason`, such as "The user declined this
change. Leave it as it is.", or the model may ask again.

The tool part holds only the model's input. For the event as it is in Pyas, call
`describePyasChange({ tool, input }, options)` on your server, with the same
options as the tools.

## LangChain and LangGraph

Requires `@langchain/langgraph`. A change pauses the graph, so the agent needs a
checkpointer.

```ts
import { Command, MemorySaver } from '@langchain/langgraph'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { pyasToolkit } from '@pyas/ai-tools/langchain'

const agent = createReactAgent({ llm, tools: pyasToolkit({ subjectId: 'user_42' }), checkpointer: new MemorySaver() })
const config = { configurable: { thread_id: 'conversation_1' } }

const result = await agent.invoke({ messages: [{ role: 'user', content: 'Book a call with Riley tomorrow at 3pm' }] }, config)
// result.__interrupt__[0].value is { type: 'pyas_approval', tool, title, input, event }: show it to the person.
await agent.invoke(new Command({ resume: { approved: true } }), config)
```

Any other answer declines the change, and the model is told. Outside a graph, a
tool that changes something fails rather than run without approval.

## OpenAI function calling

```ts
import { pyasFunctionDefinitions, runPyasToolCalls } from '@pyas/ai-tools/openai'

const options = { subjectId: 'user_42' }
const response = await openai.chat.completions.create({ model, messages, tools: pyasFunctionDefinitions(options) })
const message = response.choices[0].message
const { results, pending } = await runPyasToolCalls(message.tool_calls, options)
```

`results` are the `tool` messages for the calls that ran. `pending` are the
changes waiting for the person, each with `title`, `input`, `event` (for a change
to an existing event) and the original `call`. Show them, then run them with the person's answers:

```ts
const answered = await runPyasToolCalls(pending.map((change) => change.call), { ...options, approved: ['call_abc'], declined: [] })
messages.push(message, ...results, ...answered.results)
```

For the Responses API, pass `api: 'responses'` and run the `function_call`
items with `runPyasFunctionCalls`, which works the same way. To save pending
changes between requests, type them as `PyasPendingToolCall` (Chat Completions)
or `PyasPendingFunctionCall` (Responses API).

## Anthropic tool use

```ts
import { pyasAnthropicTools, runPyasToolUses } from '@pyas/ai-tools/anthropic'

const options = { subjectId: 'user_42' }
const message = await anthropic.messages.create({ model, max_tokens: 1024, tools: pyasAnthropicTools(options), messages })
const { results, pending } = await runPyasToolUses(message.content, options)
```

`pending` works as with OpenAI, typed as `PyasPendingToolUse`. Once the person has answered, send every
`tool_result` of the turn in one user message:

```ts
const answered = await runPyasToolUses(pending.map((change) => change.call), { ...options, approved: ['toolu_abc'] })
messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: [...results, ...answered.results] })
```

The tool definitions don't require a key. The functions that run the requests
do.

## Options

| Option | Description |
|---|---|
| `apiKey` | A Pyas API key. Default: `PYAS_API_KEY`. |
| `baseUrl` | The API's address. Default: `PYAS_API_URL`, otherwise `https://api.pyas.io`. |
| `pyas` | Your own `Pyas` client from `@pyas/sdk`, instead of `apiKey` and `baseUrl`. |
| `subjectId` | Your app's ID for the person the agent acts for (see below). Required, unless you pass `allAccounts`. |
| `allAccounts` | `true` for an agent that works for you and reaches every account in the app (see below). |
| `defaultAccountId` | With `subjectId`: the person's default calendar, if your app lets them choose one (see below). |
| `scope` | Which tools to offer (see below). |
| `readOnly` | Offers only the tools that don't create, update or delete anything. |
| `requireApproval` | Whether a change waits for the person's approval. Default: `true`. |

### Whose calendars

Every call says whose calendars the tools reach. There's no default, so a
missing ID can't quietly give one user's assistant everyone's calendars.

- `subjectId`: one person. Pass your app's ID for the signed-in user, from your
  own session on the server. The tools then work only with that person's
  accounts. A request for any other account is rejected before it's sent to the
  API, with the code `TOOL_ACCOUNT_NOT_ALLOWED`, so the model can't choose
  another person. The tools that reach the whole app (accounts that need
  attention, request logs) aren't offered. Use it for any chat your users open.
- `allAccounts: true`: every account in the app, for an agent that works for
  you, such as an internal assistant or an operations script. Never use it for
  a chat your users open.

Without one of them, or with an empty `subjectId` (a session with no user),
building the tools throws an error that says which to pass.

### Which calendar

Someone can have several calendars connected, such as work Google and personal
Outlook. When they ask for a new event without saying where, the model asks
them which calendar to use.

If your app lets people choose a default calendar, pass it as a hint on each
request:

```ts
pyasTools({ subjectId: user.id, defaultAccountId: user.defaultCalendarId })
```

Pyas doesn't store it: keep it with the user in your own database. With it, the
model uses that calendar without asking unless the person names another,
`create_event` uses it when the model names none, and `list_accounts` marks it
`isDefault`. It's checked like any account, so one that isn't the person's is
refused. Empty or `null` means no default.

### What the person approves

A change that waits for approval comes with what to show the person, read from
Pyas rather than from the model:

- `calendar`: the account the change is made on, with its email, provider and
  `subjectId`. Show it, so someone with several calendars sees which one.
- `event`: for an update, a deletion or a reply, the event as it is now.
- `zoomAccount`: for a change that adds a Zoom meeting, the Zoom account that
  makes it.

`pending` (OpenAI, Anthropic) and `describePyasChange` (Vercel AI SDK) both
return them.

### Scopes

Give an agent only the tools it needs:

```ts
pyasTools({ subjectId, scope: ['read'] })                   // list and get, nothing that changes a calendar
pyasTools({ subjectId, scope: ['read', 'write'] })          // everything (the default)
pyasTools({ subjectId, scope: ['events'] })                 // event tools only
pyasTools({ subjectId, scope: ['events:read'] })            // list and get events only
pyasTools({ subjectId, scope: ['events', 'availability'] }) // events, and finding free time
```

The resources are `accounts`, `calendars`, `events`, `availability` and
`developer`. The developer tools are for coding agents. They explain error
codes and requests, search the API reference and list the sandbox's people.
They're offered only when you include `developer` in the scope. An unknown
scope throws an error, so a typo never gives an agent more access than you
intended.

## When something fails

A tool never throws an error to the model. Instead, it returns the API's error
with its code, a hint, a link to its documentation and the request's trace ID.
The model can then correct its input or tell the person what to do:

```json
{ "error": { "code": "VALIDATION_INVALID_BODY", "message": "...", "hint": "...", "docs": "https://developer.pyas.io/errors/VALIDATION_INVALID_BODY", "traceId": "trc_..." } }
```

When the input doesn't match a tool's schema, the tool returns
`TOOL_INVALID_INPUT` without sending a request.

## Dependencies

The package depends on `@pyas/sdk` and `zod` (3.25 or later, or 4). The
frameworks are optional peer dependencies. `@pyas/ai-tools/vercel` requires
`ai` 6 or later, and `@pyas/ai-tools/langchain` requires `@langchain/core` and
`@langchain/langgraph`. The OpenAI and Anthropic entry points return plain JSON
and don't require either SDK.

## License

MIT
