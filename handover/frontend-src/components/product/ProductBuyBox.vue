<script setup lang="ts">
import type { Product } from '~/data/products'
import type { Detail } from '~/data/productDetails'

const props = defineProps<{ product: Product; detail: Detail }>()
const cart = useCart()
const { show } = useToast()
const sku = useSku(props.product)

const multi = computed(() => sku.multiPick.value)
const localQty = ref(Math.max(1, props.detail.auto?.moq ?? 1))
const currentKey = computed(() => sku.selectedSku.value?.key ?? '')
const available = computed(() => (sku.hasVariants.value ? sku.selectedSku.value?.stock ?? 0 : props.product.stock))
const out = computed(() => available.value <= 0)
// per-SKU price when the model provides one (imported products), else the catalog price
const basePrice = computed(() => sku.selectedSku.value?.price ?? props.product.price)

// stepper value = staged qty for the current combo (multi-pick) or the single qty
const qty = computed({
  get: () => (multi.value ? sku.draftQty(currentKey.value) : localQty.value),
  set: (v: number) => {
    const n = Number(v) || 0
    if (multi.value) sku.setDraftQty(currentKey.value, Math.min(Math.max(0, n), available.value))
    else localQty.value = Math.min(Math.max(props.detail.auto?.moq ?? 1, n || 1), Math.max(1, available.value))
  },
})
const subtotal = computed(() => (multi.value ? sku.stagedSubtotal.value : basePrice.value * localQty.value))
const staged = computed(() => sku.stagedCount.value)
const canAdd = computed(() => (multi.value ? staged.value > 0 : !out.value))

const step = (d: number) => (qty.value = qty.value + d)

const commitStaged = () => {
  sku.stagedLines.value.forEach((l) => cart.add(props.product, l.qty, l.sku))
  sku.clearDraft()
}
const add = () => {
  if (multi.value) {
    const n = staged.value
    if (!n) return
    commitStaged()
    show(`Added ${n} selected item(s) to cart`)
  } else {
    cart.add(props.product, localQty.value, sku.selectedSku.value)
    show(`Added ${localQty.value} × “${props.product.name}”`)
  }
  cart.toggle(true)
}
const buyNow = () => {
  if (multi.value) {
    if (!staged.value) return
    commitStaged()
  } else {
    cart.add(props.product, localQty.value, sku.selectedSku.value)
  }
  navigateTo('/checkout')
}
const save = () => show('♥ Saved to your wishlist')

// ---- delivery estimate ----
const SHIP: Record<string, [number, string]> = {
  'united states': [6.9, '3–5'], germany: [5.9, '4–6'], 'united kingdom': [6.5, '4–6'],
  france: [6.9, '5–7'], australia: [8.9, '6–9'], brazil: [11.9, '8–12'], uae: [7.9, '5–8'],
}
const country = ref('')
const ship = ref<{ cost: number; days: string; free: boolean } | null>(null)
function calcShip() {
  const c = country.value.trim().toLowerCase()
  const s = SHIP[c]
  ship.value = s
    ? { cost: subtotal.value >= 75 ? 0 : s[0], days: s[1], free: subtotal.value >= 75 }
    : null
  if (!s) show('Destination not in demo list — try US / Germany / UK', 'danger')
}
</script>

<template>
  <div class="card">
    <div class="p-4">
      <!-- variant picker (colour SKU images + size chips + resolved SKU) -->
      <SkuPicker :product="product" class="mb-3" />

      <!-- price -->
      <div class="flex items-end gap-2">
        <span class="font-display text-[44px] font-extrabold leading-none">{{ money(basePrice) }}</span>
        <span class="mb-1 text-sm text-muted">/ pc</span>
        <span v-if="product.compareAt && !product.priceRange" class="mb-1 text-sm text-muted line-through">{{ money(product.compareAt) }}</span>
        <span v-if="product.compareAt && !product.priceRange" class="mb-1 badge bg-danger text-white">-{{ discountPct(product.price, product.compareAt) }}%</span>
      </div>

      <!-- qty + totals -->
      <div class="mt-4 flex items-center gap-3">
        <div class="flex items-center overflow-hidden rounded-md border border-[#c9ced6]">
          <button class="h-11 w-9 bg-canvas text-lg font-bold hover:bg-brand" @click="step(-1)">−</button>
          <input v-model.number="qty" type="number" :min="multi ? 0 : 1" class="h-11 w-14 border-0 text-center font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
          <button class="h-11 w-9 bg-canvas text-lg font-bold hover:bg-brand" @click="step(1)">+</button>
        </div>
        <span v-if="detail.auto?.moq" class="text-xs text-muted">MOQ {{ detail.auto.moq }}</span>
        <span class="ml-auto text-right text-sm text-muted">{{ multi ? 'Selected' : 'Subtotal' }} <b class="block font-display text-2xl text-ink">{{ money(subtotal) }}</b></span>
      </div>
      <p v-if="multi" class="mt-1.5 text-[11.5px] leading-snug text-muted">Pick a colour, then set a quantity per size — the size chips show what you've staged for it. A <span class="inline-block h-2 w-2 rounded-full bg-brand ring-1 ring-ink align-middle"></span> dot marks colours you've already picked.<b v-if="staged" class="ml-1 text-ink">{{ staged }} staged.</b></p>

      <!-- buttons -->
      <button class="btn-primary btn-block mt-3" :disabled="!canAdd" @click="add">🛒 Add to Cart<span v-if="multi && staged"> · {{ staged }}</span></button>
      <button class="btn-dark btn-block mt-2" :disabled="!canAdd" @click="buyNow">Buy Now</button>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <button class="btn-outline btn-sm" @click="save">♡ Save</button>
        <button class="btn-outline btn-sm" @click="show('Request sent — our team replies within 24h', 'info')">💬 Ask a question</button>
      </div>

      <!-- delivery estimate -->
      <div class="mt-3 border-t border-dashed border-line pt-3">
        <div class="mb-1 text-xs font-bold">🚚 Delivery estimate</div>
        <div class="flex gap-2">
          <input v-model="country" class="field !py-2 flex-1" placeholder="Country, e.g. Germany" @keyup.enter="calcShip" />
          <button class="btn-dark !py-2 !px-4 text-xs" @click="calcShip">CALC</button>
        </div>
        <div v-if="ship" class="mt-2 rounded-md border border-[#BFE3CB] bg-[#F0F9F3] px-2.5 py-2 text-[12.5px] leading-relaxed">
          Standard: <b>{{ ship.free ? 'FREE' : money(ship.cost) }}</b> · {{ ship.days }} days<br />
          <span class="text-muted">Express available at checkout.</span>
        </div>
      </div>
    </div>
  </div>
</template>
