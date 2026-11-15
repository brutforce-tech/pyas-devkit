/**
 * Runs a real coding agent (Claude Code, headless) on each task, in a fresh folder with
 * @pyas/sdk installed and, unless --no-skill, the Pyas skill in .claude/skills/pyas. Then the
 * task's checker verifies the result against the sandbox. Writes the results to evals/results/.
 *
 *   ANTHROPIC_API_KEY=... PYAS_API_KEY=pyas_sk_test_... npm run evals -- [--task <id>] [--no-skill] [--max-turns 40]
 *
 * It calls a real model, which costs money: without ANTHROPIC_API_KEY it does nothing and says so.
 * Run it with and without --no-skill to measure what the skill adds.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { TASKS, type CheckResult } from './tasks'

const ROOT = resolve(__dirname, '..')
const DEFAULT_API = 'https://api.pyas.io'

/** The permissions the agent works with: edit files, run node and npm, use the Pyas CLI. Nothing else. */
const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node *)', 'Bash(npm *)', 'Bash(npx @pyas/cli *)', 'Bash(ls *)', 'Bash(cat *)']

export interface TaskRun {
    task: string
    skill: boolean
    pass: boolean
    checks: CheckResult['checks']
    agent: { exitCode: number | null; turns: number | null; costUsd: number | null; durationMs: number; error: string | null }
    workdir: string
}

const sh = (command: string, cwd: string) => {
    const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`${command} failed (${r.status}): ${r.stderr}`)
    return r.stdout
}

export const main = async (argv: string[]): Promise<number> => {
    const { values } = parseArgs({
        args: argv,
        options: { task: { type: 'string', multiple: true }, 'no-skill': { type: 'boolean' }, 'max-turns': { type: 'string' }, model: { type: 'string' } },
    })
    if (!process.env.ANTHROPIC_API_KEY) {
        console.log('ANTHROPIC_API_KEY is not set, so no agent was run. The evaluation drives Claude Code with a real model, which costs money. Set ANTHROPIC_API_KEY to run it.')
        return 0
    }
    const pyasKey = process.env.PYAS_API_KEY
    if (!pyasKey?.startsWith('pyas_sk_test_')) {
        console.error('Set PYAS_API_KEY to a test key (pyas_sk_test_...): the agent works in the sandbox only.')
        return 2
    }
    if (spawnSync('claude', ['--version'], { shell: true }).status !== 0) {
        console.error('Claude Code is not installed: npm install -g @anthropic-ai/claude-code')
        return 2
    }
    const apiUrl = process.env.PYAS_API_URL || DEFAULT_API
    const skill = !values['no-skill']
    const tasks = values.task?.length ? TASKS.filter((t) => values.task!.includes(t.id)) : TASKS
    if (!tasks.length) {
        console.error(`No such task. Tasks: ${TASKS.map((t) => t.id).join(', ')}`)
        return 2
    }

    // The SDK as the agent installs it: packed from this repo until it is on npm.
    const packs = mkdtempSync(join(tmpdir(), 'pyas-evals-'))
    const sdk = join(packs, sh(`npm pack --ignore-scripts --loglevel=error --pack-destination "${packs}"`, join(ROOT, 'packages', 'sdk')).trim().split(/\r?\n/).pop()!)

    const runs: TaskRun[] = []
    for (const task of tasks) {
        const workdir = join(mkdtempSync(join(tmpdir(), `pyas-eval-${task.id}-`)), 'project')
        mkdirSync(workdir, { recursive: true })
        writeFileSync(join(workdir, 'package.json'), `${JSON.stringify({ name: `eval-${task.id}`, private: true, type: 'module' }, null, 2)}\n`)
        sh(`npm install --no-audit --no-fund --loglevel=error "${sdk}"`, workdir)
        if (skill) cpSync(join(ROOT, 'skills', 'pyas'), join(workdir, '.claude', 'skills', 'pyas'), { recursive: true })

        console.log(`${task.id}: running the agent${skill ? ' with the skill' : ' without the skill'}...`)
        const started = Date.now()
        // The prompt goes in on stdin, so no shell ever parses it.
        const agent = spawnSync('claude', [
            '-p',
            '--output-format', 'json',
            '--max-turns', String(values['max-turns'] ?? 40),
            '--permission-mode', 'dontAsk',
            '--allowedTools', JSON.stringify(ALLOWED_TOOLS.join(',')),
            ...(values.model ? ['--model', values.model] : []),
        ], { cwd: workdir, shell: true, input: task.prompt, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYAS_API_KEY: pyasKey, PYAS_API_URL: apiUrl } })
        const report = (() => { try { return JSON.parse(agent.stdout) } catch { return null } })()

        let check: CheckResult
        try {
            check = await task.check({ dir: workdir, apiUrl, apiKey: pyasKey })
        } catch (error) {
            check = { pass: false, checks: [{ name: 'the checker ran', pass: false, detail: (error as Error).message }] }
        }
        runs.push({
            task: task.id,
            skill,
            pass: check.pass,
            checks: check.checks,
            agent: {
                exitCode: agent.status,
                turns: typeof report?.num_turns === 'number' ? report.num_turns : null,
                costUsd: typeof report?.total_cost_usd === 'number' ? report.total_cost_usd : null,
                durationMs: Date.now() - started,
                error: agent.status === 0 ? null : (report?.result ?? agent.stderr ?? '').slice(0, 2000),
            },
            workdir,
        })
        console.log(`${task.id}: ${check.pass ? 'passed' : 'failed'}${check.pass ? '' : ` (${check.checks.filter((c) => !c.pass).map((c) => c.name).join('; ')})`}`)
    }

    const results = join(ROOT, 'evals', 'results')
    mkdirSync(results, { recursive: true })
    const file = join(results, `${new Date().toISOString().replace(/[:.]/g, '-')}${skill ? '' : '-no-skill'}.json`)
    writeFileSync(file, `${JSON.stringify({ apiUrl, skill, runs }, null, 2)}\n`)
    const passed = runs.filter((r) => r.pass).length
    console.log(`\n${passed} of ${runs.length} tasks passed. Results: ${file}`)
    return passed === runs.length ? 0 : 1
}

if (process.argv[1] && /run\.(ts|js)$/.test(process.argv[1])) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
