<script setup lang="ts">
import { PyasConnect } from '@pyas/connect-vue'

useHead({ title: 'Connect a calendar' })
// PyasConnect uses https://api.pyas.io unless PYAS_API_URL is set.
const apiUrl = useRuntimeConfig().public.pyasApiUrl || undefined
const status = ref('')

// A new session for every attempt: a session works once and expires after 10 minutes.
async function getSessionToken() {
  try {
    const { token } = await $fetch<{ token: string }>('/api/pyas/connect-session', { method: 'POST' })
    return token
  } catch (e) {
    // The API's error and its hint, such as a page origin missing from your app's allowed origins.
    const error = (e as { data?: { error: { message: string; hint?: string } } }).data?.error
    status.value = error ? `${error.message}${error.hint ? ` ${error.hint}` : ''}` : 'The connect session could not be created.'
    throw e
  }
}

function onConnected(account: { email: string }) {
  status.value = `Connected ${account.email}`
}
</script>

<template>
  <h1>Connect a calendar</h1>
  <p>
    Connect your Google or Outlook calendar. Each attempt uses a new connect session from this app's server, so your API
    key never reaches the browser.
  </p>
  <PyasConnect :get-session-token="getSessionToken" :api-url="apiUrl" theme="auto" @connected="onConnected" />
  <p role="status">{{ status }}</p>
</template>
