/**
 * The tools, ready for a framework: chosen by scope, bound to one person when asked, each with
 * its input as a zod schema and as JSON Schema, and an `execute` that validates the input, runs
 * it with @pyas/sdk and returns either the data or the API's error (code, hint, docs, trace id),
 * so the model can act on a failure instead of stopping.
 *
 *   const tools = createPyasTools({ apiKey, subjectId: 'user_42', scope: ['events:read'] })
 */
import { Pyas, PyasError } from '@pyas/sdk'

/** Names the AI tools in each request's User-Agent, so Pyas can count requests that come from AI agents. */
const APP_INFO = 'pyas-ai-tools/1.0.1'
import { z } from 'zod/v4'
import { PYAS_TOOLS, RESOURCES, type PyasChangeAccount, type PyasChangeDetails, type PyasToolDefinition, type ToolContext, type ToolHints, type ToolResource } from './tools'

/**
 * Which tools to offer. `read` and `write` alone apply to every calendar resource; a resource
 * (`events`) offers all of its tools, `events:read` its reads only. The developer tools (error
 * codes, request logs, the API reference) are offered only when `developer` is named.
 */
export type PyasToolScope = 'read' | 'write' | ToolResource | `${ToolResource}:read` | `${ToolResource}:write`

interface PyasToolsBaseOptions {
    /** A Pyas client. Default: one made from apiKey and baseUrl when a tool first runs. */
    pyas?: Pyas
    /** A `pyas_sk_...` key. Default: PYAS_API_KEY. A test key reaches the sandbox only. */
    apiKey?: string
    /** Default: PYAS_API_URL, else https://api.pyas.io. */
    baseUrl?: string
    /** Default: every calendar resource, read and write. */
    scope?: PyasToolScope[]
    /** Only the tools that change nothing (with any scope). */
    readOnly?: boolean
    /**
     * Whether a tool that changes something (creates, updates or deletes an event, answers an
     * invitation) waits for the person to approve it. Default: true. Each framework's adapter asks
     * in that framework's own way. Set false only when your app already asks before a change runs.
     */
    requireApproval?: boolean
}

/**
 * Whose calendars the tools reach, chosen on purpose: there is no default, because a missing
 * `subjectId` in an app's chat would hand one user's assistant every user's calendars.
 */
export type PyasToolsOptions = PyasToolsBaseOptions & (
    | {
        /**
         * Your app's id for the person the agent acts for, from your own session on the server.
         * The tools then reach that person's accounts only: a request for any other account is
         * refused, and the tools that reach the whole app are not offered.
         */
        subjectId: string
        allAccounts?: never
        /**
         * A hint: this person's default calendar, an `accountId` of theirs, if your app lets them
         * choose one. Pyas doesn't keep it: pass it from your own records on each request. The
         * model is told to use it without asking, and create_event uses it when the model names
         * none. Without it, the model asks which calendar when the person has more than one. Empty
         * or null means none. It is checked like any account: one that isn't the
         * person's is refused.
         */
        defaultAccountId?: string | null
    }
    | {
        /**
         * Every account in the app, for an agent that works for you rather than for one of your
         * users (an internal assistant, an operations script). Never for a chat your users open.
         */
        allAccounts: true
        subjectId?: never
        defaultAccountId?: never
    }
)

/** Refuses options that don't say whose calendars the tools reach, before any tool exists. */
const whoseCalendars = (options: { subjectId?: unknown; allAccounts?: unknown }): string | null => {
    const { subjectId, allAccounts } = options
    const forPerson = typeof subjectId === 'string' && subjectId.trim() !== ''
    if (forPerson && allAccounts) throw new TypeError('Pass subjectId or allAccounts: true, not both.')
    if (forPerson) return (subjectId as string).trim()
    if (allAccounts === true) return null
    if (subjectId !== undefined) {
        throw new TypeError(`subjectId must be your app's id for the signed-in person, a non-empty string (got ${subjectId === '' ? 'an empty string' : String(subjectId)}). Check that your session has a user before building the tools.`)
    }
    throw new TypeError('Say whose calendars the tools reach: subjectId, your app\'s id for the person the agent acts for (for a chat your users open), or allAccounts: true (for an agent that works for you, which reaches every account in the app).')
}

