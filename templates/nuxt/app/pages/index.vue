<script setup lang="ts">
useHead({ title: 'Pyas starter' })
</script>

<template>
  <h1>Pyas starter for Nuxt</h1>
  <p>This app lists your calendar, books meetings and connects calendars with Pyas.</p>
  <ul>
    <li><NuxtLink to="/calendar">Your next 7 days</NuxtLink>, from every calendar you connected</li>
    <li><NuxtLink to="/connect">Connect a calendar</NuxtLink> with PyasConnect</li>
    <li>Webhooks arrive at <code>POST /api/pyas/webhooks</code></li>
  </ul>
</template>
