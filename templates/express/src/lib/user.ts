import type { Request } from 'express'

/**
 * The signed-in person's ID in your app. Pyas identifies each person by this ID (the
 * `subjectId`), so their calendars stay together across Google, Outlook and Zoom.
 *
 * Replace this with your own authentication. In the sandbox, `sandbox_user_1` is Avery Brooks,
 * one of the sample people.
 */
export const currentUserId = (_req: Request): string => 'sandbox_user_1'
