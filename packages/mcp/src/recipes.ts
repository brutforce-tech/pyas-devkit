/**
 * Recipes: the code an app needs for one task on one platform, where each file goes, which
 * secret to set, and the steps in plain words, for people who build with an AI app builder and
 * may never read the code. The files are in recipes/, one folder per runtime (TanStack Start for
 * Lovable, Supabase Edge Functions for older Lovable projects and Bolt, Next.js for v0, Express
 * for Replit, Base44's backend functions), and the end-to-end suite runs them against the API.
 *
 * Every recipe keeps the key on the server: the browser calls the app's own server code, which
 * calls Pyas. With a test key the code works on the sandbox's sample person straight away; with
 * a live key it needs the signed-in person, and answers "Sign in" without one.
 */
import { RECIPE_FILES } from './recipeFiles'

export const RECIPE_PLATFORMS = ['lovable', 'lovable-vite', 'bolt', 'replit', 'v0', 'base44', 'nextjs', 'express'] as const
export const RECIPE_TASKS = ['connect-calendar', 'list-events', 'book', 'receive-webhooks'] as const
export type RecipePlatform = typeof RECIPE_PLATFORMS[number]
export type RecipeTask = typeof RECIPE_TASKS[number]

export interface RecipeFile {
    /** Where the file goes in the project. */
    path: string
    content: string
    /** What it is for, in a few words. */
    purpose: string
}

export interface Recipe {
    platform: RecipePlatform
    task: RecipeTask
    title: string
    files: RecipeFile[]
    /** Packages to install; none for Supabase's or Base44's functions, which import them by their npm: names. */
    packages: string[]
    secrets: Array<{ name: string; where: string }>
    steps: string[]
    nextStep: string
}

type Runtime = 'supabase' | 'tanstack' | 'base44' | 'nextjs' | 'express'

interface Platform {
    name: string
    runtime: Runtime
    /** Where a secret is kept, as the platform names it. */
    secretHome: string
    /** After adding a server file: how it starts answering. */
    deploy: string
    /** The connect button: a React component, or plain HTML. */
    frontEnd: 'react' | 'html'
    /** The webhook endpoint's public address. */
    webhookUrl: string
    /** How a page calls the app's server code for a task. */
    call: (path: string, method: 'GET' | 'POST') => string
    /** Where the person signs in, for the live-key step. */
    signIn: string
    /** What a page gets back from a call, when it is not a Response. */
    callResult?: string
    /** Before going live: how the code learns who is signed in. */
    goLive: string
}

const supabaseCall = (fn: string) => `const { data, error } = await supabase.functions.invoke('${fn}')`
const fetchCall = (path: string, method: 'GET' | 'POST') => (method === 'GET' ? `const res = await fetch('${path}')` : `const res = await fetch('${path}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Intro call' }) })`)
const SUPABASE_FUNCTIONS: Record<string, string> = { '/api/pyas/connect-session': 'pyas-connect-session', '/api/pyas/events': 'pyas-events', '/api/pyas/book': 'pyas-book' }
const SERVER_FUNCTIONS: Record<string, [name: string, file: string]> = { '/api/pyas/connect-session': ['getConnectSession', 'pyas-connect'], '/api/pyas/events': ['listEvents', 'pyas-events'], '/api/pyas/book': ['bookMeeting', 'pyas-book'] }
const BASE44_FUNCTIONS: Record<string, string> = { '/api/pyas/connect-session': 'pyasConnectSession', '/api/pyas/events': 'pyasEvents', '/api/pyas/book': 'pyasBook' }
const SUPABASE_GO_LIVE = (signIn: string) => `the person creates a live key in the Pyas dashboard and replaces PYAS_API_KEY with it. The functions then use the signed-in person (${signIn}) and respond "Sign in" without one.`
const CODE_GO_LIVE = (file: string) => `make currentUserId() in ${file} return the signed-in person's ID from the app's sign-in, then the person creates a live key in the Pyas dashboard and replaces PYAS_API_KEY with it. Until then, live requests respond "Sign in".`

