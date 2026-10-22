<script setup lang="ts">
import type { Product } from '~/data/products'
import type { Detail } from '~/data/productDetails'

defineProps<{ product: Product; detail: Detail }>()
</script>

<template>
  <div class="grid gap-6 md:grid-cols-[240px_1fr]">
    <!-- summary -->
    <div class="h-fit rounded-lg bg-[#FAFAFB] p-4 text-center">
      <div class="font-display text-[56px] font-extrabold leading-none">{{ product.rating.toFixed(1) }}</div>
      <div class="stars text-lg">{{ starString(product.rating) }}</div>
      <div class="mt-1 text-xs text-muted">{{ compact(product.reviews) }} verified buyers</div>
      <div class="mt-3 space-y-1.5">
        <div v-for="b in detail.breakdown" :key="b[0]" class="flex items-center gap-2 text-[11px] text-muted">
          <span class="w-6 shrink-0 text-right">{{ b[0] }}★</span>
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF0F3]"><span class="block h-full rounded-full bg-[#F5A524]" :style="{ width: b[1] + '%' }" /></span>
          <span class="w-8 shrink-0">{{ b[1] }}%</span>
        </div>
      </div>
    </div>

    <!-- cards -->
    <div class="divide-y divide-line">
      <div v-for="r in detail.reviews" :key="r.who" class="py-3.5 first:pt-0">
        <div class="flex flex-wrap items-center gap-2">
          <span class="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-bold text-brand">{{ r.who[0] }}</span>
          <b class="text-sm">{{ r.who }}</b>
          <span class="stars text-xs">{{ starString(r.stars) }}</span>
          <span v-if="r.verified" class="text-[11px] font-bold text-ok">✔ Verified purchase</span>
        </div>
        <p class="mt-1.5 text-sm font-semibold">{{ r.title }}</p>
        <p class="mt-0.5 text-[13px] leading-relaxed text-[#3a4048]">{{ r.text }}</p>
        <div class="mt-1 text-xs text-muted">{{ r.when }}</div>
      </div>
    </div>
  </div>
</template>
