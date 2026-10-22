<script setup lang="ts">
import type { NuxtError } from '#app'
const props = defineProps<{ error: NuxtError }>()

const msg = computed(() =>
  props.error?.statusCode === 404
    ? "We couldn't find that page."
    : 'Something went wrong on our side.',
)
</script>

<template>
  <div class="grid min-h-screen place-items-center bg-canvas p-6">
    <div class="w-full max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-card">
      <div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-3xl">🧭</div>
      <div class="font-display text-6xl font-extrabold leading-none text-ink">
        {{ error?.statusCode || 404 }}
      </div>
      <h1 class="mt-1 font-display text-2xl uppercase">Oops!</h1>
      <p class="mt-1 text-sm text-muted">{{ msg }}</p>
      <div class="mt-5 flex justify-center gap-2">
        <NuxtLink to="/" class="btn-primary">Back to home</NuxtLink>
        <NuxtLink to="/category/electronics" class="btn-outline">Browse products</NuxtLink>
      </div>
    </div>
  </div>
</template>