// Checked against each platform's documentation on 2026-11-09.
const PLATFORMS: Record<RecipePlatform, Platform> = {
    lovable: {
        name: 'Lovable',
        runtime: 'tanstack',
        secretHome: 'a Lovable secret (More, Settings, Secrets; use the Add secret form, never the chat). Server functions read it, and it never reaches the browser',
        deploy: 'These are TanStack Start server functions, which run inside the app: the preview has them straight away, and publishing puts them live.',
        frontEnd: 'react',
        webhookUrl: 'the published address, https://<your-app>.lovable.app/api/public/pyas-webhooks',
        call: (path) => `import { ${SERVER_FUNCTIONS[path][0]} } from '@/lib/${SERVER_FUNCTIONS[path][1]}.functions', then const result = await ${SERVER_FUNCTIONS[path][0]}()`,
        callResult: 'The result is the data, or { error } with a code and hint when something is wrong.',
        signIn: 'Lovable sign-in',
        goLive: 'add the app\'s sign-in to each server function, .middleware([requireSupabaseAuth]) from @/integrations/supabase/auth-middleware (Lovable adds it with sign-in), so the functions use the signed-in person. Then the person creates a live key in the Pyas dashboard and replaces PYAS_API_KEY with it. Until then, live requests respond "Sign in".',
    },
    'lovable-vite': {
        name: 'Lovable (React and Vite)',
        runtime: 'supabase',
        secretHome: 'a Lovable secret (More, Settings, Secrets; use the Add secret form, never the chat). Edge Functions read it, and it never reaches the browser',
        deploy: 'These are Edge Functions in Lovable Cloud, which is on by default. Lovable deploys the functions it adds; if one does not answer, ask Lovable to deploy it.',
        frontEnd: 'react',
        webhookUrl: "the pyas-webhooks function's address, https://<your-project-ref>.supabase.co/functions/v1/pyas-webhooks",
        call: (path) => supabaseCall(SUPABASE_FUNCTIONS[path]),
        signIn: 'Supabase sign-in',
        goLive: SUPABASE_GO_LIVE('Supabase sign-in'),
    },
    bolt: {
        name: 'Bolt',
        runtime: 'supabase',
        secretHome: 'a Bolt secret (the database icon, Secrets, then Save), or an Edge Function secret in Supabase when the project uses its own Supabase',
        deploy: 'These are Supabase Edge Functions; Bolt deploys server functions with the project.',
        frontEnd: 'react',
        webhookUrl: "the pyas-webhooks function's address, as Bolt shows it under the database icon, Server Functions",
        call: (path) => supabaseCall(SUPABASE_FUNCTIONS[path]),
        signIn: 'Supabase sign-in',
        goLive: SUPABASE_GO_LIVE('Supabase sign-in'),
    },
    replit: {
        name: 'Replit',
        runtime: 'express',
        secretHome: 'Replit Secrets (Tools, Secrets), and again for the published app (Publishing, Production app secrets): secrets in the editor do not carry over',
        deploy: 'Restart the app so the server picks up the new routes.',
        frontEnd: 'react',
        webhookUrl: "the published address, https://<your-app>.replit.app/api/pyas/webhooks (the editor preview's address can change, so Pyas cannot rely on it)",
        call: fetchCall,
        signIn: 'sign-in',
        goLive: CODE_GO_LIVE('server/pyas.ts'),
    },
    v0: {
        name: 'v0',
        runtime: 'nextjs',
        secretHome: 'an environment variable (the project menu, Settings, Environment Variables; the preview reads the Development ones, the published app the Production ones)',
        deploy: 'The preview runs the new routes; Publish Changes publishes them.',
        frontEnd: 'react',
        webhookUrl: 'the published address, https://<your-app>.vercel.app/api/pyas/webhooks',
        call: fetchCall,
        signIn: 'sign-in',
        goLive: CODE_GO_LIVE('lib/pyas.ts'),
    },
    base44: {
        name: 'Base44',
        runtime: 'base44',
        secretHome: 'a Base44 secret (Dashboard, Secrets, Add Secret; the page appears once the app has a backend function). Backend functions read it, and it never reaches the browser. Backend functions need the Builder plan or above',
        deploy: 'These are backend functions. The editor runs them; publish the app again so the published app has them and the current secrets.',
        frontEnd: 'react',
        webhookUrl: 'the published address, https://<your-app>.base44.app/functions/pyasWebhooks',
        call: (path) => `const { data } = await base44.functions.invoke('${BASE44_FUNCTIONS[path]}', {})`,
        callResult: 'data is the function\'s JSON, with an error code and hint when something is wrong.',
        signIn: 'Base44 sign-in',
        goLive: SUPABASE_GO_LIVE('Base44 sign-in'),
    },
    nextjs: {
        name: 'Next.js',
        runtime: 'nextjs',
        secretHome: "an environment variable (.env.local while developing, never committed; your host's environment variables in production)",
        deploy: 'Next.js serves the new routes on its next start or deploy.',
        frontEnd: 'react',
        webhookUrl: 'https://<your-domain>/api/pyas/webhooks',
        call: fetchCall,
        signIn: 'sign-in',
        goLive: CODE_GO_LIVE('lib/pyas.ts'),
    },
    express: {
        name: 'Express',
        runtime: 'express',
        secretHome: "an environment variable (a .env file while developing, never committed; your host's environment variables in production)",
        deploy: 'Restart the server so it picks up the new routes.',
        frontEnd: 'html',
        webhookUrl: 'https://<your-domain>/api/pyas/webhooks',
        call: fetchCall,
        signIn: 'sign-in',
        goLive: CODE_GO_LIVE('server/pyas.ts'),
    },
}

