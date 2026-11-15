// node get-event.mjs <accountId> <eventId>: the event as JSON, or the API's error on stderr.
import { isPyasError, Pyas } from '@pyas/sdk'

const [accountId, eventId] = process.argv.slice(2)
try {
    const event = await new Pyas().events.get({ accountId, eventId })
    console.log(JSON.stringify({ id: event.id, title: event.title, startsAt: event.startsAt }))
} catch (error) {
    if (!isPyasError(error)) throw error
    console.error(`${error.code}: ${error.message}`)
    if (error.hint) console.error(`Hint: ${error.hint}`)
    console.error(`Trace ID: ${error.traceId}`)
    process.exitCode = 1
}
