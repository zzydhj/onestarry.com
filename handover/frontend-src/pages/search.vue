<script setup lang="ts">
import { categories } from '~/data/categories'
import type { Product } from '~/data/products'

const route = useRoute()
const { searchProducts, products, sortProducts } = useCatalog()

const q = ref(String(route.query.q || ''))
const catFilter = ref(String(route.query.cat || ''))
const sort = ref('featured')

watchEffect(() => {
  q.value = String(route.query.q || '')
  catFilter.value = String(route.query.cat || '')
})

const results = computed<Product[]>(() => {
  const base = q.value.trim() ? searchProducts(q.value) : [...products]
  const byCat = catFilter.value ? base.filter((p) => p.category === catFilter.value) : base
  return sortProducts(byCat, sort.value)
})

const run = () => {
  navigateTo({ path: '/search', query: { q: q.value.trim(), ...(catFilter.value ? { cat: catFilter.value } : {}) } })
}
</script>

<template>
  <div class="shell py-4">
    <Breadcrumbs class="mb-3" :items="[{ label: 'Home', to: '/' }, { label: q ? `Search: ${q}` : 'Search' }]" />

    <!-- search bar -->
    <div class="mb-4 flex gap-2">
      <input v-model="q" class="field" placeholder="Search products, brands, categories…" @keyup.enter="run" />
      <button class="btn-primary shrink-0" @click="run">Search</button>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button class="chip" :class="!catFilter && 'on'" @click="catFilter = ''">All</button>
      <button
        v-for="c in categories"
        :key="c.slug"
        class="chip"
        :class="catFilter === c.slug && 'on'"
        @click="catFilter = catFilter === c.slug ? '' : c.slug"
      >{{ c.icon }} {{ c.name }}</button>
      <select v-model="sort" class="field ml-auto w-auto !py-2">
        <option value="featured">Featured</option>
        <option value="price-asc">Price ↑</option>
        <option value="price-desc">Price ↓</option>
        <option value="rating">Top rated</option>
      </select>
    </div>

    <p class="mb-3 text-sm text-muted">
      <b class="text-ink">{{ results.length }}</b> results
      <span v-if="q"> for “<b class="text-ink">{{ q }}</b>”</span>
    </p>

    <div v-if="results.length" class="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
      <ProductCard v-for="p in results" :key="p.id" :product="p" />
    </div>
    <EmptyState v-else icon="🔎" title="No results found" hint="Try a different keyword or clear the category filter.">
      <NuxtLink to="/" class="btn-primary">Back to shopping</NuxtLink>
    </EmptyState>
  </div>
</template>
