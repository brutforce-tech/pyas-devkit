import { cookies } from 'next/headers'
import { isSandbox } from './pyas'

/**
 * The signed-in person's ID in your app. Pyas identifies each person by this ID (the
 * `subjectId`): the calendars they connect are saved under it, and the assistant reaches only
 * those calendars.
 *
 * Replace this with your own authentication: read the ID from your session, on the server, and
 * return null when nobody is signed in. Never take it from the request body.
 *
 * Until then, with a test key, the person is Avery Brooks (`sandbox_user_1`), one of the
 * sandbox's sample people, who already has calendars. With a live key, it is `user_1`, who
 * starts by connecting their own.
 */
export async function currentUserId(): Promise<string | null> {
    return isSandbox() ? 'sandbox_user_1' : 'user_1'
}

export const DEFAULT_CALENDAR_COOKIE = 'default_calendar'

/**
 * The calendar the person chose as their default (an `accountId`), or null to have the assistant
 * ask which calendar when they have several. Pyas doesn't store it: your app does, and passes it
 * to the tools as a hint (`defaultAccountId`).
 *
 * This starter keeps it in a cookie so it works without a database. Keep it with the user in your
 * own database instead.
 */
export async function defaultCalendarOf(_userId: string): Promise<string | null> {
    return (await cookies()).get(DEFAULT_CALENDAR_COOKIE)?.value || null
}
