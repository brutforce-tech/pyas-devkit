// What the Supabase recipes use of Deno and Supabase, for typechecking them in Node (recipes/tsconfig.json).
declare const Deno: {
    env: { get(name: string): string | undefined }
    serve(handler: (req: Request) => Response | Promise<Response>): void
}

declare module 'npm:@supabase/supabase-js@2' {
    export function createClient(url: string, key: string, options?: { global?: { headers?: Record<string, string> } }): {
        auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> }
    }
}
