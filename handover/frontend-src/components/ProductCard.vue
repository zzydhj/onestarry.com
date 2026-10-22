<script setup lang="ts">
import type { Product } from '~/data/products'
import { productGallery } from '~/utils/productImage'

const props = defineProps<{ product: Product }>()
const range = computed(() => props.product.priceRange)
const hasRange = computed(() => !!range.value && range.value[1] > range.value[0])
const rangeText = computed(() => (range.value ? `${money(range.value[0])} \u2013 ${money(range.value[1])}` : ''))

// hover-scrub: dragging the pointer left→right across the image flips through the product's hero shots
const shots = computed(() => productGallery(props.product, 6, 480))
const hoverIdx = ref(0)
const shownSrc = computed(() => shots.value[hoverIdx.value] || shots.value[0])
function scrub(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (e.clientX - r.left) / r.width
  hoverIdx.value = Math.min(shots.value.length - 1, Math.max(0, Math.floor(ratio * shots.value.length)))
}
function resetScrub() {
  hoverIdx.value = 0
}
</script>

<template>
  <div class="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-white transition hover:shadow-card">
    <!-- badge -->
    <span
      v-if="product.badge"
      class="absolute left-2.5 top-2.5 z-10 rounded px-2 py-0.5 text-[11px] font-extrabold"
      :class="badgeClass[product.badge]"
    >{{ badgeLabel[product.badge] }}</span>

    <!-- image (square) — hover + move left/right to scrub through the hero shots -->
    <NuxtLink :to="`/product/${product.id}`" class="relative block aspect-square" @mousemove="scrub" @mouseleave="resetScrub">
      <ProductImage
        :product="product"
        :src="shownSrc"
        :w="480"
        :h="480"
        class="h-full w-full"
        glyph-class="text-5xl"
      />
      <span
        v-if="product.compareAt && !hasRange"
        class="absolute right-2.5 top-2.5 rounded bg-danger px-1.5 py-0.5 text-[11px] font-extrabold text-white"
      >-{{ discountPct(product.price, product.compareAt) }}%</span>
    </NuxtLink>

    <!-- body -->
    <div class="flex flex-1 flex-col gap-1 p-3">
      <NuxtLink :to="`/product/${product.id}`" class="block truncate text-sm font-semibold leading-snug hover:text-brand">
        {{ product.name }}
      </NuxtLink>
      <RatingStars :rating="product.rating" :reviews="product.reviews" />

      <div class="mt-auto flex items-end gap-1.5 pt-2">
        <span v-if="hasRange" class="font-display text-[22px] font-extrabold leading-none">{{ rangeText }}</span>
        <template v-else>
          <span class="font-display text-[22px] font-extrabold leading-none">{{ money(product.price) }}</span>
          <span v-if="product.compareAt" class="leading-none text-xs text-muted line-through">{{ money(product.compareAt) }}</span>
        </template>
      </div>
    </div>
  </div>
</template>
