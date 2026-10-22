<script setup lang="ts">
import type { Product } from '~/data/products'
import { SKU_LAYOUT } from '~/config/sku'

const props = defineProps<{ product: Product }>()
const sku = useSku(props.product)
const { show } = useToast()

const manyColors = computed(() => (sku.colorAxis.value?.options.length ?? 0) > SKU_LAYOUT.COLOR_SEARCH)

// cursor-following tooltip that names the SKU under the pointer (real-time, no delay)
const tip = reactive({ show: false, x: 0, y: 0, title: '', sub: '' })
function skuMetaForColor(value: string) {
  const g = sku.colorAxis.value
  if (!g) return undefined
  return sku.model.skus.find((s) =>
    sku.model.axes.every((a) => (a.name === g.name ? s.combo[a.name] === value : s.combo[a.name] === sku.selection.value[a.name])),
  )
}
function tipShow(e: MouseEvent, value: string) {
  const meta = skuMetaForColor(value)
  const parts: string[] = []
  if (meta?.code) parts.push(meta.code)
  if (meta?.price != null) parts.push(money(meta.price))
  if (meta && meta.stock === 0) parts.push('Sold out')
  tip.title = value
  tip.sub = parts.join(' · ')
  tip.show = true
  tipMove(e)
}
function tipMove(e: MouseEvent) {
  tip.x = e.clientX + 14
  tip.y = e.clientY + 16
}
function tipHide() {
  tip.show = false
}
</script>

<template>
  <div v-if="sku.hasVariants.value" class="space-y-4">
    <!-- colour swatches (real SKU photos, they change with the selected size) -->
    <div v-if="sku.colorAxis.value">
      <div class="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted">
        <span>
          {{ sku.colorAxis.value.name }}:
          <b class="text-ink">{{ sku.selection.value[sku.colorAxis.value.name] }}</b>
          <span class="ml-1 text-muted">({{ sku.colorAxis.value.options.length }})</span>
        </span>
      </div>

      <!-- colour swatch grid; scrolls only when there are many (no search box) -->
      <div
        class="grid gap-1.5"
        :class="[
          'grid-cols-[repeat(auto-fill,minmax(44px,1fr))]',
          manyColors ? 'max-h-[216px] overflow-y-auto pr-1 [scrollbar-width:thin]' : '',
        ]"
      >
        <button
          v-for="o in sku.colorAxis.value.options"
          :key="o.value"
          class="relative aspect-square overflow-hidden rounded-md border-2 transition"
          :class="
            sku.selection.value[sku.colorAxis.value!.name] === o.value
              ? 'border-ink ring-2 ring-brand'
              : 'border-line hover:border-ink'
          "
          :disabled="sku.optionStock(sku.colorAxis.value, o.value) === 0"
          @mouseenter="tipShow($event, o.value)"
          @mousemove="tipMove"
          @mouseleave="tipHide"
          @click="sku.pick(sku.colorAxis.value!, o.value)"
        >
          <img :src="sku.imageForColor(o.value)" :alt="o.value" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
          <span v-if="sku.optionStock(sku.colorAxis.value, o.value) === 0" class="absolute inset-0 bg-white/55" />
          <span
            v-if="sku.multiPick.value && sku.stagedTotal(sku.colorAxis.value!, o.value) > 0"
            class="absolute right-1 top-1 h-3 w-3 rounded-full bg-brand ring-2 ring-ink"
          />
        </button>
      </div>
    </div>

    <!-- other axes (size / pack …) as chips -->
    <div v-for="axis in sku.otherAxes.value" :key="axis.name">
      <div class="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted">
        <span>{{ axis.name }}: <b class="text-ink">{{ sku.selection.value[axis.name] }}</b></span>
        <button class="text-[#1856C9] hover:underline" @click="show('Size guide coming soon', 'info')">Size guide</button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="o in axis.options"
          :key="o.value"
          class="chip relative min-w-[44px] justify-center"
          :class="[
            sku.selection.value[axis.name] === o.value && 'on',
            sku.optionStock(axis, o.value) === 0 && 'cursor-not-allowed opacity-40 line-through',
          ]"
          :disabled="sku.optionStock(axis, o.value) === 0"
          @click="sku.pick(axis, o.value)"
        >
          {{ o.value }}
          <span
            v-if="sku.multiPick.value && sku.stagedAtSelection(axis, o.value) > 0"
            class="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-[10px] font-bold text-brand"
          >{{ sku.stagedAtSelection(axis, o.value) }}</span>
        </button>
      </div>
    </div>

    <!-- resolved SKU -->
    <div v-if="sku.selectedSku.value" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
      <span class="text-muted">SKU: <b class="font-mono text-ink">{{ sku.selectedSku.value.code }}</b></span>
      <span v-if="sku.selectedSku.value.stock > 0" class="font-semibold text-ok">● {{ sku.selectedSku.value.stock }} in stock</span>
      <span v-else class="font-semibold text-danger">● Sold out in this combination</span>
    </div>

    <!-- cursor-following SKU tooltip -->
    <Teleport to="body">
      <div
        v-if="tip.show"
        class="pointer-events-none fixed z-[120] rounded-md bg-ink px-2.5 py-1.5 text-white shadow-pop"
        :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
      >
        <div class="text-[12px] font-bold leading-tight">{{ tip.title }}</div>
        <div v-if="tip.sub" class="mt-0.5 text-[11px] font-medium text-[#c7ccd4]">{{ tip.sub }}</div>
      </div>
    </Teleport>
  </div>
</template>
