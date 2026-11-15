/**
 * Before any end-to-end suite: the settings are there (target.ts) and the API answers, so a
 * missing setting fails once with what to set, not in every test.
 */
import { API_URL, keys } from './target'

export default async function setup() {
    if (!API_URL) throw new Error('Set PYAS_E2E_API_URL to the Pyas API the end-to-end suites run against (see packages/sdk/e2e/target.ts).')
    keys()
    const answered = await fetch(`${API_URL}/v2/openapi.json`).then((res) => res.ok, () => false)
    if (!answered) throw new Error(`No Pyas API answers at ${API_URL} (PYAS_E2E_API_URL).`)
}