/** A failure, as a model can act on it. */
export interface PyasToolError {
    code: string
    message: string
    hint?: string
    docs?: string
    traceId?: string
}

export type PyasToolResult = { ok: true; data: unknown } | { ok: false; error: PyasToolError }

/** How a tool's call runs. */
export interface PyasExecuteOptions {
    /** The person approved this call. A tool that needs approval refuses to run without it. */
    approved?: boolean
}

export interface PyasTool {
    name: string
    title: string
    description: string
    /** The input, as a zod (v4) object. */
    inputSchema: z.ZodObject
    /** The input, as JSON Schema (for OpenAI and Anthropic). */
    parameters: Record<string, unknown>
    annotations: ToolHints
    resource: ToolResource
    /** This tool changes something, so it runs only with `approved` (see requireApproval). */
    needsApproval: boolean
    execute(input: unknown, options?: PyasExecuteOptions): Promise<PyasToolResult>
    /**
     * For a tool that needs approval: what the change is about, from Pyas's own data, to show the
     * person. Fails, with the same error the change would get, when the change could never run.
     */
    describe(input: unknown): Promise<{ ok: true; title: string; details: PyasChangeDetails } | { ok: false; error: PyasToolError }>
}

const DEFAULT_RESOURCES: ToolResource[] = ['accounts', 'calendars', 'events', 'availability']

const env = (name: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[name] : undefined)

/** Whether a tool is in scope. Throws on a scope it does not know, so a typo never widens access. */
export const inScope = (tool: Pick<PyasToolDefinition, 'resource' | 'annotations'>, scope?: PyasToolScope[]): boolean => {
    const access = tool.annotations.readOnlyHint ? 'read' : 'write'
    if (!scope) return DEFAULT_RESOURCES.includes(tool.resource)
    return scope.some((entry) => {
        const [resource, part] = String(entry).split(':') as [string, string | undefined]
        if (resource === 'read' || resource === 'write') {
            if (part !== undefined) throw new TypeError(`Unknown scope: ${entry}`)
            return access === resource && DEFAULT_RESOURCES.includes(tool.resource)
        }
        if (!RESOURCES.includes(resource as ToolResource) || (part !== undefined && part !== 'read' && part !== 'write')) throw new TypeError(`Unknown scope: ${entry}`)
        return resource === tool.resource && (part === undefined || part === access)
    })
}

/** A call that needs approval and didn't get it: nothing was sent. */
export const APPROVAL_REQUIRED: PyasToolError = {
    code: 'TOOL_APPROVAL_REQUIRED',
    message: "This change needs the user's approval first. Nothing was changed.",
    hint: "Run it with the person's approval. Each framework's adapter asks for it.",
}

/** A call the person declined: nothing was sent. */
export const DECLINED: PyasToolError = {
    code: 'TOOL_DECLINED',
    message: "The user declined this change, so nothing was changed. Tell them you left it as it was, and don't try it again unless they ask.",
}

/** Any failure, as code, message, hint, docs link and trace id. */
export const toolError = (error: unknown): PyasToolError => {
    if (error instanceof PyasError) {
        return {
            code: error.code,
            message: error.message,
            ...(error.hint ? { hint: error.hint } : {}),
            ...(error.docs ? { docs: error.docs } : {}),
            ...(error.traceId ? { traceId: error.traceId } : {}),
        }
    }
    if (error instanceof TypeError) return { code: 'TOOL_INVALID_INPUT', message: `Invalid input: ${error.message}` }
    return { code: 'TOOL_FAILED', message: `Unexpected error: ${(error as Error)?.message ?? String(error)}` }
}

