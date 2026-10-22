<script setup lang="ts">
import type { Category } from '~/data/categories'
defineProps<{ cat: Category; count?: number }>()
</script>

<template>
  <NuxtLink
    :to="`/category/${cat.slug}`"
    class="group flex flex-col overflow-hidden rounded-lg border border-line bg-white text-center transition hover:-translate-y-1 hover:border-b-[3px] hover:border-b-brand hover:shadow-card"
  >
    <div class="relative h-[88px] w-full">
      <ProductImage :product="{ id: cat.slug + '-cover', category: cat.slug, name: cat.name }" :w="360" :h="180" class="h-full w-full" img-class="transition duration-300 group-hover:scale-105" />
      <span class="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-lg shadow">{{ cat.icon }}</span>
    </div>
    <div class="p-2.5">
      <b class="block text-sm">{{ cat.name }}</b>
      <span class="text-xs text-muted">{{ count != null ? count + ' products' : cat.blurb }}</span>
    </div>
  </NuxtLink>
</template>
