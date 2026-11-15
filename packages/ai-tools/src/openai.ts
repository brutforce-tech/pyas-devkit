/**
 * Pyas's tools for OpenAI function calling, as JSON Schema:
 *
 *   import { pyasFunctionDefinitions, runPyasToolCalls } from '@pyas/ai-tools/openai'
 *
 *   const options = { subjectId: 'user_42' }
 *   const response = await openai.chat.completions.create({ model, messages, tools: pyasFunctionDefinitions(options) })
 *   const message = response.choices[0].message
 *   const { results, pending } = await runPyasToolCalls(message.tool_calls, options)
 *
 * A call that changes something runs only once the person approves it: until then it is in
 * `pending`, and nothing is sent to Pyas.
 *
 * `api: 'responses'` gives the Responses API's shape, and `runPyasFunctionCalls` runs its
 * `function_call` items. A result is the data, or `{ error: { code, message, hint, docs, traceId } }`.
 */
import { createPyasTools, forModel, runCalls, type CallToRun, type PyasApprovals, type PyasPendingChange, type PyasToolResult, type PyasToolsOptions } from './core'

export type { PyasApprovals, PyasPendingChange, PyasToolsOptions, PyasToolScope } from './core'

export interface ChatFunctionTool {
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ResponsesFunctionTool {
    type: 'function'
    name: string
    description: string
    parameters: Record<string, unknown>
    strict: false
}

export function pyasFunctionDefinitions(options: PyasToolsOptions & { api?: 'chat' }): ChatFunctionTool[]
export function pyasFunctionDefinitions(options: PyasToolsOptions & { api: 'responses' }): ResponsesFunctionTool[]
export function pyasFunctionDefinitions(options: PyasToolsOptions & { api?: 'chat' | 'responses' }): Array<ChatFunctionTool | ResponsesFunctionTool> {
    return createPyasTools(options).map((t) => options.api === 'responses'
        ? { type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }
        : { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })
}

/** A tool call as Chat Completions returns it. */
export interface ChatToolCall { id: string; type?: string; function?: { name: string; arguments: string } }
/** A function call as the Responses API returns it. */
export interface ResponsesFunctionCall { type?: string; call_id: string; name: string; arguments: string }

/** A Chat Completions change waiting for the person (from runPyasToolCalls). */
export type PyasPendingToolCall = PyasPendingChange<ChatToolCall>
/** A Responses API change waiting for the person (from runPyasFunctionCalls). */
export type PyasPendingFunctionCall = PyasPendingChange<ResponsesFunctionCall>

/** Parses a call's arguments: a model can send text that isn't JSON. */
const toRun = <Call>(call: Call, id: string, name: string, args: string): CallToRun<Call> => {
    try {
        return { id, name, input: args ? JSON.parse(args) : {}, call }
    } catch {
        return { id, name, input: undefined, unreadable: { code: 'TOOL_INVALID_INPUT', message: 'The arguments are not valid JSON.' }, call }
    }
}

const output = (result: PyasToolResult) => JSON.stringify(forModel(result))

/**
 * Runs Chat Completions tool calls for Pyas's tools. `results` are the `tool` messages to send
 * back. `pending` are the changes waiting for the person: show them, then call this again with
 * `pending.map((change) => change.call)` and the person's answers in `approved` and `declined`.
 * Send the model every result of the turn together, once nothing is pending.
 */
export const runPyasToolCalls = async (calls: ChatToolCall[] | null | undefined, options: PyasToolsOptions & PyasApprovals) => {
    const tools = createPyasTools(options)
    const mine = (calls ?? []).filter((c) => c.function && tools.some((t) => t.name === c.function!.name))
    const { results, pending } = await runCalls(tools, mine.map((c) => toRun(c, c.id, c.function!.name, c.function!.arguments)), options)
    return { results: results.map((r) => ({ role: 'tool' as const, tool_call_id: r.id, content: output(r.result) })), pending }
}

/**
 * Runs Responses API function calls for Pyas's tools. `results` are the `function_call_output`
 * items to send back; `pending` works as with runPyasToolCalls.
 */
export const runPyasFunctionCalls = async (calls: ResponsesFunctionCall[] | null | undefined, options: PyasToolsOptions & PyasApprovals) => {
    const tools = createPyasTools(options)
    const mine = (calls ?? []).filter((c) => (c.type === undefined || c.type === 'function_call') && tools.some((t) => t.name === c.name))
    const { results, pending } = await runCalls(tools, mine.map((c) => toRun(c, c.call_id, c.name, c.arguments)), options)
    return { results: results.map((r) => ({ type: 'function_call_output' as const, call_id: r.id, output: output(r.result) })), pending }
}
