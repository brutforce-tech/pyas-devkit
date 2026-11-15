import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The starter templates against the real API (the SDK suite's setup starts it): npm run test:templates.
export default defineConfig({
    root: dirname(fileURLToPath(import.meta.url)),
    test: {
        include: ['test/**/*.e2e.test.ts'],
        globalSetup: ['../packages/sdk/e2e/globalSetup.ts'],
        testTimeout: 120_000,
        hookTimeout: 900_000,
        fileParallelism: false,
    },
})
