# Errors

Every failed request throws a `PyasError` with `code`, `message`, `hint`,
`docs`, `status` and `traceId`. Handle errors by `code`:

```ts
import { isPyasError } from '@pyas/sdk'

try {
    await pyas.events.get({ accountId, eventId })
} catch (error) {
    if (isPyasError(error) && error.code === 'RESOURCE_NOT_FOUND') return null
    if (isPyasError(error)) logger.error({ code: error.code, hint: error.hint, traceId: error.traceId })
    throw error
}
```

## The codes you will meet first

| Code | Status | What to do |
|---|---|---|
| `AUTH_INVALID_KEY` | 401 | The key is missing, unknown or revoked. Check `PYAS_API_KEY`. |
| `AUTH_SANDBOX_MISMATCH` | 403 | A test key was used with live data, or the reverse. Account imports and connecting without PyasConnect need a live key. To test connecting in the sandbox, use PyasConnect with a test key. |
| `AUTH_INSUFFICIENT_SCOPE` | 403 | The key lacks the permission (for example, a read-only key writing). |
| `VALIDATION_INVALID_BODY` | 400 | A field is missing or invalid. The message names the field. |
| `VALIDATION_INVALID_QUERY` | 400 | A query parameter is missing or invalid, such as `accountId`. |
| `VALIDATION_UNSUPPORTED_OPERATION` | 422 | The provider can't do this (for example, calendar groups on Google). Check the account's capabilities first. |
| `VALIDATION_IDEMPOTENCY_CONFLICT` | 422 | The idempotency key was already used for a different request. Use a new key for a new request. |
| `RESOURCE_NOT_FOUND` | 404 | No such calendar or event for this account. Check the ID and the `accountId`. |
| `RESOURCE_CONFLICT` | 409 | It changed since you read it (`ifMatch`). Read it again and retry. |
| `RESOURCE_SYNC_TOKEN_EXPIRED` | 410 | List again without the `syncToken`, and keep the new one. |
| `CONNECTION_NOT_FOUND` | 404 | No connected account for this request. Connect one with PyasConnect. |
| `CONNECTION_TOKEN_EXPIRED`, `CONNECTION_REVOKED` | 422 | The person must reconnect. `pyas.connect.sessions.create({ accountId })` makes a reconnect session for the same account. |
| `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT` | 503, 504 | The provider failed. The SDK already retried safe requests; retry later. |
| `RATE_LIMIT_EXCEEDED` | 429 | The SDK already waited for `Retry-After` and retried. Slow down. |

Every code has a page: `error.docs`, or https://developer.pyas.io/errors/<CODE>.

## Finding out what happened

- `npx @pyas/cli logs get <traceId>`: the request, the response, the error and hint,
  and what Pyas did for it (provider calls, webhooks).
- `npx @pyas/cli logs tail --failed`: the latest failed requests.
- `npx @pyas/cli errors explain <CODE>`: the code's meaning, causes and fix.
- With the MCP server: the `get_request`, `list_recent_requests` and
  `explain_error` tools.
