/**
 * Signing the CLI in as a person (`pyas login`), as `gh auth login` does: the CLI registers
 * itself once per API, asks for a code, and the person types the code on the dashboard and
 * approves. The token it gets is the person's, for their apps' setup (/v2/manage): it lasts an
 * hour and is refreshed with a refresh token kept in the config file, never in a project.
 */
import { readConfig, writeConfig, type Session } from './config'

export const DEFAULT_API_URL = 'https://api.pyas.io'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const SCOPE = 'openid offline_access manage keys:test'
/** Refreshed this long before it expires, so a request never carries a token about to end. */
const REFRESH_EARLY_MS = 60_000

export class LoginError extends Error {
    constructor(public reason: 'denied' | 'expired' | 'ended' | 'unreachable', message: string) {
        super(message)
    }
}

export interface DeviceLogin {
    apiUrl: string
    clientId: string
    deviceCode: string
    userCode: string
    verificationUri: string
    /** Seconds between polls. */
    interval: number
    /** When the code stops working, in ms since the epoch. */
    expiresAt: number
}

export interface SessionDeps {
    fetch: typeof fetch
    now: () => number
    sleep: (ms: number) => Promise<void>
}

const defaultDeps = (): SessionDeps => ({
    fetch: globalThis.fetch.bind(globalThis),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

const manageResource = (apiUrl: string) => `${apiUrl}/v2/manage`

const post = async (deps: SessionDeps, url: string, body: Record<string, unknown>, form = true) => {
    let res: Response
    try {
        res = await deps.fetch(url, {
            method: 'POST',
            headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', accept: 'application/json' },
            body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
        })
    } catch (error) {
        throw new LoginError('unreachable', `Could not reach ${new URL(url).origin}: ${(error as Error).message}`)
    }
    const json = (await res.json().catch((): null => null)) as Record<string, any> | null
    return { status: res.status, json: json ?? {} }
}

/** The CLI's client id on this API: registered once and kept, since registering is rate limited. */
const clientIdFor = async (apiUrl: string, deps: SessionDeps): Promise<string> => {
    const saved = readConfig()
    const known = saved.clients?.[apiUrl]
    if (known) return known
    const registered = await post(deps, `${apiUrl}/api/auth/oauth2/register`, {
        client_name: 'Pyas CLI', grant_types: [DEVICE_GRANT, 'refresh_token'], token_endpoint_auth_method: 'none', response_types: [],
    }, false)
    if (registered.status !== 201 || typeof registered.json.client_id !== 'string') {
        throw new LoginError('unreachable', registered.status === 429
            ? 'Too many sign-ins from this network in the last minute. Wait a minute and run pyas login again.'
            : `This API does not accept sign-ins from the CLI (${registered.status}). Check --api-url, or use pyas login --key.`)
    }
    writeConfig({ ...readConfig(), clients: { ...(readConfig().clients ?? {}), [apiUrl]: registered.json.client_id } })
    return registered.json.client_id
}

/** Asks the API for a code for the person to type. */
export const startDeviceLogin = async (apiUrl: string, deps: SessionDeps = defaultDeps()): Promise<DeviceLogin> => {
    const clientId = await clientIdFor(apiUrl, deps)
    const started = await post(deps, `${apiUrl}/api/auth/device/code`, { client_id: clientId, scope: SCOPE, resource: manageResource(apiUrl) })
    if (started.status !== 200) {
        throw new LoginError('unreachable', started.status === 429
            ? 'Too many sign-ins from this network in the last minute. Wait a minute and run pyas login again.'
            : `The sign-in could not start: ${started.json.error_description ?? started.status}.`)
    }
    return {
        apiUrl,
        clientId,
        deviceCode: started.json.device_code,
        userCode: started.json.user_code,
        verificationUri: started.json.verification_uri,
        interval: Number(started.json.interval) || 5,
        expiresAt: deps.now() + (Number(started.json.expires_in) || 600) * 1000,
    }
}

/** The code as the person types it: two groups of four. */
export const showCode = (userCode: string) => (/^[A-Z0-9]{8}$/i.test(userCode) ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : userCode)

/** Waits for the person to approve, at the interval the API asks for; saves the session. */
export const finishDeviceLogin = async (login: DeviceLogin, deps: SessionDeps = defaultDeps()): Promise<Session> => {
    let interval = login.interval
    for (;;) {
        if (deps.now() >= login.expiresAt) throw new LoginError('expired', 'The code expired before it was approved. Run pyas login again.')
        await deps.sleep(interval * 1000)
        const polled = await post(deps, `${login.apiUrl}/api/auth/oauth2/token`, { grant_type: DEVICE_GRANT, device_code: login.deviceCode, client_id: login.clientId })
        if (polled.status === 200) return saveSession(login.apiUrl, login.clientId, polled.json, deps)
        const error = polled.json.error
        if (error === 'authorization_pending') continue
        if (error === 'slow_down') { interval += 5; continue }
        if (error === 'access_denied') throw new LoginError('denied', 'The sign-in was denied in the browser. Run pyas login to try again.')
        if (error === 'expired_token') throw new LoginError('expired', 'The code expired before it was approved. Run pyas login again.')
        throw new LoginError('unreachable', `The sign-in could not finish: ${polled.json.error_description ?? error ?? polled.status}.`)
    }
}

const saveSession = (apiUrl: string, clientId: string, tokens: Record<string, any>, deps: SessionDeps): Session => {
    const session: Session = {
        apiUrl,
        clientId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: deps.now() + (Number(tokens.expires_in) || 3600) * 1000,
    }
    const { pendingLogin: _done, ...rest } = readConfig()
    writeConfig({ ...rest, session })
    return session
}

/**
 * An access token that is good now: the saved one, or a new one from the refresh token (which
 * the API replaces on each use, so the new one is saved too).
 */
export const accessToken = async (deps: SessionDeps = defaultDeps()): Promise<string> => {
    const session = readConfig().session
    if (!session) throw new LoginError('ended', 'Not signed in. Run pyas login.')
    if (session.expiresAt - REFRESH_EARLY_MS > deps.now()) return session.accessToken
    const refreshed = await post(deps, `${session.apiUrl}/api/auth/oauth2/token`, {
        grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: session.clientId, resource: manageResource(session.apiUrl),
    })
    if (refreshed.status !== 200) {
        const { session: _ended, ...rest } = readConfig()
        writeConfig(rest)
        throw new LoginError('ended', 'Your sign-in ended (it was signed out from the dashboard, or not used for a month). Run pyas login again.')
    }
    return saveSession(session.apiUrl, session.clientId, refreshed.json, deps).accessToken
}

/** Ends the sign-in on the API too, so the refresh token stops working; best effort. */
export const revokeSession = async (session: Session, deps: SessionDeps = defaultDeps()) => {
    await post(deps, `${session.apiUrl}/api/auth/oauth2/revoke`, { token: session.refreshToken, token_type_hint: 'refresh_token', client_id: session.clientId })
        .catch((): null => null)
}
