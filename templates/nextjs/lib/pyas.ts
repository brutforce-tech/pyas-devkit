import { Pyas } from '@pyas/sdk'

let client: Pyas | undefined

/**
 * The Pyas client, created once. It reads PYAS_API_KEY from
 * the environment. Import it from server code only (route handlers and server components): the
 * API key must never reach the browser.
 */
export const pyas = () => (client ??= new Pyas({ appInfo: 'pyas-starter-nextjs' }))
