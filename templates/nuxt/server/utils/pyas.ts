import { Pyas } from '@pyas/sdk'

let client: Pyas | undefined

/**
 * The Pyas client, created once. It reads PYAS_API_KEY from
 * the environment. It is in server/utils, so only server code can use it: the API key must never
 * reach the browser.
 */
export const pyas = () => (client ??= new Pyas({ appInfo: 'pyas-starter-nuxt' }))
