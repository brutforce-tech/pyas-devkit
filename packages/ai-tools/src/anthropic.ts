/**
 * Pyas's tools for Anthropic tool use:
 *
 *   import { pyasAnthropicTools, runPyasToolUses } from '@pyas/ai-tools/anthropic'
 *
 *   const options = { subjectId: 'user_42' }
 *   const message = await anthropic.messages.create({ model, max_tokens, tools: pyasAnthropicTools(options), messages })
 *   messages.push({ role: 'assistant', content: message.content })
 *   const { results, pending } = await runPyasToolUses(message.content, options)
 *
 * A tool_use that changes something runs only once the person approves it: until then it is in
 * `pending`, and nothing is sent to Pyas.
 *
 * A result is the data as JSON, or the API's error (code, message, hint, docs, trace id) marked
 * `is_error`, so the model can correct itself.
 */
import { createPyasTools, runCalls, type PyasApprovals, type PyasPendingChange, type PyasToolsOptions } from './core'

export type { PyasApprovals, PyasPendingChange, PyasToolsOptions, PyasToolScope } from './core'

export interface AnthropicTool {
    name: string
    description: string
    input_schema: { type: 'object'; [key: string]: unknown }
}

export const pyasAnthropicTools = (options: PyasToolsOptions): AnthropicTool[] =>
    createPyasTools(options).map((t) => ({ name: t.name, description: t.description, input_schema: { ...t.parameters, type: 'object' } }))

/** A content block of an assistant message; only `tool_use` blocks are run. */
export interface ContentBlock { type: string; id?: string; name?: string; input?: unknown }

export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: true }

/** A tool_use waiting for the person (from runPyasToolUses). */
export type PyasPendingToolUse = PyasPendingChange<ContentBlock>

/**
 * Runs the message's tool_use blocks for Pyas's tools. `results` are the tool_result blocks to
 * send back. `pending` are the changes waiting for the person: show them, then call this again
 * with `pending.map((change) => change.call)` and the person's answers in `approved` and
 * `declined`. Send every tool_result of the turn in one user message, once nothing is pending.
 */
export const runPyasToolUses = async (content: ContentBlock[], options: PyasToolsOptions & PyasApprovals) => {
    const tools = createPyasTools(options)
    const uses = content.filter((b) => b.type === 'tool_use' && tools.some((t) => t.name === b.name))
    const { results, pending } = await runCalls(tools, uses.map((b) => ({ id: b.id!, name: b.name!, input: b.input, call: b })), options)
    return {
        results: results.map((r): ToolResultBlock => r.result.ok
            ? { type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result.data) }
            : { type: 'tool_result', tool_use_id: r.id, content: JSON.stringify({ error: r.result.error }), is_error: true }),
        pending,
    }
}
