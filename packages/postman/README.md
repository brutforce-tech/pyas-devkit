# Pyas API v2 Postman collection

This package holds the Postman collection for the [Pyas](https://pyas.io) API
v2, [`pyas-api-v2.postman_collection.json`](pyas-api-v2.postman_collection.json)
(collection format v2.1). The collection is generated from the API's OpenAPI
document and tested against the API. It's published as
[Pyas API v2](https://www.postman.com/brutforce-tech/pyas-api/collection/cxwhgy1/pyas-api-v2)
in Pyas's public Postman workspace, next to v1's collection. Don't edit the file by hand. Regenerate it instead.

## What it holds

- **Every v2 operation**, in one folder per resource, as in the docs' reference.
  Each request includes its description, every parameter (with the example's
  parameters turned on), the example from the reference, and an example
  response built from the response schema. PyasConnect's browser-only requests
  are left out, as they are in Try it.
- **One place for the key.** A secret `apiKey` collection variable, empty in
  the file, is sent as `x-api-key` by the collection's auth. `baseUrl` is
  `https://api.pyas.io`.
- **A collection pre-request script** that does the following:
  - Reads `GET /v2/sandbox` once per key and stores the sandbox's IDs under the
    examples' names (`{{account.avery}}`, `{{event.avery.design}}`).
  - Calculates relative dates. For example, `{{in.1d.14:00}}` is tomorrow at
    14:00 UTC.
  - Encodes IDs in paths.
  - Creates a new `{{idempotencyKey}}` for each request that sends an
    `Idempotency-Key`.
- **The scenarios** from the reference's introduction. Each scenario is a
  folder of steps that run in order with the Collection Runner. A step stores
  what the next step needs as a collection variable (`{{slot.startsAt}}`). The
  Scenarios folder starts by resetting the sandbox.
- **Tests on every request.** The tests check the following:
  - The status. For the examples that the sandbox rejects, such as reconnect
    links that require a live key, the tests check that status and its
    error code.
  - The `X-Trace-Id` header.
  - `success` and `traceId` in the response.
  - For an error, its code, hint, trace ID and docs link.

## Commands

```bash
npm run generate -w @pyas/postman          # rewrite the collection from packages/sdk/openapi/v2.json
npm test -w @pyas/postman                  # unit tests, including: the committed file is up to date
npm run test:e2e -w @pyas/postman          # run it against the API with the Postman CLI
npm run publish:postman -w @pyas/postman   # update it in the public workspace (needs POSTMAN_API_KEY)
```

When the API changes, refresh the SDK's snapshot first (see the
[SDK](../sdk/README.md)), then run `npm run generate` here. CI regenerates the
collection and fails when the committed file differs.

## Running it against the API

`npm run test:e2e` runs the collection against a Pyas API, with the same
settings as the SDK's end-to-end suite: set `PYAS_E2E_API_URL` to a Pyas API, `PYAS_E2E_TEST_KEY` to a test key of an app
made for testing (the suites reset its sandbox) and `PYAS_E2E_LIVE_KEY` to a live key of the
same app. The suite
then does the following:

1. Checks that every operation in the API's own OpenAPI document is in the
   collection. A new operation fails the build until the collection includes
   it.
2. Runs every request and every scenario with the
   [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-overview/)
   (`postman collection run`). The requests run in an order that leaves each
   request the data it needs: a reset, then reads, creates, updates and
   deletes, then the scenarios. Any failed test fails the build.
3. Sends the webhook relay request (`GET /v2/webhooks/listen`) itself, as the
   collection defines it. The response is a server-sent event stream that
   stays open, and the Postman CLI waits for each response to end, so the CLI
   can't run that one request.

The Postman CLI runs a local collection file without signing in to Postman.
Install it once:

```bash
npm install --global --ignore-scripts postman-cli
```

`--ignore-scripts` skips the package's install script, which writes notes into
coding agents' instruction files in your home folder. The CLI works without
that script. Postman's own installers also work (see the Postman CLI docs). The
suite runs `postman` from the `PATH`, or the file in `POSTMAN_CLI`.

## Publishing

`npm run publish:postman` updates "Pyas API v2" in the "Pyas API" workspace
(postman.com/brutforce-tech/pyas-api) through the Postman API, or creates it
there the first time. It requires `POSTMAN_API_KEY`, an API key of the
brutforce-tech Postman team. Without that key, it prints a message and does
nothing. If the workspace isn't named "Pyas API", set `POSTMAN_WORKSPACE_ID`.
Postman's API doesn't accept the `secret` type of the `apiKey` variable, so the
published copy sends it as `string`; the file keeps `secret`. The "Publish the Postman collection"
workflow runs the command from GitHub Actions with the `POSTMAN_API_KEY`
secret.

## For the docs

The docs site serves this same file as `developer.pyas.io/postman.json`. At
build time, the site copies the following file from this repository:

```
packages/postman/pyas-api-v2.postman_collection.json
```
