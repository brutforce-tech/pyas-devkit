<script setup lang="ts">
interface Calendar {
  accounts: Array<{ accountId: string; label: string }>
  events: Array<{ id: string; title: string; startsAt: string; isAllDay: boolean }>
}
interface PyasErrorBody { error: { code: string; message: string; hint?: string | null; traceId?: string | null } }

useHead({ title: 'Calendar' })
const { data, error, refresh } = await useFetch<Calendar>('/api/calendar')
// The API's error, with its hint and trace ID, from the server route.
const failure = computed(() => (error.value?.data as PyasErrorBody | undefined)?.error)
const status = ref('')

async function book() {
  try {
    const { event } = await $fetch<{ event: { startsAt: string } }>('/api/pyas/book', { method: 'POST', body: { title: 'Intro call' } })
    status.value = `Booked ${new Date(event.startsAt).toUTCString()}`
    await refresh()
  } catch (e) {
    status.value = ((e as { data?: PyasErrorBody }).data?.error.message) ?? 'The meeting could not be booked.'
  }
}

const when = (e: { startsAt: string; isAllDay: boolean }) => (e.isAllDay ? e.startsAt.slice(0, 10) : new Date(e.startsAt).toUTCString())
</script>

<template>
  <template v-if="failure">
    <h1>The calendar could not be loaded</h1>
    <p>{{ failure.code }}: {{ failure.message }}</p>
    <p v-if="failure.hint">{{ failure.hint }}</p>
    <p v-if="failure.traceId">Trace ID: <code>{{ failure.traceId }}</code></p>
  </template>
  <template v-else-if="data">
    <h1>Your next 7 days</h1>
    <p>
      Calendars:
      <template v-if="data.accounts.length">{{ data.accounts.map((a) => a.label).join(', ') }}</template>
      <template v-else>none yet. <NuxtLink to="/connect">Connect one</NuxtLink>.</template>
    </p>
    <p><button @click="book">Book the first free 30 minutes tomorrow</button> <span role="status">{{ status }}</span></p>
    <ol class="events">
      <li v-for="e in data.events" :key="e.id" :data-event-id="e.id"><time>{{ when(e) }}</time> {{ e.title || '(no title)' }}</li>
      <li v-if="!data.events.length">No events in the next 7 days.</li>
    </ol>
  </template>
</template>
