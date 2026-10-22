<script setup lang="ts">
import { productById } from '~/data/products'

const { items, subtotal, count, clear } = useCart()
const { show } = useToast()

const FREE_SHIP = 75
const SHIP_COST = 6
const shipping = computed(() => (subtotal.value >= FREE_SHIP || subtotal.value === 0 ? 0 : SHIP_COST))
const tax = computed(() => subtotal.value * 0.08)
const total = computed(() => subtotal.value + shipping.value + tax.value)

const step = ref(1)
const form = reactive({
  email: '',
  first: '',
  last: '',
  addr: '',
  city: '',
  zip: '',
  country: 'United States',
  card: '',
  exp: '',
  cvc: '',
})

const placeOrder = () => {
  const order = 'OS-' + Math.floor(100000 + Math.random() * 900000)
  clear()
  show(`Order ${order} placed — thank you! 🎉`)
  navigateTo('/account')
}
</script>

<template>
  <div class="shell py-4">
    <div class="mb-4 flex items-center gap-3">
      <h1 class="sec-title text-[36px]">Checkout</h1>
      <div class="ml-auto flex items-center gap-2 text-sm">
        <span v-for="s in 3" :key="s" class="flex items-center gap-2">
          <span class="grid h-7 w-7 place-items-center rounded-full text-xs font-bold" :class="step >= s ? 'bg-brand text-ink' : 'bg-canvas text-muted'">{{ s }}</span>
          <span v-if="s < 3" class="h-px w-6 bg-line" />
        </span>
      </div>
    </div>

    <div v-if="!items.length" class="card p-8 text-center">
      <p class="font-display text-2xl uppercase">Nothing to check out</p>
      <p class="mt-1 text-sm text-muted">Your cart is empty.</p>
      <NuxtLink to="/" class="btn-primary mt-4">Start shopping</NuxtLink>
    </div>

    <div v-else class="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <div class="card">
          <div class="card-head">1 · Contact & shipping</div>
          <div class="grid gap-3 p-4 sm:grid-cols-2">
            <div class="sm:col-span-2"><label class="field-label">Email</label><input v-model="form.email" type="email" class="field" placeholder="you@email.com" /></div>
            <div><label class="field-label">First name</label><input v-model="form.first" class="field" /></div>
            <div><label class="field-label">Last name</label><input v-model="form.last" class="field" /></div>
            <div class="sm:col-span-2"><label class="field-label">Address</label><input v-model="form.addr" class="field" /></div>
            <div><label class="field-label">City</label><input v-model="form.city" class="field" /></div>
            <div><label class="field-label">ZIP / Postcode</label><input v-model="form.zip" class="field" /></div>
            <div class="sm:col-span-2"><label class="field-label">Country</label><input v-model="form.country" class="field" /></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">2 · Payment</div>
          <div class="grid gap-3 p-4 sm:grid-cols-3">
            <div class="sm:col-span-3"><label class="field-label">Card number</label><input v-model="form.card" inputmode="numeric" class="field" placeholder="4242 4242 4242 4242" /></div>
            <div class="sm:col-span-2"><label class="field-label">Expiry</label><input v-model="form.exp" class="field" placeholder="MM / YY" /></div>
            <div><label class="field-label">CVC</label><input v-model="form.cvc" class="field" placeholder="123" /></div>
          </div>
        </div>
      </div>

      <aside class="lg:sticky lg:top-40 lg:self-start">
        <div class="card">
          <div class="card-head">Order summary · {{ count }}</div>
          <div class="max-h-52 overflow-auto p-4">
            <div v-for="i in items" :key="i.key" class="flex items-center gap-3 py-1.5">
              <span class="shrink-0"><ProductImage :product="productById(i.id) ?? null" :src="i.image" :w="80" :h="80" class="h-10 w-10 rounded" glyph-class="text-lg" /></span>
              <span class="min-w-0 flex-1 truncate text-sm">{{ i.name }}<span v-if="i.variant" class="text-muted"> · {{ i.variant }}</span> <span class="text-muted">×{{ i.qty }}</span></span>
              <span class="text-sm font-semibold">{{ money(i.price * i.qty) }}</span>
            </div>
          </div>
          <div class="space-y-1.5 border-t border-line p-4 text-sm">
            <div class="flex justify-between"><span class="text-muted">Subtotal</span><b>{{ money(subtotal) }}</b></div>
            <div class="flex justify-between"><span class="text-muted">Shipping</span><b>{{ shipping === 0 ? 'FREE' : money(shipping) }}</b></div>
            <div class="flex justify-between"><span class="text-muted">Tax (8%)</span><b>{{ money(tax) }}</b></div>
            <div class="mt-1 flex items-end justify-between border-t border-line pt-2"><span class="font-bold">Total</span><span class="font-display text-3xl font-extrabold">{{ money(total) }}</span></div>
          </div>
          <div class="border-t border-line p-4">
            <button class="btn-primary btn-block" @click="placeOrder">🔒 Place order · {{ money(total) }}</button>
            <p class="mt-2 text-center text-xs text-muted">This is a demo — no real payment is taken.</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