/** The input as JSON Schema, without the meta keys model providers do not take. */
export const toJsonSchema = (schema: z.ZodObject): Record<string, unknown> => {
    const { $schema, ...rest } = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>
    return rest
}

/** The tools for these options, each ready to run. */
export const createPyasTools = (options: PyasToolsOptions): PyasTool[] => {
    const subjectId = whoseCalendars(options ?? {}) ?? undefined
    const { scope, readOnly = false, requireApproval = true } = options
    const defaultInput = (options as { defaultAccountId?: unknown }).defaultAccountId
    if (typeof defaultInput === 'string' && defaultInput.trim() && !subjectId) throw new TypeError('defaultAccountId goes with subjectId: it is one person\'s default calendar.')
    // Empty or null: the person hasn't chosen one, so the model asks when they have several.
    const defaultAccountId = subjectId && typeof defaultInput === 'string' && defaultInput.trim() ? defaultInput.trim() : undefined
    if (scope) for (const entry of scope) inScope({ resource: 'events', annotations: { readOnlyHint: true } as ToolHints }, [entry])
    const key = options.pyas ? null : options.apiKey ?? env('PYAS_API_KEY') ?? null
    // The sandbox tool is offered only when the key is known to be a test key.
    const testMode = options.pyas ? options.pyas.testMode : !!key?.startsWith('pyas_sk_test_')

    let client: Pyas | null = options.pyas ?? null
    const pyas = () => (client ??= new Pyas({ apiKey: options.apiKey, baseUrl: options.baseUrl, appInfo: APP_INFO }))

    // Bound to a person: their accounts, read once and again when one is not found (just connected).
    let allowed: Set<string> | null = null
    const load = async () => {
        const ids = new Set<string>()
        for await (const a of pyas().accounts.list({ subjectId: subjectId! })) ids.add((a as { accountId: string }).accountId)
        allowed = ids
    }
    const checkAccounts = subjectId ? async (accountIds: string[]) => {
        if (!accountIds.length) return
        if (!allowed || accountIds.some((id) => !allowed!.has(id))) await load()
        const outside = accountIds.filter((id) => !allowed!.has(id))
        if (outside.length) {
            throw new PyasError({
                code: 'TOOL_ACCOUNT_NOT_ALLOWED',
                status: 403,
                message: `${outside.join(', ')} ${outside.length > 1 ? 'are not accounts' : 'is not an account'} of the person these tools act for.`,
                hint: 'Use list_accounts to find this person\'s accounts.',
            })
        }
    } : undefined

    const context = (): ToolContext => ({ pyas: pyas(), ...(subjectId ? { subjectId, checkAccounts } : {}) })

    /** An account as an approval shows it, or null when Pyas can't say (the change itself reports why). */
    const accountOf = async (accountId: string): Promise<PyasChangeAccount | null> => {
        try {
            const account = await pyas().accounts.get({ accountId }) as { accountId: string; provider: string; email?: string | null; name?: string | null; subjectId?: string | null }
            return { accountId: account.accountId, provider: account.provider, email: account.email ?? null, name: account.name ?? null, subjectId: account.subjectId ?? null }
        } catch {
            return null
        }
    }

    return PYAS_TOOLS
        .filter((t) => inScope(t, scope))
        .filter((t) => !readOnly || t.annotations.readOnlyHint)
        .filter((t) => !t.testOnly || testMode)
        .filter((t) => !subjectId || !t.appWide)
        .map((t) => {
            // Bound to a person, the subject is the tools' own, not the model's to choose.
            const personal = subjectId ? Object.fromEntries(Object.entries(t.input).filter(([k]) => k !== 'subjectId')) : t.input
            // With a default calendar, a new event goes there unless the model names another.
            const defaults = !!defaultAccountId && t.name === 'create_event'
            const shape = defaults
                ? { ...personal, accountId: (personal.accountId as z.ZodString).optional().describe(`A Pyas account ID. Leave it out to use the person's default calendar (${defaultAccountId}).`) }
                : personal
            const inputSchema = z.object(shape)
            const description = defaults
                ? `${t.description} This person's default calendar is accountId ${defaultAccountId}: use it unless they name another calendar, and don't ask which.`
                : t.name === 'list_accounts' && defaultAccountId
                    ? `${t.description} The person's default calendar is marked isDefault.`
                    : t.description
            /** The model's input with the default calendar filled in where it named none. */
            const withDefault = (data: Record<string, unknown>) => (defaults && data.accountId === undefined ? { ...data, accountId: defaultAccountId } : data)
            /** list_accounts' answer, with the default calendar marked. */
            const marked = (data: unknown) => {
                if (t.name !== 'list_accounts' || !defaultAccountId) return data
                const { accounts } = data as { accounts: Array<{ accountId: string }> }
                return { accounts: accounts.map((account) => (account.accountId === defaultAccountId ? { ...account, isDefault: true } : account)) }
            }
            // Every tool that changes something, so a tool added later is covered without a list to update.
            const needsApproval = requireApproval && !t.annotations.readOnlyHint
            return {
                name: t.name,
                title: t.title,
                description,
                inputSchema,
                parameters: toJsonSchema(inputSchema),
                annotations: t.annotations,
                resource: t.resource,
                needsApproval,
                async execute(input: unknown, { approved = false }: PyasExecuteOptions = {}): Promise<PyasToolResult> {
                    const parsed = inputSchema.safeParse(input ?? {})
                    if (!parsed.success) return { ok: false, error: { code: 'TOOL_INVALID_INPUT', message: `Invalid input: ${z.prettifyError(parsed.error)}` } }
                    // Checked here, under every adapter: a change the person didn't approve is never sent.
                    if (needsApproval && !approved) return { ok: false, error: APPROVAL_REQUIRED }
                    try {
                        return { ok: true, data: marked(await t.run(context(), withDefault(parsed.data))) }
                    } catch (error) {
                        return { ok: false, error: toolError(error) }
                    }
                },
                async describe(input: unknown) {
                    const parsed = inputSchema.safeParse(input ?? {})
                    if (!parsed.success) return { ok: false, error: { code: 'TOOL_INVALID_INPUT', message: `Invalid input: ${z.prettifyError(parsed.error)}` } }
                    try {
                        const data = withDefault(parsed.data)
                        const details = t.describe ? await t.describe(context(), data) : {}
                        // Where the change lands, read from Pyas after the tool's own check, so the
                        // person sees whose calendar it is (someone with several sees which one).
                        const { accountId, zoomAccountId, meeting } = data as { accountId?: unknown; zoomAccountId?: unknown; meeting?: unknown }
                        const calendar = typeof accountId === 'string' ? await accountOf(accountId) : null
                        const zoomAccount = meeting === 'zoom' && typeof zoomAccountId === 'string' ? await accountOf(zoomAccountId) : null
                        return {
                            ok: true,
                            title: t.changeTitle?.(parsed.data) ?? t.title,
                            details: { ...details, ...(calendar ? { calendar } : {}), ...(zoomAccount ? { zoomAccount } : {}) },
                        }
                    } catch (error) {
                        return { ok: false, error: toolError(error) }
                    }
                },
            }
        })
}

