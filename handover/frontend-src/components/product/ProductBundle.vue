<script setup lang="ts">
import type { Product } from '~/data/products'

const props = defineProps<{ product: Product; related: Product[] }>()
const cart = useCart()
const { show } = useToast()

// pick up to 3 add-ons
const items = computed(() => props.related.slice(0, 3))
const checked = reactive<Record<string, boolean>>({})
items.value.forEach((p) => (checked[p.id] = true))

const total = computed(() => props.product.price + items.value.filter((p) => checked[p.id]).reduce((s, p) => s + p.price, 0))
const count = computed(() => 1 + items.value.filter((p) => checked[p.id]).length)

const addAll = () => {
  cart.add(props.product, 1)
  items.value.forEach((p) => checked[p.id] && cart.add(p, 1))
  cart.toggle(true)
  show(`Added ${count.value} items to cart`)
}
</script>

<template>
  <div class="card">
    <div class="card-head">Frequently bought together</div>
    <div class="flex flex-wrap items-center gap-3 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <!-- main product, locked -->
        <div class="w-[150px] rounded-lg border border-line p-2.5">
          <ProductImage :product="product" :w="200" :h="200" class="h-[70px] w-full rounded" />
          <p class="mt-1.5 line-clamp-2 text-[12.5px] font-semibold leading-tight">{{ product.name }}</p>
          <div class="text-[13px] font-bold">{{ money(product.price) }}</div>
        </div>
        <span class="pl-2 text-2xl font-bold text-muted">+</span>
        <!-- add-ons -->
        <label v-for="p in items" :key="p.id" class="relative w-[150px] cursor-pointer rounded-lg border border-line p-2.5" :class="!checked[p.id] && 'opacity-50'">
          <input v-model="checked[p.id]" type="checkbox" class="absolute right-2 top-2 h-4 w-4 accent-[#111318]" />
          <NuxtLink :to="`/product/${p.id}`" @click.stop>
            <ProductImage :product="p" :w="200" :h="200" class="h-[70px] w-full rounded" />
          </NuxtLink>
          <p class="mt-1.5 line-clamp-2 text-[12.5px] font-semibold leading-tight">{{ p.name }}</p>
          <div class="text-[13px] font-bold">{{ money(p.price) }}</div>
        </label>
      </div>

      <div class="ml-auto text-right">
        <div class="text-xs text-muted">{{ count }} items · total</div>
        <div class="font-display text-[34px] font-extrabold leading-tight">{{ money(total) }}</div>
        <button class="btn-primary mt-1" @click="addAll">Add selected to cart</button>
      </div>
    </div>
  </div>
</template>
