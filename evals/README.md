# Evaluating coding agents on Pyas integrations

Real integration tasks for a coding agent, each with a checker that verifies
the result against the Pyas sandbox, never by reading the code.

| Task | The agent writes | The checker verifies |
|---|---|---|
| `list-events` | A script that lists Avery Brooks's events for the next 7 days, across all of her calendars | Every event of the window is listed, occurrences of recurring events included, nothing else, in start order |
| `book-meeting` | A script that books 30 minutes with Jordan Lee at the first time both are free, within working hours | The event exists on Avery's calendar, lasts 30 minutes, invites Jordan, overlaps nothing on either person's calendars, and is at the first free time |
| `verify-webhooks` | An HTTP server that receives webhooks | Signed deliveries get `200`, including a pretty-printed body; changed, unsigned, wrongly signed and stale deliveries get `400`; each event is recorded once |
| `handle-errors` | A script that reads one event | Success prints the event; a missing event and a wrong key exit with `1` and print the error's code, hint and trace ID |

The tasks and checkers are in [`tasks.ts`](tasks.ts).

## The checkers are tested

A checker that passes everything would make any agent look good. So every
checker runs against a reference solution, which must pass, and against broken
ones, which must fail: a script that reads one calendar without expanding
recurring events, a booking at a busy time, a webhook server that doesn't
verify signatures, one that verifies re-serialized JSON instead of the raw
body, and error handling that prints only the message.
They are in [`solutions/`](solutions).

```bash
npm run build
npm run test:evals    # against a Pyas API, with the SDK's end-to-end settings (the repository README)
```

CI runs this on every push.

## Running an agent

`npm run evals` gives each task to Claude Code (headless), in a fresh folder
with `@pyas/sdk` installed and the [Pyas skill](../skills/pyas) in
`.claude/skills/pyas`, then runs the task's checker:

```bash
ANTHROPIC_API_KEY=... PYAS_API_KEY=pyas_sk_test_... npm run evals
npm run evals -- --task book-meeting --max-turns 30
npm run evals -- --no-skill          # the baseline, to measure what the skill adds
```

It calls a real model, which costs money, so it runs only when
`ANTHROPIC_API_KEY` is set; without it, it prints a message and does nothing.
It needs Claude Code installed (`claude`), and a test key: the agent works in
the sandbox only, with permission to edit files and run `node`, `npm` and
`npx @pyas/cli`, and nothing else. `PYAS_API_URL` points it at another API.
Results, with each check, the agent's turns and its cost, go to
`evals/results/`.
