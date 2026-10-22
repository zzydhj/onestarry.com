<script setup lang="ts">
const props = defineProps<{ rating: number; reviews?: number }>()
const label = computed(() => props.rating.toFixed(1))
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span class="stars text-[13px] leading-none">{{ starString(rating) }}</span>
    <span class="text-xs font-semibold text-ink">{{ label }}</span>
    <span v-if="reviews != null" class="text-xs text-muted">({{ compact(reviews) }})</span>
  </span>
</template>
