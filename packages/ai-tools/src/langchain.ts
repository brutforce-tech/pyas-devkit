/**
 * Pyas's tools for LangChain and LangGraph:
 *
 *   import { pyasToolkit } from '@pyas/ai-tools/langchain'
 *   const agent = createReactAgent({ llm, tools: pyasToolkit({ subjectId: 'user_42' }), checkpointer })
 *
 * Each tool returns JSON text: its data, or `{ error: { code, message, hint, docs, traceId } }`
 * when the API refused, so the model can correct itself.
 *
 * A tool that changes something pauses the graph with LangGraph's `interrupt()`, carrying
 * `{ type: 'pyas_approval', tool, title, input, event }` for your app to show the person (`event`
 * is the event the change is about, as it is now in Pyas). Resume with
 * `new Command({ resume: { approved: true } })` to run it; any other answer declines it. The graph
 * needs a checkpointer to pause. Outside a graph, such a tool fails rather than run unapproved.
 */
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { createPyasTools, DECLINED, forModel, type PyasToolsOptions } from './core'
import type { PyasChangeDetails } from './tools'

export type { PyasToolsOptions, PyasToolScope } from './core'

/** What a paused graph carries for a change waiting for the person. */
export interface PyasApprovalRequest {
    type: 'pyas_approval'
    /** The tool's name, such as `create_event`. */
    tool: string
    /** What the tool does, such as "Create an event", to show the person. */
    title: string
    /** What the model asked for, to show the person. */
    input: Record<string, unknown>
    /** The event the change updates, deletes or answers, as it is now in Pyas. None for a new event. */
    event?: PyasChangeDetails['event']
}

/** The answer to resume with: `{ approved: true }` runs the change. */
export interface PyasApprovalAnswer { approved: boolean }

export const pyasToolkit = (options: PyasToolsOptions): StructuredToolInterface[] =>
    createPyasTools(options).map((t) => tool(
        async (input: Record<string, unknown>) => {
            if (t.needsApproval) {
                // A change that could never run is refused before anyone is asked.
                const described = await t.describe(input)
                if (!described.ok) return JSON.stringify(forModel(described))
                const { event } = described.details
                // On resume, LangGraph runs the tool again and interrupt() returns the person's answer.
                const answer = interrupt<PyasApprovalRequest, PyasApprovalAnswer | undefined>({ type: 'pyas_approval', tool: t.name, title: described.title, input, ...(event ? { event } : {}) })
                if (answer?.approved !== true) return JSON.stringify(forModel({ ok: false, error: DECLINED }))
            }
            return JSON.stringify(forModel(await t.execute(input, { approved: t.needsApproval })))
        },
        { name: t.name, description: t.description, schema: t.inputSchema },
    ) as unknown as StructuredToolInterface)
