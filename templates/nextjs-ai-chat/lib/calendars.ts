import { pyas } from './pyas'

/** A calendar account the person connected, as the page shows it. */
export interface Calendar {
    accountId: string
    provider: string
    email: string | null
    name: string | null
    /** `inactive` when the person revoked access: they connect it again to use it. */
    status: string
}

/**
 * The person's calendars: every account saved under their ID. Zoom accounts are left out,
 * since they add meeting links to events rather than hold a calendar.
 */
export async function calendarsOf(subjectId: string): Promise<Calendar[]> {
    const page = await pyas().accounts.list({ subjectId, limit: 50 })
    return page.data
        .filter((account) => account.provider !== 'zoom')
        .map(({ accountId, provider, email, name, status }) => ({ accountId, provider, email, name, status }))
}
