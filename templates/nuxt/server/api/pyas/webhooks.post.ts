import { constructWebhookEvent } from '@pyas/sdk'

/**
 * Webhook deliveries from Pyas. The signature is checked against the raw body, before it is
 * parsed: JSON that was parsed and serialized again no longer matches.
 */
export default defineEventHandler(async (event) => {
    const secret = process.env.PYAS_WEBHOOK_SECRET
    if (!secret) {
        setResponseStatus(event, 500)
        return { error: { code: 'NO_WEBHOOK_SECRET', message: 'Set PYAS_WEBHOOK_SECRET to your endpoint\'s signing secret.' } }
    }
    let delivery
    try {
        delivery = await constructWebhookEvent((await readRawBody(event, 'utf8')) ?? '', getHeader(event, 'pyas-signature'), secret)
    } catch {
        setResponseStatus(event, 400)
        return { error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } }
    }
    // Respond quickly, and do slow work in the background. A delivery can arrive more than
    // once: delivery.id is the same on every retry, so use it to skip duplicates.
    console.log(`Pyas webhook: ${delivery.type} (${delivery.id})`)
    return { received: true }
})
