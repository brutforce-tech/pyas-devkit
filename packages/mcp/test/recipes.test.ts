import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain .mjs script, without types
import { renderRecipeFiles } from '../scripts/generate-recipes.mjs'
import { RECIPE_PLATFORMS, RECIPE_TASKS, recipeFor, recipeText } from '../src/recipes'

/** The recipes as an agent gets them: complete, and safe when nobody reads the code. */

const BROWSER_FILES = /ConnectCalendar\.(tsx|jsx)$|connect-calendar\.tsx$|connect\.html$/
const every = RECIPE_PLATFORMS.flatMap((platform) => RECIPE_TASKS.map((task) => [platform, task] as const))

describe('recipes', () => {
    it('the package carries the files in recipes/ as they are (npm run generate:recipes)', () => {
        expect(readFileSync(join(__dirname, '..', 'src', 'recipeFiles.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe(renderRecipeFiles())
    })

    it.each(every)('%s, %s: files, a secret, steps and a next step, in plain words', (platform, task) => {
        const recipe = recipeFor(platform, task)
        expect(recipe.files.length).toBeGreaterThan(0)
        for (const f of recipe.files) expect(f.content.trim().length, f.path).toBeGreaterThan(0)
        expect(recipe.secrets[0].name).toBe(task === 'receive-webhooks' ? 'PYAS_WEBHOOK_SECRET' : 'PYAS_API_KEY')
        expect(recipe.steps.length).toBeGreaterThan(2)
        const text = recipeText(recipe)
        expect(text).toMatch(/Next step: .+$/)
        expect(text).not.toContain('—')
    })

    it.each(every)('%s, %s: no key in any file, and the browser never sees the key\'s name', (platform, task) => {
        for (const f of recipeFor(platform, task).files) {
            expect(f.content, f.path).not.toMatch(/pyas_sk_[A-Za-z0-9]{8,}/)
            if (BROWSER_FILES.test(f.path)) {
                expect(f.content, f.path).not.toContain('PYAS_API_KEY')
                expect(f.content, f.path).not.toContain('@pyas/sdk')
            }
        }
    })

    it.each(RECIPE_PLATFORMS)('%s: the webhook handler verifies the signature on the raw body before anything else', (platform) => {
        const handler = recipeFor(platform, 'receive-webhooks').files.find((f) => /webhooks/i.test(f.path))!
        expect(handler.content).toContain('constructWebhookEvent(')
        expect(handler.content).toMatch(/req\.text\(\)|request\.text\(\)|express\.raw\(/)
        expect(handler.content).toContain('WEBHOOK_SIGNATURE_INVALID')
        expect(handler.content.indexOf('constructWebhookEvent(')).toBeLessThan(handler.content.indexOf('console.log'))
    })

    it('a live key needs the signed-in person: the placeholder never mixes people\'s calendars', () => {
        for (const platform of RECIPE_PLATFORMS) {
            const shared = recipeFor(platform, 'list-events').files[0].content
            expect(shared, platform).toContain("startsWith('pyas_sk_test_')) return 'sandbox_user_1'")
            expect(shared, platform).toMatch(/return null|\?\? null/)
        }
    })

    it('Supabase platforms: the webhook function is public to Pyas only through its signature; Bolt imports its own client', () => {
        const lovable = recipeFor('lovable-vite', 'receive-webhooks')
        expect(lovable.files.map((f) => f.path)).toEqual(['supabase/functions/pyas-webhooks/index.ts', 'supabase/config.toml'])
        expect(lovable.files[1].content).toContain('verify_jwt = false')
        const bolt = recipeFor('bolt', 'connect-calendar').files.find((f) => f.path === 'src/components/ConnectCalendar.tsx')!
        expect(bolt.content).not.toContain('@/integrations/supabase/client')
        expect(bolt.content).toContain('Point this at the file where the project creates its Supabase client.')
        expect(recipeFor('lovable-vite', 'connect-calendar').files.find((f) => f.path === 'src/components/ConnectCalendar.tsx')!.content).toContain('@/integrations/supabase/client')
    })

    it('Express mounts the webhook route before JSON parsing; plain Express gets the button as HTML', () => {
        expect(recipeFor('express', 'receive-webhooks').steps.join(' ')).toContain('above app.use(express.json())')
        expect(recipeFor('express', 'connect-calendar').files.map((f) => f.path)).toContain('public/connect.html')
        expect(recipeFor('replit', 'connect-calendar').files.map((f) => f.path)).toContain('client/ConnectCalendar.tsx')
        expect(recipeFor('replit', 'connect-calendar').packages).toEqual(['@pyas/sdk', '@pyas/connect-react'])
        expect(recipeFor('lovable-vite', 'book').packages).toEqual([])
    })

    it("Lovable (TanStack Start): server functions that load the key's module on the server only, a public webhook route", () => {
        const events = recipeFor('lovable', 'list-events')
        expect(events.files.map((f) => f.path)).toEqual(['src/lib/pyas.server.ts', 'src/lib/pyas-events.functions.ts'])
        expect(events.packages).toEqual(['@pyas/sdk'])
        // *.functions.ts is in the browser's code too: it imports the server module inside the handler.
        const fn = events.files[1].content
        expect(fn).not.toMatch(/^import .*pyas\.server/m)
        expect(fn).toContain("await import('./pyas.server')")
        // Read per request: a secret read when the file loads is undefined on Lovable's servers.
        expect(events.files[0].content).not.toMatch(/^const .*process\.env/m)
        expect(events.steps.join(' ')).toContain("import { listEvents } from '@/lib/pyas-events.functions'")
        expect(events.steps.join(' ')).toContain('.middleware([requireSupabaseAuth])')
        expect(recipeFor('lovable', 'receive-webhooks').files.map((f) => f.path)).toEqual(['src/routes/api/public/pyas-webhooks.ts'])
        expect(recipeFor('lovable', 'receive-webhooks').steps.join(' ')).toContain('https://<your-app>.lovable.app/api/public/pyas-webhooks')
    })

    it('Base44: backend functions with the key from secrets.get, called with base44.functions.invoke', () => {
        const events = recipeFor('base44', 'list-events')
        expect(events.files.map((f) => f.path)).toEqual(['base44/functions/pyasEvents/entry.ts'])
        expect(events.packages).toEqual([])
        expect(events.files[0].content).toContain("secrets.get('PYAS_API_KEY')")
        expect(events.files[0].content).toContain('export default async function')
        expect(events.steps.join(' ')).toContain("base44.functions.invoke('pyasEvents', {})")
        expect(events.steps.join(' ')).toContain('Builder plan')
        const connect = recipeFor('base44', 'connect-calendar')
        expect(connect.files.map((f) => f.path)).toEqual(['base44/functions/pyasConnectSession/entry.ts', 'src/components/ConnectCalendar.jsx'])
        expect(connect.packages).toEqual(['@pyas/connect-react'])
        expect(recipeFor('base44', 'receive-webhooks').steps.join(' ')).toContain('https://<your-app>.base44.app/functions/pyasWebhooks')
    })

    it('an unknown platform or task is refused with the choices', () => {
        expect(() => recipeFor('wix' as any, 'book')).toThrow(/Platforms: lovable/)
        expect(() => recipeFor('lovable', 'dance' as any)).toThrow(/Tasks: connect-calendar/)
    })
})
