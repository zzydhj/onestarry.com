<script setup lang="ts">
interface Crumb {
  label: string
  to?: string
}
defineProps<{ items: Crumb[] }>()
</script>

<template>
  <nav class="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
    <template v-for="(c, i) in items" :key="i">
      <span v-if="i" class="text-[#c1c6cf]">/</span>
      <NuxtLink v-if="c.to" :to="c.to" class="hover:text-brand">{{ c.label }}</NuxtLink>
      <span v-else class="font-semibold text-ink">{{ c.label }}</span>
    </template>
  </nav>
</template>
