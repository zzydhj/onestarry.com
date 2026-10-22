<script setup lang="ts">
import { categoryBySlug } from '~/data/categories'
import { productsByCategory } from '~/data/products'
import type { Product } from '~/data/products'

const route = useRoute()
const { sortProducts } = useCatalog()

const slug = computed(() => String(route.params.slug))
const cat = computed(() => categoryBySlug(slug.value))

if (!cat.value) {
  throw createError({ statusCode: 404, statusMessage: 'Category not found', title: 'Unknown category' })
}

useSeoMeta({ title: () => `${cat.value!.name} — Onestarry` })

// ---- filters ----
const sub = ref<string>('')
const sort = ref<string>('featured')
const maxPrice = ref<number>(0)

// sync ?sub= on entry
watchEffect(() => {
  sub.value = String(route.query.sub || '')
  sort.value = String(route.query.sort || 'featured')
})

const base = computed<Product[]>(() => (cat.value ? productsByCategory(cat.value.slug) : []))

const priceCeil = computed(() => Math.ceil(Math.max(...base.value.map((p) => p.price), 0) / 50) * 50)
watch(priceCeil, (v) => (maxPrice.value = v || 0), { immediate: true })

const results = computed(() => {
  let list = base.value
  if (sub.value) list = list.filter((p) => p.sub === sub.value)
  if (maxPrice.value) list = list.filter((p) => p.price <= maxPrice.value)
  return sortProducts(list, sort.value)
})

const resetFilters = () => {
  sub.value = ''
  maxPrice.value = priceCeil.value
  navigateTo(`/category/${slug.value}`)
}

// keep URL in sync (sub / sort)
watch([sub, sort], () => {
  navigateTo({
    path: `/category/${slug.value}`,
    query: { ...(sub.value ? { sub: sub.value } : {}), ...(sort.value !== 'featured' ? { sort: sort.value } : {}) },
    replace: true,
  })
})
</script>

<template>
  <div class="shell py-4">
    <Breadcrumbs class="mb-3" :items="[{ label: 'Home', to: '/' }, { label: 'Categories', to: '/brands' }, { label: cat?.name || '' }]" />

    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="sec-title text-[38px]">{{ cat?.icon }} {{ cat?.name }}</h1>
        <p class="mt-0.5 text-[13.5px] text-muted">{{ cat?.blurb }} · {{ results.length }} items</p>
      </div>
      <select v-model="sort" class="field w-auto !py-2">
        <option value="featured">Sort: Featured</option>
        <option value="price-asc">Price: Low → High</option>
        <option value="price-desc">Price: High → Low</option>
        <option value="rating">Top rated</option>
        <option value="reviews">Most reviewed</option>
      </select>
    </div>

    <div class="grid gap-5 lg:grid-cols-[240px_1fr]">
      <!-- Sidebar -->
      <aside class="space-y-4 lg:sticky lg:top-40 lg:self-start">
        <div class="card">
          <div class="card-head">Category</div>
          <div class="p-2">
            <button class="block w-full rounded px-3 py-2 text-left text-sm hover:bg-canvas" :class="!sub && 'font-bold text-brand'" @click="sub = ''">
              All {{ cat?.name }}
            </button>
            <button
              v-for="s in cat?.subs"
              :key="s"
              class="block w-full rounded px-3 py-2 text-left text-sm hover:bg-canvas"
              :class="sub === s && 'font-bold text-brand'"
              @click="sub = s"
            >{{ s }}</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">Max price</div>
          <div class="p-4">
            <input v-model.number="maxPrice" type="range" min="0" :max="priceCeil" step="10" class="w-full accent-[#111318]" />
            <div class="mt-1 text-xs text-muted">Up to <b class="text-ink">{{ money(maxPrice) }}</b></div>
          </div>
        </div>

        <button class="btn-outline btn-block" @click="resetFilters">Reset filters</button>
      </aside>

      <!-- Grid -->
      <section>
        <div v-if="results.length" class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <ProductCard v-for="p in results" :key="p.id" :product="p" />
        </div>
        <EmptyState v-else icon="🔍" title="No products match" hint="Try widening your price or clearing a filter.">
          <button class="btn-primary" @click="resetFilters">Clear filters</button>
        </EmptyState>
      </section>
    </div>
  </div>
</template>
