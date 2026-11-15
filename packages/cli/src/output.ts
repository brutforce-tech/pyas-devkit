/**
 * How the CLI answers: readable lines for a person, or with --json the data alone on stdout
 * (one JSON value per command; `logs tail` and `webhooks listen` write one per line), so a
 * coding agent can read it. Messages for people go to stderr either way.
 */
import { PyasError } from '@pyas/sdk'

export interface Out {
    json: boolean
    /** The command's result. */
    data(value: unknown, human: () => string): void
    /** One item of a stream (newline-delimited JSON). */
    line(value: unknown, human: () => string): void
    /** A note for the person, never on stdout. */
    note(text: string): void
}

export const createOut = (json: boolean): Out => ({
    json,
    data: (value, human) => { process.stdout.write(`${json ? JSON.stringify(value, null, 2) : human()}\n`) },
    line: (value, human) => { process.stdout.write(`${json ? JSON.stringify(value) : human()}\n`) },
    note: (text) => { process.stderr.write(`${text}\n`) },
})

/** Columns, padded to their widest cell. */
export const table = (rows: string[][], headers: string[]) => {
    if (!rows.length) return ''
    const all = [headers, ...rows]
    const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)))
    return all.map((r) => r.map((c, i) => (i === r.length - 1 ? c : (c ?? '').padEnd(widths[i]))).join('  ').trimEnd()).join('\n')
}

/** A time, in the zone given or the machine's. */
export const when = (iso: string | null | undefined, timeZone?: string) =>
    iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }) : ''

export class UsageError extends Error {}

/** Exit codes: 0 done, 1 the API said no (or could not be reached), 2 the command was wrong. */
export const report = (error: unknown, out: Out): number => {
    if (error instanceof UsageError) {
        if (out.json) process.stdout.write(`${JSON.stringify({ error: { code: 'USAGE', message: error.message } })}\n`)
        else process.stderr.write(`${error.message}\nRun pyas help to see the commands.\n`)
        return 2
    }
    if (error instanceof PyasError) {
        if (out.json) {
            process.stdout.write(`${JSON.stringify({ error: { code: error.code, status: error.status, message: error.message, hint: error.hint, docs: error.docs, traceId: error.traceId } }, null, 2)}\n`)
        } else {
            process.stderr.write([
                `${error.code}: ${error.message}`,
                error.hint ? `  ${error.hint}` : '',
                error.docs ? `  Docs: ${error.docs}` : '',
                error.traceId ? `  Trace id: ${error.traceId} (pyas logs get ${error.traceId})` : '',
            ].filter(Boolean).join('\n') + '\n')
        }
        return 1
    }
    process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`)
    return 1
}
