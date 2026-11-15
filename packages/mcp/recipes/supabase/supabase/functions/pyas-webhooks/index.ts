import { constructWebhookEvent } from 'npm:@pyas/sdk@^1.0.0'

/**
 * Webhook deliveries from Pyas. Pyas signs each one, so this function checks the signature
 * against the raw body, before parsing it, with PYAS_WEBHOOK_SECRET (an Edge Function secret).
 * Pyas calls it without a Supabase sign-in, so its JWT check is off (supabase/config.toml).
 */
Deno.serve(async (req) => {
    const secret = Deno.env.get('PYAS_WEBHOOK_SECRET')
    if (!secret) return Response.json({ error: { code: 'NO_WEBHOOK_SECRET', message: 'Set the PYAS_WEBHOOK_SECRET secret to the endpoint\'s signing secret.' } }, { status: 500 })
    let event
    try {
        event = await constructWebhookEvent(await req.text(), req.headers.get('pyas-signature'), secret)
    } catch {
        return Response.json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The signature does not match this body and secret.' } }, { status: 400 })
    }
    // Answer quickly and do slow work afterwards. A delivery can arrive more than once:
    // event.id is the same on every retry, so use it to skip ones you have already handled.
    console.log(`Pyas webhook: ${event.type} (${event.id})`)
    return Response.json({ received: true })
})
