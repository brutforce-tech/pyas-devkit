import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The evaluation's checkers against the real API (the SDK suite's setup starts it): npm run test:evals.
export default defineConfig({
    root: dirname(fileURLToPath(import.meta.url)),
    test: {
        include: ['test/**/*.test.ts'],
        globalSetup: ['../packages/sdk/e2e/globalSetup.ts'],
        testTimeout: 120_000,
        hookTimeout: 120_000,
        fileParallelism: false,
    },
})
