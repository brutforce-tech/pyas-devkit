export default defineNuxtConfig({
    compatibilityDate: '2026-10-01',
    css: ['~/assets/main.css'],
    runtimeConfig: {
        public: {
            // Empty unless PYAS_API_URL is set, so PyasConnect uses https://api.pyas.io (NUXT_PUBLIC_PYAS_API_URL at runtime).
            pyasApiUrl: process.env.PYAS_API_URL ?? '',
        },
    },
})
