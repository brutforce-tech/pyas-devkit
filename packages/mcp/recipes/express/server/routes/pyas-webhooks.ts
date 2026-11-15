import { constructWebhookEvent } from '@pyas/sdk'
import express, { Router } from 'express'

/**
 * Webhook deliveries from Pyas. Pyas signs each one, so this route checks the signature against
 * the raw body, before parsing it, with PYAS_WEBHOOK_SECRET. Mount it before app.use(express.json()):
 * once the body is parsed, the raw text is gone and no signature matches.
 */
export const pyasWebhooks = Router().post('/api/pyas/webhooks', express.raw({ type: '*/*' }), async (req, res) => {
    const secret = process.env.PYAS_WEBHOOK_SECRET
    if (!secret) {
        res.status(500).json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set PYAS_WEBHOOK_SECRET to the endpoint\'s signing secret.' } })
        return
    }
    let event
    try {
        event = await constructWebhookEvent(req.body as Buffer, req.get('pyas-signature'), secret)
    } catch {
        res.status(400).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } })
        return
    }
    // Answer quickly and do slow work afterwards. A delivery can arrive more than once:
    // event.id is the same on every retry, so use it to skip ones you have already handled.
    console.log(`Pyas webhook: ${event.type} (${event.id})`)
    res.json({ received: true })
})
