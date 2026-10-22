<script setup lang="ts">
import { products } from '~/data/products'

useSeoMeta({ title: "Today's Deals — Onestarry" })

const deals = computed(() => products.filter((p) => p.compareAt).sort((a, b) => discountPct(b.price, b.compareAt) - discountPct(a.price, a.compareAt)))
</script>

<template>
  <div class="shell py-4">
    <div class="mb-4 rounded-[10px] bg-gradient-to-br from-ink to-[#4a3b00] p-7 text-white">
      <span class="inline-block rounded bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase text-ink">Limited time</span>
      <h1 class="mt-2 font-display text-4xl uppercase leading-none sm:text-5xl">Today's Deals</h1>
      <p class="mt-2 max-w-[560px] text-[#d7dbe2]">Biggest discounts across every department — refreshed daily. While stock lasts.</p>
    </div>

    <div class="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
      <ProductCard v-for="p in deals" :key="p.id" :product="p" />
    </div>
  </div>
</template>
