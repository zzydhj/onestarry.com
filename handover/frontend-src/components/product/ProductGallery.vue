<script setup lang="ts">
import type { Product } from '~/data/products'
import { productGallery } from '~/utils/productImage'

/**
 * Main product gallery.
 * - Default: a dedicated set of MARKETING hero shots (productGallery, capped).
 * - The gallery follows the SKU image ONLY when the shopper picks a SKU on the
 *   right (selectedSku changes). Clicking / hovering a hero thumbnail previews
 *   that marketing shot and does NOT change the selected SKU.
 */
const props = defineProps<{ product: Product; quality?: { cls: string; label: string } }>()
const sku = useSku(props.product)

const shots = computed(() => productGallery(props.product, 6))
const idx = ref(0)
const followSku = ref(false)
const skuImage = computed(() => (sku.hasVariants.value ? sku.selectedSku.value?.image || '' : ''))
const mainSrc = computed(() => (followSku.value && skuImage.value ? skuImage.value : shots.value[idx.value]))

// a SKU picked on the right → gallery follows that SKU's image
watch(() => sku.selectedSku.value?.key, () => (followSku.value = true))

// previewing a hero shot → detach from the SKU (never changes selection)
function showShot(i: number) {
  idx.value = i
  followSku.value = false
}
</script>

<template>
  <div>
    <!-- main hero: its own rounded-square card -->
    <div class="card overflow-hidden">
      <div class="relative aspect-square bg-[#EEF0F3]">
        <img :key="mainSrc" :src="mainSrc" :alt="product.name" referrerpolicy="no-referrer" class="h-full w-full object-cover" decoding="async" />
        <span v-if="quality" class="absolute left-3 top-3 badge" :class="quality.cls">{{ quality.label }}</span>
      </div>
    </div>

    <!-- thumbnails: separate small rounded squares. 6-col grid so a full set spans edge-to-edge with equal gaps;
         fewer than 6 keep the same 1/6 size and sit left-aligned (never stretched). Click / hover previews a marketing shot only (never changes the SKU). -->
    <div class="mt-3 grid grid-cols-6 gap-1.5">
      <button
        v-for="(s, i) in shots"
        :key="i"
        class="aspect-square overflow-hidden rounded-lg border-2 bg-[#EEF0F3]"
        :class="!followSku && i === idx ? 'border-brand' : 'border-line hover:border-ink'"
        @mouseenter="showShot(i)"
        @click="showShot(i)"
      >
        <img :src="s" :alt="`${product.name} view ${i + 1}`" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
      </button>
    </div>
  </div>
</template>
