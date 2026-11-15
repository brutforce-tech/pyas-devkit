import { isPyasError, Pyas } from 'npm:@pyas/sdk@^1.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * The Pyas client. PYAS_API_KEY is an Edge Function secret: it stays on Supabase's servers and
 * never reaches the browser.
 */
export const pyas = new Pyas({ apiKey: Deno.env.get('PYAS_API_KEY'), baseUrl: Deno.env.get('PYAS_API_URL') || undefined, appInfo: 'pyas-recipe-supabase' })

/** For calls from the app's pages through supabase.functions.invoke. */
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/**
 * Whose calendars a request is about. Pyas keeps each person's calendars under your app's ID for
 * them (the subjectId). With a test key, that is the sandbox's sample person, so everything works
 * before anyone signs in. With a live key, it is the signed-in Supabase user, or null.
 */
export const subjectFor = async (req: Request): Promise<string | null> => {
    if (Deno.env.get('PYAS_API_KEY')?.startsWith('pyas_sk_test_')) return 'sandbox_user_1'
    const authorization = req.headers.get('Authorization')
    if (!authorization) return null
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authorization } },
    })
    const { data } = await supabase.auth.getUser()
    return data.user?.id ?? null
}

export const signInRequired = () => json({ error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in to use your calendar.' } }, 401)

/** A Pyas error with its code, hint and trace ID (quote the trace ID to Pyas support); anything else as a 500. */
export const errorResponse = (error: unknown) => {
    if (isPyasError(error)) {
        return json({ error: { code: error.code, message: error.message, hint: error.hint, traceId: error.traceId } }, error.status || 502)
    }
    return json({ error: { code: 'INTERNAL', message: (error as Error)?.message ?? 'Something went wrong.' } }, 500)
}
