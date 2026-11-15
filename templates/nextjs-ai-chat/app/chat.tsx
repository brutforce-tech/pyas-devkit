'use client'

import { useChat } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { Calendar } from '@/lib/calendars'
import { Approval } from './approval'
import { CalendarsMenu } from './calendars'

const SUGGESTIONS = [
    "What's on my calendar tomorrow?",
    'When am I free this week?',
    'Book a 30 minute focus block tomorrow afternoon',
    'Move my next meeting to later in the day',
]

/** What each Pyas tool is doing, then what it did, for the line under the assistant's answer. */
const ACTIVITY: Record<string, [string, string]> = {
    list_accounts: ['Checking your calendars', 'Checked your calendars'],
    list_calendars: ['Checking your calendars', 'Checked your calendars'],
    account_status: ['Checking your calendars', 'Checked your calendars'],
    accounts_needing_attention: ['Checking your calendars', 'Checked your calendars'],
    list_events: ['Reading your calendar', 'Read your calendar'],
    get_event: ['Reading the event', 'Read the event'],
    get_free_busy: ["Checking when you're free", "Checked when you're free"],
    find_meeting_times: ['Finding times', 'Found times'],
    create_event: ['Booking the event', 'Booked the event'],
    update_event: ['Changing the event', 'Changed the event'],
    delete_event: ['Deleting the event', 'Deleted the event'],
    respond_to_event: ['Replying to the invitation', 'Replied to the invitation'],
}

type Part = UIMessage['parts'][number]
type ToolPart = Part & { toolCallId: string; state: string; input?: unknown; errorText?: string; approval?: { id: string; approved?: boolean } }

const isToolPart = (part: Part): part is ToolPart => part.type.startsWith('tool-') || part.type === 'dynamic-tool'
const toolName = (part: ToolPart) => ('toolName' in part ? String(part.toolName) : part.type.slice(5))

/** A finished read that says the same as the step before it: shown once, so ten reads are one line. */
const repeatsStep = (parts: Part[], index: number) => {
    const part = parts[index] as ToolPart
    if (part.state !== 'output-available' || !ACTIVITY[toolName(part)]) return false
    // The last thing shown before it: text or another step (reasoning and step markers aren't shown).
    const previous = parts.slice(0, index).reverse().find((other) => other.type === 'text' || isToolPart(other))
    return !!previous && isToolPart(previous) && previous.state === 'output-available' && ACTIVITY[toolName(previous)]?.[1] === ACTIVITY[toolName(part)][1]
}

