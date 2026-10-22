<script setup lang="ts">
import type { CartItem } from '~/composables/useCart'
import { productById } from '~/data/products'

const { items, open, inc, dec, remove, subtotal, count, toggle } = useCart()
const { show } = useToast()

const FREE_SHIP = 75
const remaining = computed(() => Math.max(0, FREE_SHIP - subtotal.value))

const checkout = () => {
  toggle(false)
  navigateTo('/checkout')
}
const removeItem = (i: CartItem) => {
  remove(i.key)
  show(`Removed “${i.name}”`, 'info')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[70] bg-[rgba(10,12,16,.55)]" @click="toggle(false)" />
    </Transition>

    <Transition name="slide">
      <aside
        v-if="open"
        class="fixed right-0 top-0 z-[80] flex h-full w-[430px] max-w-full flex-col bg-white shadow-[-10px_0_40px_rgba(0,0,0,.25)]"
      >
        <div class="flex items-center justify-between bg-ink px-4 py-4 text-white">
          <h3 class="font-display text-2xl uppercase">Your Cart · {{ count }}</h3>
          <button class="text-2xl leading-none text-white hover:text-brand" @click="toggle(false)">×</button>
        </div>

        <div class="flex-1 overflow-auto px-4">
          <div v-if="!items.length" class="py-16 text-center">
            <div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-canvas text-3xl">🛒</div>
            <p class="font-display text-xl uppercase">Your cart is empty</p>
            <p class="mt-1 text-sm text-muted">Add products to see them here.</p>
            <button class="btn-primary mt-4" @click="toggle(false)">Continue shopping</button>
          </div>

          <div
            v-for="i in items"
            :key="i.key"
            class="flex items-center gap-3 border-b border-line py-3.5"
          >
            <NuxtLink :to="`/product/${i.id}`" class="shrink-0" @click="toggle(false)">
              <ProductImage :product="productById(i.id) ?? null" :src="i.image" :w="112" :h="112" class="h-14 w-14 rounded" glyph-class="text-2xl" />
            </NuxtLink>
            <div class="min-w-0 flex-1">
              <NuxtLink :to="`/product/${i.id}`" class="line-clamp-1 text-sm font-semibold hover:text-brand" @click="toggle(false)">
                {{ i.name }}
              </NuxtLink>
              <div v-if="i.variant" class="mt-0.5 line-clamp-1 text-xs text-muted">{{ i.variant }}</div>
              <div class="mt-0.5 text-xs text-muted">{{ money(i.price) }} each</div>
            </div>
            <div class="flex items-center overflow-hidden rounded border border-[#c9ced6]">
              <button class="h-8 w-8 bg-canvas font-bold hover:bg-brand" @click="dec(i.key)">−</button>
              <span class="w-9 text-center text-sm font-semibold">{{ i.qty }}</span>
              <button class="h-8 w-8 bg-canvas font-bold hover:bg-brand" @click="inc(i.key)">+</button>
            </div>
            <div class="w-16 text-right text-sm font-bold">{{ money(i.price * i.qty) }}</div>
            <button class="text-lg text-muted hover:text-danger" @click="removeItem(i)">🗑</button>
          </div>
        </div>

        <div v-if="items.length" class="border-t-2 border-ink bg-[#FAFAFB] p-4">
          <p v-if="remaining > 0" class="mb-2 rounded bg-brand-soft px-3 py-1.5 text-xs font-semibold text-[#6b5600]">
            Add {{ money(remaining) }} more for <b>FREE shipping</b> 🚚
          </p>
          <p v-else class="mb-2 rounded bg-[#E8F6EE] px-3 py-1.5 text-xs font-bold text-ok">
            🎉 You qualify for FREE shipping!
          </p>
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted">Subtotal</span>
            <span class="font-display text-2xl font-extrabold">{{ money(subtotal) }}</span>
          </div>
          <button class="btn-primary btn-block mt-2.5" @click="checkout">Proceed to Checkout →</button>
          <NuxtLink to="/cart" class="btn-outline btn-block mt-2" @click="toggle(false)">View full cart</NuxtLink>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.28s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(105%);
}
</style>