/** Lovable's Supabase client is at @/integrations/supabase/client; elsewhere the agent points the import at the project's own. */
const SUPABASE_CLIENT_IMPORT = "import { supabase } from '@/integrations/supabase/client'"
const BOLT_CLIENT_IMPORT = "// Point this at the file where the project creates its Supabase client.\nimport { supabase } from '@/lib/supabase'"

/** A runtime's files for a task, from recipes/<runtime>/. */
const FILES: Record<Runtime, Record<RecipeTask, Array<[path: string, purpose: string]>> & { shared: Array<[string, string]> }> = {
    tanstack: {
        shared: [['src/lib/pyas.server.ts', 'The Pyas client and whose calendars a request is about (server only)']],
        'connect-calendar': [
            ['src/lib/pyas-connect.functions.ts', 'Creates a connect session for the button'],
            ['src/components/ConnectCalendar.tsx', 'The "Connect an account" button'],
        ],
        'list-events': [['src/lib/pyas-events.functions.ts', 'The person\'s next 7 days of events']],
        book: [['src/lib/pyas-book.functions.ts', 'Books the first free 30 minutes tomorrow']],
        'receive-webhooks': [['src/routes/api/public/pyas-webhooks.ts', 'Receives and verifies Pyas\'s webhooks']],
    },
    base44: {
        shared: [],
        'connect-calendar': [
            ['base44/functions/pyasConnectSession/entry.ts', 'Creates a connect session for the button'],
            ['src/components/ConnectCalendar.jsx', 'The "Connect an account" button'],
        ],
        'list-events': [['base44/functions/pyasEvents/entry.ts', 'The person\'s next 7 days of events']],
        book: [['base44/functions/pyasBook/entry.ts', 'Books the first free 30 minutes tomorrow']],
        'receive-webhooks': [['base44/functions/pyasWebhooks/entry.ts', 'Receives and verifies Pyas\'s webhooks']],
    },
    supabase: {
        shared: [['supabase/functions/_shared/pyas.ts', 'The Pyas client and the helpers the functions share']],
        'connect-calendar': [
            ['supabase/functions/pyas-connect-session/index.ts', 'Makes a connect session for the button'],
            ['src/components/ConnectCalendar.tsx', 'The "Connect an account" button'],
        ],
        'list-events': [['supabase/functions/pyas-events/index.ts', 'The person\'s next 7 days of events']],
        book: [['supabase/functions/pyas-book/index.ts', 'Books the first free 30 minutes tomorrow']],
        'receive-webhooks': [
            ['supabase/functions/pyas-webhooks/index.ts', 'Receives and verifies Pyas\'s webhooks'],
            ['supabase/config.toml', 'Lets Pyas call the webhook function without a Supabase sign-in (add these lines to the existing file)'],
        ],
    },
    nextjs: {
        shared: [['lib/pyas.ts', 'The Pyas client and who is signed in']],
        'connect-calendar': [
            ['app/api/pyas/connect-session/route.ts', 'Makes a connect session for the button'],
            ['components/connect-calendar.tsx', 'The "Connect an account" button'],
        ],
        'list-events': [['app/api/pyas/events/route.ts', 'The person\'s next 7 days of events']],
        book: [['app/api/pyas/book/route.ts', 'Books the first free 30 minutes tomorrow']],
        'receive-webhooks': [['app/api/pyas/webhooks/route.ts', 'Receives and verifies Pyas\'s webhooks']],
    },
    express: {
        shared: [['server/pyas.ts', 'The Pyas client and who is signed in']],
        'connect-calendar': [
            ['server/routes/pyas-connect-session.ts', 'Makes a connect session for the button'],
            ['client/ConnectCalendar.tsx', 'The "Connect an account" button'],
        ],
        'list-events': [['server/routes/pyas-events.ts', 'The person\'s next 7 days of events']],
        book: [['server/routes/pyas-book.ts', 'Books the first free 30 minutes tomorrow']],
        'receive-webhooks': [['server/routes/pyas-webhooks.ts', 'Receives and verifies Pyas\'s webhooks']],
    },
}