export function Chat({ calendars, defaultAccountId, sandbox, apiUrl }: { calendars: Calendar[]; defaultAccountId: string | null; sandbox: boolean; apiUrl?: string }) {
    const [input, setInput] = useState('')
    const { messages, setMessages, sendMessage, addToolApprovalResponse, status, stop, error, regenerate } = useChat({
        // Once the person has answered every change, the chat carries on by itself.
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    })
    const busy = status === 'submitted' || status === 'streaming'
    const thread = useRef<HTMLDivElement>(null)
    const atBottom = useRef(true)
    const textarea = useRef<HTMLTextAreaElement>(null)

    // Follows the answer as it streams, unless the person has scrolled up to read.
    useEffect(() => {
        if (atBottom.current) thread.current?.scrollTo({ top: thread.current.scrollHeight })
    }, [messages, status])

    function onScroll() {
        const el = thread.current
        if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }

    // A declined change never runs. The reason tells the model not to ask for it again, or, when the
    // person picked another calendar, to make the same change there instead.
    function answer(id: string, approved: boolean, reason?: string) {
        const why = approved ? undefined : reason ?? "The user declined this change. Leave it as it is, and don't ask again unless they do."
        addToolApprovalResponse({ id, approved, reason: why })
    }

    function send(text: string) {
        if (!text.trim() || busy) return
        atBottom.current = true
        sendMessage({ text: text.trim() })
        setInput('')
        if (textarea.current) textarea.current.style.height = ''
    }

    function onSubmit(event: React.FormEvent) {
        event.preventDefault()
        send(input)
    }

    // Enter sends; Shift+Enter starts a new line.
    function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send(input)
        }
    }

    // The box grows with the text, up to a limit.
    function onInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
        setInput(event.target.value)
        event.target.style.height = 'auto'
        event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`
    }

    function newChat() {
        stop()
        setMessages([])
        textarea.current?.focus()
    }

    const last = messages[messages.length - 1]
    const thinking = status === 'submitted' || (status === 'streaming' && last?.role === 'assistant' && last.parts.every((part) => part.type === 'step-start'))

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">Calendar assistant</div>
                <div className="topbar-actions">
                    {sandbox && <span className="badge" title="A test key reaches only the Pyas sandbox and its sample calendars.">Sandbox</span>}
                    {messages.length > 0 && (
                        <button className="button ghost" onClick={newChat}>
                            New chat
                        </button>
                    )}
                    <CalendarsMenu calendars={calendars} defaultAccountId={defaultAccountId} sandbox={sandbox} apiUrl={apiUrl} />
                </div>
            </header>

            <div className="thread" ref={thread} onScroll={onScroll}>
                <div className="thread-inner" aria-live="polite">
                    {messages.length === 0 && (
                        <div className="empty">
                            <h1>What do you need from your calendar?</h1>
                            <p className="muted">Ask about your week, or ask to book or move a meeting. Nothing changes until you approve it.</p>
                            <div className="suggestions">
                                {SUGGESTIONS.map((suggestion) => (
                                    <button key={suggestion} className="suggestion" onClick={() => send(suggestion)}>
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((message) => (
                        <div key={message.id} className={`message ${message.role}`}>
                            {message.parts.map((part, index) => {
                                if (part.type === 'text') {
                                    if (message.role === 'user') return <div key={index} className="bubble">{part.text}</div>
                                    return <div key={index} className="answer"><Markdown>{part.text}</Markdown></div>
                                }
                                if (isToolPart(part) && !repeatsStep(message.parts, index)) return <ToolStep key={part.toolCallId} part={part} calendars={calendars} onAnswer={answer} />
                                return null
                            })}
                        </div>
                    ))}

                    {thinking && (
                        <div className="message assistant">
                            <div className="thinking" aria-label="Thinking"><span /><span /><span /></div>
                        </div>
                    )}

                    {error && (
                        <div className="chat-error" role="alert">
                            <span>Something went wrong. {error.message}</span>
                            <button className="button small" onClick={() => regenerate()}>
                                Try again
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <form className="composer" onSubmit={onSubmit}>
                <div className="composer-box">
                    <textarea
                        ref={textarea}
                        value={input}
                        onChange={onInput}
                        onKeyDown={onKeyDown}
                        rows={1}
                        placeholder="Ask about your calendar"
                        aria-label="Message"
                        autoFocus
                    />
                    {busy ? (
                        <button type="button" className="icon-button" onClick={stop} aria-label="Stop">
                            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" /></svg>
                        </button>
                    ) : (
                        <button type="submit" className="icon-button" disabled={!input.trim()} aria-label="Send">
                            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                    )}
                </div>
                <p className="composer-hint">Enter to send, Shift+Enter for a new line</p>
            </form>
        </div>
    )
}

/** One Pyas tool call: a line saying what it is doing or did, or the approval card while it waits for the person. */
function ToolStep({ part, calendars, onAnswer }: { part: ToolPart; calendars: Calendar[]; onAnswer: (id: string, approved: boolean, reason?: string) => void }) {
    const name = toolName(part)
    const [doing, done] = ACTIVITY[name] ?? ['Working on it', 'Done']

    if (part.state === 'approval-requested' && part.approval) {
        const approvalId = part.approval.id
        return <Approval tool={name} input={(part.input ?? {}) as Record<string, any>} calendars={calendars} onAnswer={(approved, reason) => onAnswer(approvalId, approved, reason)} />
    }
    if (part.state === 'output-denied' || (part.state === 'approval-responded' && part.approval?.approved === false)) {
        return <div className="step">Declined. Nothing was changed.</div>
    }
    if (part.state === 'output-error') {
        return <div className="step step-error">{`${doing} didn't work: ${part.errorText ?? 'unknown error'}`}</div>
    }
    if (part.state === 'output-available') {
        return <div className="step step-done">{done}</div>
    }
    return <div className="step step-running">{doing}</div>
}
