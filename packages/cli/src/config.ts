/**
 * Where the CLI keeps its key and its sign-in: the user's config folder, never the project
 * (`~/.config/pyas/config.json`, `%APPDATA%\pyas\config.json` on Windows), readable by the
 * user alone. PYAS_API_KEY and PYAS_API_URL, when set, win over it, so CI needs no file.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** A person's sign-in (`pyas login`), for their apps' setup. */
export interface Session {
    apiUrl: string
    clientId: string
    accessToken: string
    refreshToken: string
    /** When the access token expires, in ms since the epoch. */
    expiresAt: number
}

export interface Config {
    apiKey?: string
    apiUrl?: string
    session?: Session
    /** A sign-in started with pyas login --no-wait, finished by pyas login --wait. */
    pendingLogin?: {
        apiUrl: string
        clientId: string
        deviceCode: string
        userCode: string
        verificationUri: string
        interval: number
        expiresAt: number
    }
    /** The CLI's client id on each API it has signed in to: it registers once. */
    clients?: Record<string, string>
}

export const configPath = () => {
    if (process.env.PYAS_CONFIG) return process.env.PYAS_CONFIG
    if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'pyas', 'config.json')
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pyas', 'config.json')
}

export const readConfig = (): Config => {
    const path = configPath()
    if (!existsSync(path)) return {}
    try { return JSON.parse(readFileSync(path, 'utf8')) as Config } catch { return {} }
}

export const writeConfig = (config: Config) => {
    const path = configPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    // Already there: tighten it anyway (Windows ignores modes; the profile folder is the user's).
    try { chmodSync(path, 0o600) } catch { /* not supported */ }
}

export const clearConfig = () => rmSync(configPath(), { force: true })

/** The key and API to use: the environment first, then the saved config. */
export const resolveAuth = () => {
    const saved = readConfig()
    return {
        apiKey: process.env.PYAS_API_KEY || saved.apiKey,
        apiUrl: process.env.PYAS_API_URL || saved.apiUrl,
        from: process.env.PYAS_API_KEY ? 'PYAS_API_KEY' : saved.apiKey ? configPath() : null,
    }
}

/** A key, shown without its secret part. */
export const masked = (key: string) => `${key.slice(0, key.startsWith('pyas_sk_test_') ? 13 : 8)}...${key.slice(-4)}`
