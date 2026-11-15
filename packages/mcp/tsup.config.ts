import { defineConfig } from 'tsup'

// The library in both formats, so CommonJS servers can host it; the command line in ESM only.
export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        target: 'node20',
    },
    {
        entry: ['src/cli.ts'],
        format: ['esm'],
        sourcemap: true,
        target: 'node20',
    },
])
