import { isPyasError } from '@pyas/sdk'
import type { H3Event } from 'h3'

/** A Pyas error as the route's response, with its code, hint and trace ID (quote the trace ID to support). */
export const pyasErrorResponse = (event: H3Event, error: unknown) => {
    if (!isPyasError(error)) throw error
    setResponseStatus(event, error.status || 502)
    return { error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }
}
