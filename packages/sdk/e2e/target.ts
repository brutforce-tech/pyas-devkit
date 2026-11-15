/**
 * The Pyas API every end-to-end suite in this repo runs against, and its keys, from the
 * environment:
 *
 *   PYAS_E2E_API_URL    the API, for example http://localhost:3030
 *   PYAS_E2E_TEST_KEY   a test key (pyas_sk_test_...): the suites work in its app's sandbox
 *   PYAS_E2E_LIVE_KEY   a live key of the same app, for what only a live key may do
 *                       (connect sessions, refusals a test key gets)
 *
 * The sandbox's sample people and calendars are what the suites read and change, so use an app
 * made for testing: the suites reset its sandbox.
 */

const required = (name: string): string => {
    const value = process.env[name]
    if (!value) throw new Error(`Set ${name}. The end-to-end suites need PYAS_E2E_API_URL, PYAS_E2E_TEST_KEY and PYAS_E2E_LIVE_KEY (see packages/sdk/e2e/target.ts).`)
    return value
}

export const API_URL = (process.env.PYAS_E2E_API_URL ?? '').replace(/\/+$/, '')

/** The app's keys: `testKey` for the sandbox, `apiKey` its live key. */
export const keys = (): { apiKey: string; testKey: string } => ({ testKey: required('PYAS_E2E_TEST_KEY'), apiKey: required('PYAS_E2E_LIVE_KEY') })
