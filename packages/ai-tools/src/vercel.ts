/**
 * Pyas's tools for the Vercel AI SDK (6 or later):
 *
 *   import { pyasTools } from '@pyas/ai-tools/vercel'
 *   const result = await generateText({ model, tools: pyasTools({ subjectId: 'user_42' }), prompt })
 *
 * Each tool returns its data, or `{ error: { code, message, hint, docs, traceId } }` when the API
 * refused, so the model can correct itself.
 *
 * A tool that changes something has `needsApproval`: the AI SDK stops at its call with a
 * `tool-approval-request`, and runs it only after your app sends the person's approval back
 * (`addToolApprovalResponse` with useChat). A declined call is never run. The tool part has only
 * the model's input: for the event as it really is, call `describePyasChange` on your server.
 */
import type { Tool } from 'ai'
import { createPyasTools, forModel, type PyasToolsOptions } from './core'

export { describePyasChange } from './core'

export type { PyasToolsOptions, PyasToolScope } from './core'

export const pyasTools = (options: PyasToolsOptions): Record<string, Tool> =>
    Object.fromEntries(createPyasTools(options).map((t) => [t.name, {
        description: t.description,
        inputSchema: t.inputSchema,
        needsApproval: t.needsApproval,
        // With needsApproval, the AI SDK calls execute only once the person has approved the call.
        execute: async (input: unknown) => forModel(await t.execute(input, { approved: t.needsApproval })),
    } satisfies Tool]))
