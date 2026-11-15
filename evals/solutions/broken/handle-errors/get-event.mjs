// Broken on purpose: the error's message only, without its code, hint or trace ID.
import { Pyas } from '@pyas/sdk'

const [accountId, eventId] = process.argv.slice(2)
try {
    const event = await new Pyas().events.get({ accountId, eventId })
    console.log(JSON.stringify({ id: event.id, title: event.title, startsAt: event.startsAt }))
} catch (error) {
    console.error(`Something went wrong: ${error.message}`)
    process.exitCode = 1
}
