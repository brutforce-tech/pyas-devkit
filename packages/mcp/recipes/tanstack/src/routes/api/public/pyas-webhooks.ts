import { createFileRoute } from '@tanstack/react-router'

/**
 * Webhook deliveries from Pyas, at https://<your-app>.lovable.app/api/public/pyas-webhooks. Pyas
 * signs each one, so this route checks the signature against the raw body, before parsing it,
 * with PYAS_WEBHOOK_SECRET: JSON that was parsed and turned back into text no longer matches.
 */
export const Route = createFileRoute('/api/public/pyas-webhooks')({
    server: {
        handlers: {
            POST: async ({ request }: { request: Request }) => {
                const secret = process.env.PYAS_WEBHOOK_SECRET
                if (!secret) return Response.json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set the PYAS_WEBHOOK_SECRET secret to the endpoint\'s signing secret.' } }, { status: 500 })
                // Loaded here, on the server: route files are also part of the browser's code.
                const { constructWebhookEvent } = await import('@pyas/sdk')
                let event
                try {
                    event = await constructWebhookEvent(await request.text(), request.headers.get('pyas-signature'), secret)
                } catch {
                    return Response.json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } }, { status: 400 })
                }
                // Respond quickly and do slow work afterwards. A delivery can arrive more than once:
                // event.id is the same on every retry, so use it to skip ones you have already handled.
                console.log(`Pyas webhook: ${event.type} (${event.id})`)
                return Response.json({ received: true })
            },
        },
    },
})
