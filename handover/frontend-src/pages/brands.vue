<script setup lang="ts">
import { categories } from '~/data/categories'
import { products, countByCategory } from '~/data/products'

useSeoMeta({ title: 'Brands & Departments — Onestarry' })

const brands = computed(() => {
  const map = new Map<string, number>()
  for (const p of products) map.set(p.brand, (map.get(p.brand) || 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
})
</script>

<template>
  <div class="shell py-4">
    <Breadcrumbs class="mb-3" :items="[{ label: 'Home', to: '/' }, { label: 'Brands & Departments' }]" />
    <h1 class="sec-title mb-1 text-[38px]">Brands & Departments</h1>
    <p class="mb-6 text-sm text-muted">Browse the whole marketplace by department or jump straight to a brand.</p>

    <section class="mb-8">
      <h2 class="sec-title mb-3.5 text-[26px]">Departments</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <CategoryTile v-for="c in categories" :key="c.slug" :cat="c" :count="countByCategory(c.slug)" />
      </div>
    </section>

    <section>
      <h2 class="sec-title mb-3.5 text-[26px]">All brands</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        <NuxtLink
          v-for="[b, n] in brands"
          :key="b"
          :to="`/search?q=${encodeURIComponent(b)}`"
          class="rounded-lg border border-line bg-white p-4 text-center transition hover:border-brand hover:shadow"
        >
          <div class="font-display text-xl font-extrabold tracking-wide">{{ b }}</div>
          <div class="text-xs text-muted">{{ n }} product{{ n > 1 ? 's' : '' }}</div>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