const ROUTERS: Record<RecipeTask, string> = { 'connect-calendar': 'pyasConnectSession', 'list-events': 'pyasEvents', book: 'pyasBook', 'receive-webhooks': 'pyasWebhooks' }

const TITLES: Record<RecipeTask, string> = {
    'connect-calendar': 'Let people connect their Google or Outlook calendar',
    'list-events': 'Show a person\'s upcoming events',
    book: 'Book a meeting at a time everyone is free',
    'receive-webhooks': 'Receive Pyas webhooks',
}

const file = (runtime: Runtime, path: string, purpose: string): RecipeFile => {
    const content = RECIPE_FILES[`${runtime}/${path}`]
    if (content === undefined) throw new Error(`No recipe file ${runtime}/${path}`)
    return { path, content, purpose }
}

const filesFor = (platform: Platform, task: RecipeTask): RecipeFile[] => {
    const runtime = platform.runtime
    const own = FILES[runtime][task]
        // Express without React gets the button as plain HTML.
        .map(([path, purpose]): [string, string] => (path === 'client/ConnectCalendar.tsx' && platform.frontEnd === 'html' ? ['public/connect.html', 'The "Connect an account" button, for any page'] : [path, purpose]))
    const shared = task === 'receive-webhooks' ? [] : FILES[runtime].shared
    return [...shared, ...own].map(([path, purpose]) => {
        const made = file(runtime, path, purpose)
        if (platform.name === 'Bolt' && path === 'src/components/ConnectCalendar.tsx') {
            made.content = made.content.replace(SUPABASE_CLIENT_IMPORT, BOLT_CLIENT_IMPORT)
        }
        return made
    })
}

const packagesFor = (platform: Platform, task: RecipeTask): string[] => {
    const button = task === 'connect-calendar' ? [platform.frontEnd === 'react' ? '@pyas/connect-react' : null] : []
    const server = platform.runtime === 'supabase' || platform.runtime === 'base44' ? [] : ['@pyas/sdk']
    return [...server, ...button].filter((name): name is string => !!name)
}

