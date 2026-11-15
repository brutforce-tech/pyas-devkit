# Pyas skill for Claude Code

[`pyas/`](pyas) is a [Claude Code skill](https://code.claude.com/docs/en/skills)
that teaches a coding agent to integrate [Pyas](https://pyas.io) the way the
docs recommend. With the skill, the agent does the following:

- Starts in the sandbox with a test key.
- Keeps the API key on the server.
- Connects accounts with connect sessions and PyasConnect.
- Verifies webhooks against the raw body.
- Writes with idempotency keys and versions.
- Handles errors by code and logs their trace IDs.
- Debugs with the CLI or the MCP server.

`SKILL.md` is the main guide. The `reference/` files hold the details the agent
reads when it needs them:

- The SDK calls most apps use.
- Webhook handlers for Express, Next.js, Nuxt and Node.
- The error codes, and what to do about each one.

## Install

To install the skill for one project, copy the folder into the project's
`.claude/skills` folder:

```bash
mkdir -p .claude/skills && cp -r skills/pyas .claude/skills/pyas
```

To install it for every project on your computer, copy it to
`~/.claude/skills/pyas` instead. Claude Code uses the skill when a request is
about calendars or Pyas, or when you type `/pyas`.

## Evaluation

The [evaluation suite](../evals) gives a coding agent real integration tasks,
with and without this skill, and checks the results against the sandbox.
