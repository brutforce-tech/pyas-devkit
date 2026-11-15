import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfig, writeConfig } from '../src/config'
import { accessToken, finishDeviceLogin, LoginError, revokeSession, showCode, startDeviceLogin, type SessionDeps } from '../src/session'

/** pyas login against a fake API: the device code, polling, refresh and sign-out. */

const API = 'http://api.test'

type Answer = { status: number; json: Record<string, unknown> }

const fakeApi = (answers: Record<string, Answer[]>) => {
    const calls: Array<{ path: string; body: Record<string, string> }> = []
    let clock = 1_000_000
    const sleeps: number[] = []
    const deps: SessionDeps = {
        now: () => clock,
        sleep: async (ms) => { sleeps.push(ms); clock += ms },
        fetch: vi.fn(async (url: string, init: any) => {
            const path = new URL(url).pathname
            const body = init.headers['content-type'] === 'application/json' ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))
            calls.push({ path, body })
            const queue = answers[path] ?? []
            const next = queue.length > 1 ? queue.shift()! : queue[0]
            if (!next) throw new Error(`no answer for ${path}`)
            return new Response(JSON.stringify(next.json), { status: next.status, headers: { 'content-type': 'application/json' } })
        }) as unknown as typeof fetch,
    }
    return { deps, calls, sleeps, tick: (ms: number) => { clock += ms } }
}

const registered: Answer = { status: 201, json: { client_id: 'cli-client' } }
const code: Answer = { status: 200, json: { device_code: 'dev-1', user_code: 'ABCDEFGH', verification_uri: 'http://app.test/oauth/device', interval: 5, expires_in: 600 } }
const tokens = (n: number): Answer => ({ status: 200, json: { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 } })

beforeEach(() => {
    process.env.PYAS_CONFIG = join(mkdtempSync(join(tmpdir(), 'pyas-cli-')), 'config.json')
})

describe('pyas login', () => {
    it('registers once per API, then asks for a code for the person to type', async () => {
        const api = fakeApi({ '/api/auth/oauth2/register': [registered], '/api/auth/device/code': [code] })
        const login = await startDeviceLogin(API, api.deps)
        expect(login).toMatchObject({ clientId: 'cli-client', userCode: 'ABCDEFGH', verificationUri: 'http://app.test/oauth/device', interval: 5 })
        expect(api.calls[0].body).toMatchObject({ client_name: 'Pyas CLI', token_endpoint_auth_method: 'none' })
        expect(api.calls[1].body).toEqual({ client_id: 'cli-client', scope: 'openid offline_access manage keys:test', resource: `${API}/v2/manage` })
        expect(showCode(login.userCode)).toBe('ABCD-EFGH')

        await startDeviceLogin(API, api.deps)
        expect(api.calls.filter((c) => c.path === '/api/auth/oauth2/register')).toHaveLength(1)
        expect(readConfig().clients).toEqual({ [API]: 'cli-client' })
    })

    it('polls at the interval, slows down when told, and keeps the sign-in once approved', async () => {
        const api = fakeApi({
            '/api/auth/oauth2/register': [registered],
            '/api/auth/device/code': [code],
            '/api/auth/oauth2/token': [
                { status: 400, json: { error: 'authorization_pending' } },
                { status: 400, json: { error: 'slow_down' } },
                tokens(1),
            ],
        })
        const session = await finishDeviceLogin(await startDeviceLogin(API, api.deps), api.deps)
        expect(api.sleeps).toEqual([5000, 5000, 10_000])
        expect(session).toMatchObject({ apiUrl: API, clientId: 'cli-client', accessToken: 'access-1', refreshToken: 'refresh-1' })
        expect(readConfig().session?.accessToken).toBe('access-1')
    })

    it('says so when the sign-in is denied or the code expires', async () => {
        const denied = fakeApi({ '/api/auth/oauth2/register': [registered], '/api/auth/device/code': [code], '/api/auth/oauth2/token': [{ status: 400, json: { error: 'access_denied' } }] })
        await expect(finishDeviceLogin(await startDeviceLogin(API, denied.deps), denied.deps)).rejects.toMatchObject({ reason: 'denied' })

        const pending = fakeApi({ '/api/auth/device/code': [code], '/api/auth/oauth2/token': [{ status: 400, json: { error: 'authorization_pending' } }] })
        const login = await startDeviceLogin(API, pending.deps)
        const finishing = finishDeviceLogin(login, pending.deps)
        await expect(finishing).rejects.toBeInstanceOf(LoginError)
        await expect(finishing).rejects.toMatchObject({ reason: 'expired' })
        expect(readConfig().session).toBeUndefined()
    })

    it('says to wait when registering is rate limited', async () => {
        const api = fakeApi({ '/api/auth/oauth2/register': [{ status: 429, json: { message: 'Too many requests.' } }] })
        await expect(startDeviceLogin(API, api.deps)).rejects.toThrow('Wait a minute and run pyas login again.')
    })
})

describe('the access token', () => {
    it('is the saved one while it is fresh, and refreshed (with the new refresh token kept) near its end', async () => {
        const api = fakeApi({ '/api/auth/oauth2/token': [tokens(2)] })
        writeConfig({ session: { apiUrl: API, clientId: 'cli-client', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: api.deps.now() + 3_600_000 } })
        expect(await accessToken(api.deps)).toBe('access-1')
        expect(api.calls).toHaveLength(0)

        api.tick(3_600_000 - 30_000)
        expect(await accessToken(api.deps)).toBe('access-2')
        expect(api.calls[0].body).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'cli-client', resource: `${API}/v2/manage` })
        expect(readConfig().session?.refreshToken).toBe('refresh-2')
    })

    it('when the sign-in was ended in the dashboard, forgets it and says to sign in again', async () => {
        const api = fakeApi({ '/api/auth/oauth2/token': [{ status: 400, json: { error: 'invalid_grant' } }] })
        writeConfig({ apiKey: 'pyas_sk_test_keep', session: { apiUrl: API, clientId: 'cli-client', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 0 } })
        await expect(accessToken(api.deps)).rejects.toThrow('Run pyas login again.')
        expect(readConfig()).toEqual({ apiKey: 'pyas_sk_test_keep' })
        await expect(accessToken(api.deps)).rejects.toThrow('Not signed in. Run pyas login.')
    })

    it('signing out ends the refresh token on the API', async () => {
        const api = fakeApi({ '/api/auth/oauth2/revoke': [{ status: 200, json: {} }] })
        await revokeSession({ apiUrl: API, clientId: 'cli-client', accessToken: 'a', refreshToken: 'refresh-1', expiresAt: 0 }, api.deps)
        expect(api.calls[0]).toEqual({ path: '/api/auth/oauth2/revoke', body: { token: 'refresh-1', token_type_hint: 'refresh_token', client_id: 'cli-client' } })
    })
})
