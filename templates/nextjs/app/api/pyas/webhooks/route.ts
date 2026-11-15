import { constructWebhookEvent } from '@pyas/sdk'

/**
 * Webhook deliveries from Pyas. The signature is checked against the raw body, before it is
 * parsed: JSON that was parsed and serialized again no longer matches.
 */
export async function POST(request: Request) {
    const secret = process.env.PYAS_WEBHOOK_SECRET
    if (!secret) return Response.json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set PYAS_WEBHOOK_SECRET to your endpoint\'s signing secret.' } }, { status: 500 })
    let event
    try {
        event = await constructWebhookEvent(await request.text(), request.headers.get('pyas-signature'), secret)
    } catch {
        return Response.json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } }, { status: 400 })
    }
    // Respond quickly, and do slow work in the background. A delivery can arrive more than
    // once: event.id is the same on every retry, so use it to skip duplicates.
    console.log(`Pyas webhook: ${event.type} (${event.id})`)
    return Response.json({ received: true })
}