/** A result as the model reads it: the data, or `{ error }`. */
export const forModel = (result: PyasToolResult): unknown => (result.ok ? result.data : { error: result.error })

/** A change the model asked for, waiting for the person to approve or decline it. */
export interface PyasPendingChange<Call = unknown> {
    /** The call's id: pass it in `approved` or `declined`. */
    id: string
    /** The tool's name, such as `create_event`. */
    tool: string
    /** What the change does, such as "Create an event" or "Move an event", to show the person. */
    title: string
    /** What the model asked for, to show the person. */
    input: Record<string, unknown>
    /**
     * The event the change updates, deletes or answers, as it is now in Pyas. Show it: it is what
     * the change is really about, whatever the model says. None for a new event.
     */
    event?: PyasChangeDetails['event']
    /** The calendar the change is made on, from Pyas: show whose it is. */
    calendar?: PyasChangeAccount
    /** The Zoom account that makes the meeting, when the change adds one. */
    zoomAccount?: PyasChangeAccount
    /** The call as the model sent it. Run it again with the person's answer. */
    call: Call
}

/** The person's answers to pending changes, by call id. */
export interface PyasApprovals {
    /** Calls the person approved: they run. */
    approved?: string[]
    /** Calls the person declined: the model is told, and nothing is sent. */
    declined?: string[]
}

