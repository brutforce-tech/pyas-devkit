import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts', 'src/vercel.ts', 'src/langchain.ts', 'src/openai.ts', 'src/anthropic.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    // The frameworks are optional peers: each entry imports its own, and only that one.
    external: ['ai', '@langchain/core', '@langchain/langgraph', 'zod', '@pyas/sdk'],
})
