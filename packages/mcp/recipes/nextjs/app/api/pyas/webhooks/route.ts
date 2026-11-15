import { constructWebhookEvent } from '@pyas/sdk'

/**
 * Webhook deliveries from Pyas. Pyas signs each one, so this route checks the signature against
 * the raw body, before parsing it, with PYAS_WEBHOOK_SECRET: JSON that was parsed and turned back
 * into text no longer matches.
 */
export async function POST(request: Request) {
    const secret = process.env.PYAS_WEBHOOK_SECRET
    if (!secret) return Response.json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set PYAS_WEBHOOK_SECRET to the endpoint\'s signing secret.' } }, { status: 500 })
    let event
    try {
        event = await constructWebhookEvent(await request.text(), request.headers.get('pyas-signature'), secret)
    } catch {
        return Response.json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } }, { status: 400 })
    }
    // Answer quickly and do slow work afterwards. A delivery can arrive more than once:
    // event.id is the same on every retry, so use it to skip ones you have already handled.
    console.log(`Pyas webhook: ${event.type} (${event.id})`)
    return Response.json({ received: true })
}
