// What the TanStack Start (Lovable) and Base44 recipes use of their platforms, for typechecking them in Node (recipes/tsconfig.json).
declare module '@tanstack/react-start' {
    interface ServerFn<Result> {
        (): Promise<Result>
        middleware(middleware: unknown[]): ServerFn<Result>
    }
    export function createServerFn(options?: { method?: 'GET' | 'POST' }): {
        handler<Result>(handler: (ctx: { data: undefined; context: unknown }) => Promise<Result>): ServerFn<Result>
    }
}

declare module '@tanstack/react-router' {
    export function createFileRoute(path: string): (options: { server: { handlers: Record<string, (ctx: { request: Request }) => Promise<Response>> } }) => unknown
}

declare module 'npm:@base44/sdk@0.8.54' {
    export function createClientFromRequest(req: Request): { auth: { me(): Promise<{ id: string; email: string } | null> } }
}

declare module 'base44:runtime' {
    export const secrets: { get(name: string): string | undefined }
}
