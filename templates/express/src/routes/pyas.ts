import { constructWebhookEvent, isPyasError } from '@pyas/sdk'
import express, { Router, type Response } from 'express'
import { bookFirstFreeSlot } from '../lib/calendar.js'
import { pyas } from '../lib/pyas.js'
import { currentUserId } from '../lib/user.js'

export const pyasRoutes = Router()

/** A Pyas error as JSON, with its code, hint and trace ID (quote the trace ID to support). */
const sendError = (res: Response, error: unknown) => {
    if (isPyasError(error)) {
        res.status(error.status || 502).json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } })
        return
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: (error as Error).message } })
}

/**
 * A connect session for PyasConnect. The page requests a new one each time someone starts
 * connecting a calendar: a session works once and expires after 10 minutes.
 */
pyasRoutes.post('/api/pyas/connect-session', async (req, res) => {
    try {
        const session = await pyas().connect.sessions.create({ subjectId: currentUserId(req), providers: ['google', 'microsoft'] })
        res.json({ token: session.token })
    } catch (error) {
        sendError(res, error)
    }
})

/** Books the first free 30 minutes tomorrow on the person's calendar. */
pyasRoutes.post('/api/pyas/book', express.json(), async (req, res) => {
    try {
        const event = await bookFirstFreeSlot(currentUserId(req), String(req.body?.title || 'Meeting'))
        if (!event) {
            res.status(409).json({ error: { code: 'NO_FREE_TIME', message: 'No 30 minutes are free tomorrow.' } })
            return
        }
        res.status(201).json({ event: { id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt } })
    } catch (error) {
        sendError(res, error)
    }
})

/**
 * Webhook deliveries from Pyas. The signature is checked against the raw body, before it is
 * parsed: JSON that was parsed and serialized again no longer matches.
 */
pyasRoutes.post('/api/pyas/webhooks', express.raw({ type: '*/*' }), async (req, res) => {
    const secret = process.env.PYAS_WEBHOOK_SECRET
    if (!secret) {
        res.status(500).json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set PYAS_WEBHOOK_SECRET to your endpoint\'s signing secret.' } })
        return
    }
    let event
    try {
        event = await constructWebhookEvent(req.body as Buffer, req.get('pyas-signature'), secret)
    } catch {
        res.status(400).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } })
        return
    }
    // Respond quickly, and do slow work in the background. A delivery can arrive more than
    // once: event.id is the same on every retry, so use it to skip duplicates.
    console.log(`Pyas webhook: ${event.type} (${event.id})`)
    res.json({ received: true })
})
