import { defineConfig } from 'vitest/config'

// The collection against the real API, with the Postman CLI (the SDK suite's setup starts the API).
export default defineConfig({
    test: {
        include: ['e2e/**/*.e2e.test.ts'],
        globalSetup: ['../sdk/e2e/globalSetup.ts'],
        testTimeout: 600_000,
        hookTimeout: 120_000,
        fileParallelism: false,
    },
})
