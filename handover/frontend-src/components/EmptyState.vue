<script setup lang="ts">
defineProps<{ icon?: string; title: string; hint?: string }>()
</script>

<template>
  <div class="card p-8 text-center">
    <div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#EEF0F3] text-3xl">
      <slot name="icon">{{ icon || '🔍' }}</slot>
    </div>
    <h3 class="font-display text-[22px] uppercase">{{ title }}</h3>
    <p v-if="hint" class="mt-1 text-sm text-muted">{{ hint }}</p>
    <div class="mt-4 flex justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
