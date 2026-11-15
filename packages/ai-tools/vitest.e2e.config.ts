import { defineConfig } from 'vitest/config'

// The tools against the real API (the SDK suite's setup starts it).
export default defineConfig({
    test: {
        include: ['e2e/**/*.e2e.test.ts'],
        globalSetup: ['../sdk/e2e/globalSetup.ts'],
        testTimeout: 60_000,
        hookTimeout: 120_000,
        fileParallelism: false,
    },
})
