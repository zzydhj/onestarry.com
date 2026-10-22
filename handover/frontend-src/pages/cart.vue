<script setup lang="ts">
import { productById } from '~/data/products'

const { items, inc, dec, remove, clear, subtotal, count } = useCart()
const { show } = useToast()

const FREE_SHIP = 75
const SHIP_COST = 6
const shipping = computed(() => (subtotal.value === 0 ? 0 : subtotal.value >= FREE_SHIP ? 0 : SHIP_COST))
const total = computed(() => subtotal.value + shipping.value)

const promo = ref('')
const discount = computed(() => (/^ONE10$/i.test(promo.value.trim()) ? subtotal.value * 0.1 : 0))
const grandTotal = computed(() => Math.max(0, total.value - discount.value))

const applyPromo = () => {
  if (discount.value > 0) show('Promo ONE10 applied — 10% off 🎉')
  else show('Invalid promo code', 'danger')
}
</script>

<template>
  <div class="shell py-4">
    <h1 class="sec-title mb-1 text-[36px]">Your Cart</h1>
    <p class="mb-4 text-sm text-muted">{{ count }} item{{ count === 1 ? '' : 's' }}</p>

    <div v-if="items.length" class="grid gap-5 lg:grid-cols-[1fr_340px]">
      <!-- items -->
      <div class="card">
        <div class="card-head">
          <span>Product</span>
          <button class="text-xs font-bold text-danger hover:underline" @click="clear(); show('Cart cleared', 'info')">Clear cart</button>
        </div>
        <div>
          <div v-for="i in items" :key="i.key" class="flex items-center gap-4 border-b border-line p-4 last:border-0">
            <NuxtLink :to="`/product/${i.id}`" class="shrink-0">
              <ProductImage :product="productById(i.id) ?? null" :src="i.image" :w="160" :h="160" class="h-20 w-20 rounded" glyph-class="text-4xl" />
            </NuxtLink>
            <div class="min-w-0 flex-1">
              <NuxtLink :to="`/product/${i.id}`" class="text-sm font-bold hover:text-brand">{{ i.name }}</NuxtLink>
              <div v-if="i.variant" class="text-xs text-muted">{{ i.variant }}</div>
              <div class="text-xs text-muted">{{ money(i.price) }} each</div>
              <button class="mt-1 text-xs font-semibold text-danger hover:underline" @click="remove(i.key)">Remove</button>
            </div>
            <div class="flex items-center overflow-hidden rounded-md border border-[#c9ced6]">
              <button class="h-9 w-9 bg-canvas font-bold hover:bg-brand" @click="dec(i.key)">−</button>
              <span class="w-10 text-center text-sm font-semibold">{{ i.qty }}</span>
              <button class="h-9 w-9 bg-canvas font-bold hover:bg-brand" @click="inc(i.key)">+</button>
            </div>
            <div class="w-24 text-right font-display text-xl font-extrabold">{{ money(i.price * i.qty) }}</div>
          </div>
        </div>
      </div>

      <!-- summary -->
      <aside class="lg:sticky lg:top-40 lg:self-start">
        <div class="card">
          <div class="card-head">Order summary</div>
          <div class="space-y-1.5 p-4 text-sm">
            <div class="flex justify-between"><span class="text-muted">Subtotal</span><b>{{ money(subtotal) }}</b></div>
            <div class="flex justify-between"><span class="text-muted">Shipping</span><b>{{ shipping === 0 ? 'FREE' : money(shipping) }}</b></div>
            <div v-if="discount > 0" class="flex justify-between text-ok"><span>Promo (ONE10)</span><b>−{{ money(discount) }}</b></div>
            <div class="mt-2 flex items-end justify-between border-t border-line pt-2">
              <span class="font-bold">Total</span><span class="font-display text-3xl font-extrabold">{{ money(grandTotal) }}</span>
            </div>
          </div>
          <div class="border-t border-line p-4">
            <div class="mb-3 flex gap-2">
              <input v-model="promo" class="field !py-2" placeholder="Promo code (try ONE10)" />
              <button class="btn-outline shrink-0 !py-2" @click="applyPromo">Apply</button>
            </div>
            <NuxtLink to="/checkout" class="btn-primary btn-block">Checkout Securely →</NuxtLink>
            <NuxtLink to="/" class="btn-ghost btn-block mt-1">Continue shopping</NuxtLink>
            <p class="mt-3 text-center text-xs text-muted">🔒 Encrypted payment · Buyer protection</p>
          </div>
        </div>
      </aside>
    </div>

    <EmptyState v-else icon="🛒" title="Your cart is empty" hint="Browse the marketplace and add something you love.">
      <NuxtLink to="/" class="btn-primary">Start shopping</NuxtLink>
    </EmptyState>
  </div>
</template>