/** One model call to run: its input, or why it could not be read. */
export interface CallToRun<Call> { id: string; name: string; input: unknown; unreadable?: PyasToolError; call: Call }

/**
 * Runs a model's calls of these tools. A call that needs approval and has no answer yet is not
 * run: it comes back in `pending`, for the person to decide. Results keep the calls' order.
 */
export const runCalls = async <Call>(tools: PyasTool[], calls: CallToRun<Call>[], { approved = [], declined = [] }: PyasApprovals = {}) => {
    const outcomes = await Promise.all(calls.map(async (c) => {
        const tool = tools.find((t) => t.name === c.name)!
        if (c.unreadable) return { c, result: { ok: false, error: c.unreadable } as PyasToolResult }
        if (declined.includes(c.id)) return { c, result: { ok: false, error: DECLINED } as PyasToolResult }
        if (tool.needsApproval && !approved.includes(c.id)) {
            // Without an answer, a change is checked and described, but not sent. One that could
            // never run (bad input, someone else's account, no such event) is refused now.
            const described = await tool.describe(c.input)
            if (!described.ok) return { c, result: { ok: false, error: described.error } as PyasToolResult }
            const { event, calendar, zoomAccount } = described.details
            const pending: PyasPendingChange<Call> = {
                id: c.id, tool: tool.name, title: described.title, input: (c.input ?? {}) as Record<string, unknown>,
                ...(event ? { event } : {}), ...(calendar ? { calendar } : {}), ...(zoomAccount ? { zoomAccount } : {}), call: c.call,
            }
            return { c, pending }
        }
        return { c, result: await tool.execute(c.input, { approved: approved.includes(c.id) }) }
    }))
    return {
        results: outcomes.flatMap((o) => (o.result ? [{ id: o.c.id, call: o.c.call, result: o.result }] : [])),
        pending: outcomes.flatMap((o) => (o.pending ? [o.pending] : [])),
    }
}

/**
 * What a change is about, from Pyas's own data, for an approval screen that gets only the tool's
 * name and input (the Vercel AI SDK's tool parts). Run it on your server, with the same options as
 * the tools, so it checks the account the same way. A change that could never run fails here too.
 */
export const describePyasChange = async (change: { tool: string; input: unknown }, options: PyasToolsOptions): Promise<
    | { ok: true; title: string; event?: PyasChangeDetails['event']; calendar?: PyasChangeAccount; zoomAccount?: PyasChangeAccount }
    | { ok: false; error: PyasToolError }
> => {
    const tool = createPyasTools(options).find((t) => t.name === change.tool && t.needsApproval)
    if (!tool) return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `${change.tool} is not one of these tools that change something.` } }
    const described = await tool.describe(change.input)
    if (!described.ok) return described
    const { event, calendar, zoomAccount } = described.details
    return { ok: true, title: described.title, ...(event ? { event } : {}), ...(calendar ? { calendar } : {}), ...(zoomAccount ? { zoomAccount } : {}) }
}
