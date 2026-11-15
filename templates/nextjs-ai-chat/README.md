# Pyas AI chat for Next.js

A calendar assistant in a Next.js app (App Router), built with the
[Vercel AI SDK](https://ai-sdk.dev), `@pyas/ai-tools` and PyasConnect. Each
person connects their Google or Outlook calendar, then asks about their week in
plain words. Before the assistant books, moves or deletes anything, it shows the
change and waits for them to approve it.

## Start

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

The app reads its settings from `.env.local` (see `.env.example`):

- `PYAS_API_KEY`: a test key (`pyas_sk_test_...`) from your app's API keys in
  the Pyas dashboard. If you created the app with
  `npx @pyas/cli init --template nextjs-ai-chat`, it's already there.
- `OPENAI_API_KEY`: the model's key. To use another provider, change the model
  in `app/api/chat/route.ts`.

A test key works only in your app's sandbox. The sandbox has sample people with
calendars and a week of events, and it doesn't affect any real calendar.

## Try it

With a test key, the signed-in person is Avery Brooks (`sandbox_user_1`), one of
the sandbox's sample people, so the chat opens on calendars that already have
events.

1. Ask "What's on my calendar tomorrow?". The assistant reads Avery's calendar
   without asking.
2. Ask "Book a 30 minute meeting tomorrow afternoon when I'm free." A card asks
   you to approve the new event. Select **Approve**, and the event is on the
   calendar.
3. Ask it to move that meeting to another time. The card shows the event's
   current time, read from Pyas, and the new one. Select **Decline**, and the
   meeting stays where it was.
4. Open the calendars menu in the header and select **Connect a calendar**.
   PyasConnect offers Google and Outlook. With a test key, the sign-in is the
   sandbox's, which connects a sample account instead of a real one. The new
   calendar is listed at once, and the assistant can use it.

5. With more than one calendar, ask for a new event without saying where: the
   assistant asks which calendar. In the calendars menu, select **Make default**
   on one, and it stops asking. On an approval card, **Use another calendar**
   moves the event to another of your calendars before you approve it.

To see what a new user sees, disconnect every calendar from the menu: the page
switches to **Connect your calendar**. `npx @pyas/cli sandbox reset` brings Avery's
calendars back.

Every request the assistant makes is on the **Logs** page in the Pyas
dashboard, marked **By @pyas/ai-tools**.

## What's here

| Path | What it does |
|---|---|
| `app/page.tsx` | Loads the signed-in person's calendars: the chat once they have one, the connect screen until then |
| `app/chat.tsx` | The chat, with `useChat`, each step the assistant takes, and an approval card for each change |
| `app/approval.tsx` | The approval card: the change, and the event as it is now in Pyas |
| `app/connect.tsx` | Connecting a calendar with PyasConnect, and the connect screen |
| `app/calendars.tsx` | The calendars menu: which calendars the assistant uses, connecting and disconnecting |
| `app/api/chat/route.ts` | The chat: the model, with Pyas's tools for the signed-in person only |
| `app/api/pyas-change/route.ts` | Reads the event a change is about, for the card |
| `app/api/pyas/connect-session/route.ts` | A connect session for PyasConnect, saving the account under the person's ID |
| `app/api/pyas/accounts/[accountId]/route.ts` | Disconnects one of the person's calendars |
| `lib/user.ts` | The signed-in person's ID, and their default calendar: replace both with your own authentication and records |
| `app/api/default-calendar/route.ts` | Sets or clears the person's default calendar, after checking it is theirs |
| `lib/calendars.ts` | The person's calendars, from Pyas |

## How it stays safe

- **One person's calendars.** Every calendar a person connects is saved under
  their ID (the `subjectId`). `pyasTools({ subjectId })` gives the model tools
  for that person only, and a request for anyone else's account is refused
  before it reaches Pyas.
- **Disconnecting checks the owner.** The disconnect route reads the account
  from Pyas and refuses it unless it belongs to the signed-in person.
- **Every change waits for approval.** Creating, updating and deleting events,
  and replying to invitations, stop at an approval card. A declined change is
  never sent to Pyas.
- **The card shows Pyas's data.** It says which calendar the change lands on,
  and for a change to an existing event, shows the event as it is in Pyas, not
  as the model describes it.
- **The key stays on the server.** `PYAS_API_KEY` and `OPENAI_API_KEY` are read
  by route handlers and server components only. The browser gets a one-time
  connect session token, never the key.

## Go live

1. Replace `lib/user.ts` with your own authentication.
2. Create a live key in the Pyas dashboard, and set it as `PYAS_API_KEY` on
   your server. The same code then connects people's real Google and Outlook
   calendars.

The guides are at https://developer.pyas.io/vercel-ai-sdk and
https://developer.pyas.io/connect.
