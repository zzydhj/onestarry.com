<script setup lang="ts">
import { productImage, productImageFallback } from '~/utils/productImage'

const props = withDefaults(
  defineProps<{
    product: { id: string; category: string; name?: string; glyph?: string } | null
    src?: string // explicit image url override (e.g. a specific SKU photo in the cart)
    w?: number
    h?: number
    imgClass?: string
    glyphClass?: string
    eager?: boolean
  }>(),
  { w: 640, h: 640, eager: false },
)

const failedPrimary = ref(false)
const failedFallback = ref(false)

// reset whenever the image source changes (SPA navigation / different cart line)
watch(
  () => [props.product?.id, props.src],
  () => {
    failedPrimary.value = false
    failedFallback.value = false
  },
)

const primary = computed(() => props.src || (props.product ? productImage(props.product, { w: props.w, h: props.h }) : ''))
const fallback = computed(() => (props.product ? productImageFallback(props.product, { w: props.w, h: props.h }) : ''))
</script>

<template>
  <div class="relative overflow-hidden bg-[#EEF0F3]">
    <!-- emoji sits behind and shows only if both image layers fail -->
    <span class="absolute inset-0 grid place-items-center text-[#9aa1ad]" :class="glyphClass || 'text-4xl'">
      {{ product?.glyph || '🛍️' }}
    </span>

    <!-- last-resort real photo (Picsum) -->
    <img
      v-if="fallback && failedPrimary && !failedFallback"
      :src="fallback"
      :alt="product?.name || ''"
      decoding="async"
      class="absolute inset-0 h-full w-full object-cover"
      :class="imgClass"
      @error="failedFallback = true"
    />

    <!-- primary real photo (topical Unsplash) -->
    <img
      v-if="primary && !failedPrimary"
      :src="primary"
      :alt="product?.name || ''"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      class="absolute inset-0 h-full w-full object-cover"
      :class="imgClass"
      @error="failedPrimary = true"
    />
  </div>
</template>
