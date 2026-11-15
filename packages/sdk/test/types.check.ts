/**
 * Compiled, never run (npm run typecheck): what a developer's editor sees. A line marked
 * @ts-expect-error must fail to compile, or this file fails the type check.
 */
import { Pyas, type Event, type Params } from '../src'

declare const pyas: Pyas

export const checks = async () => {
    // Lists: one typed page when awaited, typed items when iterated.
    const page = await pyas.events.list({ accountId: 'acc_1', from: '2026-10-19T00:00:00Z', to: '2026-10-26T00:00:00Z' })
    const first: Event | undefined = page.data[0]
    const title: string | undefined = first?.title
    const next: string | null = page.nextCursor
    for await (const event of pyas.events.list({ subjectId: 'user_42' })) {
        const startsAt: string = event.startsAt
        void startsAt
    }
    // Lists of ids as arrays, and the metadata filter.
    await pyas.events.list({ accountIds: ['a', 'b'], metadata: { orderId: '123' } })

    // A create answers the event; path parameters are required.
    const created = await pyas.events.create({ accountId: 'acc_1', title: 'Standup', startsAt: '2026-10-20T09:00:00Z', endsAt: '2026-10-20T09:15:00Z' })
    const id: string = created.id
    await pyas.events.update({ eventId: id, accountId: 'acc_1', title: 'Standup (moved)' }, { ifMatch: String(created.version) })
    // @ts-expect-error eventId is required
    await pyas.events.get({ accountId: 'acc_1' })
    // @ts-expect-error title is a string
    await pyas.events.create({ accountId: 'acc_1', title: 42, startsAt: 's', endsAt: 'e' })

    // Nested resources, binary in and out, events from the API.
    await pyas.webhooks.deliveries.replay({ deliveryId: 'del_1' })
    const file = await pyas.events.attachments.content({ eventId: id, attachmentId: 'att_1', accountId: 'acc_1' })
    const bytes: ArrayBuffer = file.data
    await pyas.events.attachments.upload({ eventId: id, accountId: 'acc_1', name: 'notes.txt' }, new Blob(['hi']))
    for await (const delivery of pyas.webhooks.listen()) void delivery.json()

    // Webhook verification from the client.
    const ok: boolean = await pyas.webhooks.verify('t=1,v1=00', '{}', 'whsec_x')

    // Params of any operation, by id.
    const params: Params<'freeBusy.query'> = { accountIds: ['a'], from: 'f', to: 't' } as Params<'freeBusy.query'>
    void [title, next, bytes, ok, params]
}
