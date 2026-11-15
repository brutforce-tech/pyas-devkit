import { defineConfig } from 'vitest/config'

// The SDK against the real API (e2e/globalSetup.ts starts it).
export default defineConfig({
    test: {
        include: ['e2e/**/*.e2e.test.ts'],
        globalSetup: ['e2e/globalSetup.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
})
