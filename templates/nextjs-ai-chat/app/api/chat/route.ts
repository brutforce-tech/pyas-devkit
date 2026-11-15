import { openai } from '@ai-sdk/openai'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { pyasTools } from '@pyas/ai-tools/vercel'
import { currentUserId, defaultCalendarOf } from '@/lib/user'

export async function POST(req: Request) {
    const userId = await currentUserId()
    if (!userId) return new Response('Sign in to use your calendar.', { status: 401 })

    const { messages }: { messages: UIMessage[] } = await req.json()
    // Today's date lets the model work out "tomorrow".
    const today = new Date().toISOString().slice(0, 10)
    const result = streamText({
        model: openai('gpt-5.5'),
        system: [
            `You help the user manage their calendar. Today is ${today}.`,
            "Answer briefly. List events as short bullet points, each as the time, a colon and the title (9:00 to 9:30 AM: Standup), in the calendar's time zone.",
            'Before you book, move or delete anything, check the calendar so the change is right the first time.',
        ].join(' '),
        messages: await convertToModelMessages(messages),
        // The person's default calendar, from your app, as a hint: without one, the assistant asks
        // which calendar when they have several.
        tools: pyasTools({ subjectId: userId, defaultAccountId: await defaultCalendarOf(userId) }),
        stopWhen: stepCountIs(10),
        // With OpenAI: each request carries the model's reasoning, so a chat that goes on after
        // an approval never points at reasoning OpenAI no longer has.
        providerOptions: { openai: { store: false, include: ['reasoning.encrypted_content'] } },
    })
    return result.toUIMessageStreamResponse()
}