const stepsFor = (platform: Platform, task: RecipeTask): { steps: string[]; nextStep: string } => {
    const supabase = platform.runtime === 'supabase'
    const steps: string[] = []
    const packages = packagesFor(platform, task)
    if (task === 'receive-webhooks') {
        steps.push('Add the files below, at the paths shown.')
        if (platform.runtime === 'express') steps.push(`Mount the route before the app parses JSON: app.use(${ROUTERS[task]}) above app.use(express.json()). A parsed body no longer matches its signature.`)
        if (packages.length) steps.push(`Install ${packages.join(' and ')}.`)
        steps.push(platform.deploy)
        steps.push(`Add the endpoint with create_webhook, using its public address: ${platform.webhookUrl}. Pyas sends a test delivery straight away.`)
        steps.push(`Store the signing secret create_webhook returns as the secret PYAS_WEBHOOK_SECRET: ${platform.secretHome}.`)
        steps.push('Each delivery is checked against its Pyas-Signature header before anything else, so a request that did not come from Pyas is refused with 400.')
        return { steps, nextStep: 'Add the endpoint with create_webhook, store its signing secret as PYAS_WEBHOOK_SECRET, then run setup_status.' }
    }
    steps.push(`Store the app's test key (from get_test_key) as the secret PYAS_API_KEY: ${platform.secretHome}. Never put it in code that runs in the browser.`)
    steps.push('Add the files below, at the paths shown.')
    if (platform.runtime === 'express') steps.push(`Mount the route in the server: app.use(${ROUTERS[task]}).`)
    if (packages.length) steps.push(`Install ${packages.join(' and ')}.`)
    steps.push(platform.deploy)
    const path = task === 'list-events' ? '/api/pyas/events' : task === 'book' ? '/api/pyas/book' : '/api/pyas/connect-session'
    if (task === 'connect-calendar') {
        steps.push('Add the address the app runs at (its preview address, and its published one) to the app\'s allowed origins with update_app. The person confirms each address in Pyas from the link the tool answers with. The button only opens there.')
        if (platform.name === 'Bolt') steps.push('In src/components/ConnectCalendar.tsx, point the Supabase import at the file where the project creates its Supabase client.')
        steps.push(platform.frontEnd === 'react' ? 'Put <ConnectCalendar /> on the page where people connect their calendar.' : 'Put the contents of public/connect.html on the page where people connect their calendar.')
        steps.push('With a test key, pressing the button opens the Pyas sandbox\'s sign-in instead of Google\'s or Microsoft\'s, and connects a sample account. With a live key, the same button connects real calendars.')
    } else {
        const result = platform.callResult ?? (supabase ? '' : 'The response is JSON, with an error code and hint when something is wrong.')
        steps.push(`Call it from a page: ${platform.call(path, task === 'book' ? 'POST' : 'GET')}.${result ? ` ${result}` : ''}`)
        if (task === 'list-events') steps.push('Show event titles as text, never as HTML: whoever sent the invitation wrote them.')
    }
    steps.push(`Before going live: ${platform.goLive}`)
    return {
        steps,
        nextStep: task === 'connect-calendar'
            ? 'Store the test key as PYAS_API_KEY, add the files and the app\'s address (update_app), then run setup_status.'
            : 'Store the test key as PYAS_API_KEY, add the files, then try it on the sandbox\'s sample person.',
    }
}

/** The recipe for a task on a platform. */
export const recipeFor = (platformId: RecipePlatform, task: RecipeTask): Recipe => {
    const platform = PLATFORMS[platformId]
    if (!platform) throw new TypeError(`No recipe for ${platformId}. Platforms: ${RECIPE_PLATFORMS.join(', ')}.`)
    if (!RECIPE_TASKS.includes(task)) throw new TypeError(`No recipe for ${task}. Tasks: ${RECIPE_TASKS.join(', ')}.`)
    const { steps, nextStep } = stepsFor(platform, task)
    return {
        platform: platformId,
        task,
        title: `${TITLES[task]} (${platform.name})`,
        files: filesFor(platform, task),
        packages: packagesFor(platform, task),
        secrets: task === 'receive-webhooks'
            ? [{ name: 'PYAS_WEBHOOK_SECRET', where: platform.secretHome }]
            : [{ name: 'PYAS_API_KEY', where: platform.secretHome }],
        steps,
        nextStep,
    }
}

/** A recipe as text an agent reads: the steps, then each file in full. */
export const recipeText = (recipe: Recipe) => [
    recipe.title,
    '',
    ...recipe.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    ...recipe.files.flatMap((f) => [`--- ${f.path} (${f.purpose}) ---`, f.content.trimEnd(), '']),
    `Next step: ${recipe.nextStep}`,
].join('\n')
