# Pyas developer kit

This repository holds the tools for building on [Pyas](https://pyas.io), apart
from the API itself and PyasConnect, which has its own repository.

| Package | Description |
|---|---|
| [`@pyas/sdk`](packages/sdk) | The API v2 client for Node.js and TypeScript, with types generated from the API's OpenAPI document |
| [`@pyas/mcp`](packages/mcp) | The MCP server. It gives AI agents access to calendars, and gives coding agents the API reference, error codes and request logs. |
| [`@pyas/ai-tools`](packages/ai-tools) | The MCP server's tools for the Vercel AI SDK, LangChain, OpenAI and Anthropic, with scopes and the option to limit them to one person |
| [`pyas`](packages/cli) | The CLI (`npx @pyas/cli`), for developers and their coding agents. Every command accepts `--json`. |
| [Postman collection](packages/postman) | Every v2 operation and the reference's scenarios, with tests. It is generated from the OpenAPI document and published to Postman. |
| [Claude Code skill](skills) | Teaches a coding agent to integrate Pyas. It is [evaluated](evals) on real tasks that are checked against the sandbox. |
| [Starter templates](templates) | Next.js, Nuxt and Express apps set up with the SDK, PyasConnect and webhook signature verification. `pyas init --template <name>` creates one. |

Planned next: `pyas init` with device sign-in, which requires the API's management endpoints.

## Developing

```bash
npm install
npm test                 # unit tests
npm run typecheck
npm run build
```

The end-to-end tests run the SDK, the MCP server, the AI framework tools, the
CLI and the Postman collection against a real Pyas API (`npm run test:e2e` in
each package). Before running them, set `PYAS_E2E_API_URL` to a Pyas API, `PYAS_E2E_TEST_KEY` to a test key of an app
made for testing (the suites reset its sandbox) and `PYAS_E2E_LIVE_KEY` to a live key of the
same app.

The starter template tests (`npm run test:templates`, after `npm run build`)
create each template with `pyas init`, then install, build and run it against
the API. Until PyasConnect 2.0 is published to npm, the templates install it
from a built [pyas-connect](https://github.com/brutforce-tech/pyas-connect)
checkout. Pack it into a folder with this command, then set
`PYAS_CONNECT_PACKAGES=<folder>` as well as the settings above:

```bash
node templates/scripts/pack-connect.mjs <folder>
```


To run the evaluation's checkers against the API, use `npm run test:evals`.
Running a coding agent on the tasks (`npm run evals`) calls a real model and
requires `ANTHROPIC_API_KEY`. See [evals](evals).

When the API changes, start it, then run `npm run openapi:pull` in
`packages/sdk`, followed by `npm run generate`. The pull reads from
`PYAS_API_URL`, which defaults to `http://localhost:3030`. CI fails when the
committed snapshot no longer matches the API. Next, run
`npm run generate -w @pyas/postman` to regenerate the Postman collection from
the snapshot. CI also fails when the committed collection differs. Running the
collection requires the Postman CLI (see [packages/postman](packages/postman)).

## License

MIT
