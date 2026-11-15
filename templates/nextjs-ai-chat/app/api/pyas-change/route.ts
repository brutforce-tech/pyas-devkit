import { describePyasChange } from '@pyas/ai-tools/vercel'
import { currentUserId, defaultCalendarOf } from '@/lib/user'

/** What a change waiting for approval is about, from Pyas's own data, for the approval card. */
export async function POST(req: Request) {
    const userId = await currentUserId()
    if (!userId) return new Response('Sign in to use your calendar.', { status: 401 })
    const { tool, input } = await req.json()
    return Response.json(await describePyasChange({ tool, input }, { subjectId: userId, defaultAccountId: await defaultCalendarOf(userId) }))
}
