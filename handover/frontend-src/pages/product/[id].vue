<script setup lang="ts">
import { productById, productsByCategory } from '~/data/products'
import type { Product } from '~/data/products'
import { categoryBySlug } from '~/data/categories'
import { buildDetail } from '~/data/productDetails'

const route = useRoute()
const { show } = useToast()
const cart = useCart()

const id = computed(() => String(route.params.id))
const product = computed<Product | undefined>(() => productById(id.value))

if (!product.value) {
  throw createError({ statusCode: 404, statusMessage: 'Product not found', title: 'Product not found' })
}

// shared SKU selection (same useState the BuyBox / SkuPicker use) so the mobile bar adds the current combination
const sku = useSku(product.value!)

const detail = computed(() => (product.value ? buildDetail(product.value) : null))
const cat = computed(() => (product.value ? categoryBySlug(product.value.category) : undefined))
const related = computed(() =>
  product.value ? productsByCategory(product.value.category).filter((p) => p.id !== product.value!.id) : [],
)

const QUALITY: Record<string, { cls: string; label: string }> = {
  OE: { cls: 'bg-ink text-brand', label: 'OE GENUINE' },
  OEM: { cls: 'bg-[#DCEBFF] text-[#0E3F96]', label: 'OEM' },
  AF: { cls: 'bg-[#E9EBEF] text-[#434b59]', label: 'AFTERMARKET' },
}
const quality = computed(() => (detail.value?.auto ? QUALITY[detail.value.auto.quality] : undefined))

function copy(t: string) {
  if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {})
  show('Copied: ' + t)
}

// ---- click-to-switch tabs (NOT scroll-driven): default stays on Description ----
const tabs = computed(() => {
  const list: { id: string; label: string }[] = [
    { id: 'desc', label: 'Description' },
    { id: 'specs', label: 'Specifications' },
  ]
  if (detail.value?.auto) list.push({ id: 'fitment', label: 'Fitment' }, { id: 'xref', label: 'Cross-reference' })
  list.push({ id: 'shipping', label: 'Shipping & returns' }, { id: 'reviews', label: `Reviews (${product.value!.reviews})` })
  return list
})
const tab = ref('desc')
const contentEl = ref<HTMLElement | null>(null)
function selectTab(id: string) {
  tab.value = id
  nextTick(() => contentEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const stickyAdd = () => {
  if (!product.value) return
  cart.add(product.value, 1, sku.selectedSku.value)
  cart.toggle(true)
}
</script>

<template>
  <div v-if="product && detail" class="shell py-4">
    <Breadcrumbs
      class="mb-3"
      :items="[
        { label: 'Home', to: '/' },
        { label: cat?.name || '', to: `/category/${cat?.slug}` },
        { label: product.sub, to: `/category/${cat?.slug}?sub=${encodeURIComponent(product.sub)}` },
        { label: product.name },
      ]"
    />

    <!-- outer: LEFT (gallery+info then detail tabs) | RIGHT (checkout, sticky top-to-bottom) -->
    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="min-w-0">
        <!-- TOP: image | middle info (unchanged) -->
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-[400px_minmax(0,1fr)]">
          <ProductGallery :product="product" :quality="quality" />

          <div class="card p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span v-if="quality" class="badge" :class="quality.cls">{{ quality.label }}</span>
              <span v-else-if="product.badge" class="badge" :class="badgeClass[product.badge]">{{ badgeLabel[product.badge] }}</span>
              <span class="text-[11px] font-semibold uppercase tracking-wide text-muted">· {{ product.brand }} · {{ cat?.name }}</span>
            </div>
            <h1 class="mt-2 font-display text-[30px] uppercase leading-tight">{{ product.name }}</h1>
            <button class="mt-1.5 inline-block text-left" @click="selectTab('reviews')">
              <RatingStars :rating="product.rating" :reviews="product.reviews" />
            </button>

            <!-- automotive OE + cross-reference -->
            <template v-if="detail.auto">
              <div class="mt-4">
                <div
                  class="oebig inline-flex cursor-pointer items-center gap-2 rounded-md bg-ink px-3.5 py-2 font-display text-[26px] font-extrabold tracking-wide text-brand"
                  title="Click to copy"
                  @click="copy(detail.auto.oe)"
                >
                  {{ detail.auto.oe }}<small class="font-sans text-[10px] font-medium text-[#9aa1ad]">click to copy</small>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <span class="text-xs text-muted">Cross-ref:</span>
                  <button
                    v-for="a in detail.auto.alt"
                    :key="a"
                    class="rounded border border-[#c9ced6] bg-white px-2 py-0.5 font-display text-[15px] font-bold hover:bg-brand"
                    @click="copy(a)"
                  >{{ a }}</button>
                </div>
              </div>
              <ProductFitment :auto="detail.auto" />
            </template>

            <!-- key facts -->
            <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-y border-line py-3 text-[13px]">
              <dt class="text-muted">Brand</dt><dd class="font-semibold">{{ product.brand }}</dd>
              <dt class="text-muted">Department</dt><dd class="font-semibold">{{ cat?.name }}</dd>
              <dt class="text-muted">Type</dt><dd class="font-semibold">{{ product.sub }}</dd>
              <dt class="text-muted">Arrives</dt><dd class="font-semibold">🚚 {{ detail.eta }}</dd>
              <template v-if="detail.auto">
                <dt class="text-muted">MOQ</dt><dd class="font-semibold">{{ detail.auto.moq }} pcs</dd>
                <dt class="text-muted">Weight / Pkg</dt><dd class="font-semibold">{{ detail.auto.weight }} · {{ detail.auto.pkg }}</dd>
              </template>
              <dt class="text-muted">Availability</dt>
              <dd class="font-semibold" :class="product.stock > 0 ? 'text-ok' : 'text-danger'">
                {{ product.stock > 0 ? `${product.stock} in stock` : 'Out of stock' }}
              </dd>
            </dl>

            <div class="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-3">
              <div class="rounded-md border border-line p-2.5"><b class="block text-[12.5px]">✔ 100% inspected</b><span class="text-muted">Before dispatch</span></div>
              <div class="rounded-md border border-line p-2.5"><b class="block text-[12.5px]">✔ 12-month warranty</b><span class="text-muted">Defects covered</span></div>
              <div class="rounded-md border border-line p-2.5"><b class="block text-[12.5px]">✔ 30-day returns</b><span class="text-muted">Money-back</span></div>
            </div>
          </div>
        </div>

        <!-- BOTTOM: sticky tab bar + click-switched panes (narrowed to leave room for the right column) -->
        <div class="mt-6">
          <!-- sticky tab bar = the rounded top header of the content panel (canvas pt hides content peeking above) -->
          <div class="sticky top-[116px] z-20 bg-canvas pt-4">
            <div class="flex gap-1 overflow-x-auto rounded-t-2xl border border-line bg-white px-2 py-2 [scrollbar-width:none]">
              <button
                v-for="s in tabs"
                :key="s.id"
                class="whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-bold transition"
                :class="tab === s.id ? 'bg-ink text-brand' : 'text-muted hover:bg-canvas hover:text-ink'"
                @click="selectTab(s.id)"
              >{{ s.label }}</button>
            </div>
          </div>

          <div ref="contentEl" class="scroll-mt-[190px]">
          <!-- Description -->
          <section v-show="tab === 'desc'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <h4 class="mb-2 text-xs uppercase tracking-wide text-muted">Description</h4>
            <template v-if="detail.paragraphs">
              <p v-for="(para, i) in detail.paragraphs" :key="i" class="mb-3 text-sm leading-relaxed text-[#3a4048]">{{ para }}</p>
            </template>
            <p v-else class="text-sm leading-relaxed text-[#3a4048]">{{ detail.desc }}</p>
            <h4 class="mb-2 mt-4 text-xs uppercase tracking-wide text-muted">Highlights</h4>
            <ul class="space-y-1.5 text-sm">
              <li v-for="h in detail.highlights" :key="h" class="relative pl-6 text-[#3a4048] before:absolute before:left-0 before:text-ok before:content-['✔']">{{ h }}</li>
            </ul>
          </section>

          <!-- Specifications -->
          <section v-show="tab === 'specs'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <h4 class="mb-3 text-xs uppercase tracking-wide text-muted">Specifications</h4>
            <table class="w-full text-sm">
              <tbody>
                <tr v-for="r in detail.specs" :key="r[0]" class="border-b border-line odd:bg-[#FCFCFD]">
                  <td class="w-1/2 py-2 text-muted">{{ r[0] }}</td><td class="py-2 font-semibold">{{ r[1] }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Fitment (auto) -->
          <section v-if="detail.auto" v-show="tab === 'fitment'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <h4 class="mb-3 text-xs uppercase tracking-wide text-muted">Compatible vehicles</h4>
            <table class="w-full text-sm">
              <thead><tr class="bg-[#FAFAFB] text-left text-[11px] uppercase tracking-wide text-muted"><th class="p-2.5">Make</th><th class="p-2.5">Model</th><th class="p-2.5">Years</th><th class="p-2.5">Engines</th></tr></thead>
              <tbody>
                <tr v-for="x in detail.auto.fits" :key="x.mk + x.md" class="border-b border-line">
                  <td class="p-2.5">{{ x.mk }}</td><td class="p-2.5 font-bold">{{ x.md }}</td><td class="p-2.5">{{ x.y }}</td><td class="p-2.5">{{ x.en.join(', ') }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Cross-reference (auto) -->
          <section v-if="detail.auto" v-show="tab === 'xref'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <h4 class="mb-3 text-xs uppercase tracking-wide text-muted">Cross-reference numbers</h4>
            <table class="w-full text-sm">
              <thead><tr class="bg-[#FAFAFB] text-left text-[11px] uppercase tracking-wide text-muted"><th class="p-2.5">Type</th><th class="p-2.5">Number</th><th class="p-2.5">Source</th></tr></thead>
              <tbody>
                <tr class="border-b border-line"><td class="p-2.5">OE</td><td class="p-2.5 cursor-pointer font-display text-[18px] font-extrabold hover:text-brand" @click="copy(detail.auto!.oe)">{{ detail.auto.oe }}</td><td class="p-2.5">Manufacturer</td></tr>
                <tr v-for="a in detail.auto.alt" :key="a" class="border-b border-line"><td class="p-2.5">Replaces</td><td class="p-2.5 cursor-pointer font-display text-[18px] font-extrabold hover:text-brand" @click="copy(a)">{{ a }}</td><td class="p-2.5">Catalogue</td></tr>
                <tr class="border-b border-line"><td class="p-2.5">Our SKU</td><td class="p-2.5 font-display text-[18px] font-extrabold">OS-{{ product.id.toUpperCase().padStart(5, '0') }}</td><td class="p-2.5">Onestarry</td></tr>
              </tbody>
            </table>
          </section>

          <!-- Shipping & returns -->
          <section v-show="tab === 'shipping'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <div class="space-y-6">
              <div>
                <h4 class="mb-2 text-xs uppercase tracking-wide text-muted">Shipping</h4>
                <p class="text-sm leading-relaxed text-[#3a4048]">Standard delivery {{ detail.eta }}. Orders placed before 16:00 ship the same business day when in stock. Free on orders over $75. Tracking is emailed on dispatch; duties and import taxes are calculated at checkout.</p>
              </div>
              <div>
                <h4 class="mb-2 text-xs uppercase tracking-wide text-muted">Returns & warranty</h4>
                <p class="text-sm leading-relaxed text-[#3a4048]">12-month warranty against manufacturing defects. Return unused items in original packaging within 30 days for a full refund. Report transit damage within 7 days with photos.</p>
              </div>
            </div>
          </section>

          <!-- Reviews -->
          <section v-show="tab === 'reviews'" class="card mb-4 rounded-t-none border-t-0 p-5">
            <h4 class="mb-3 text-xs uppercase tracking-wide text-muted">Buyer reviews</h4>
            <ProductReviews :product="product" :detail="detail" />
          </section>
          </div>
        </div>

        <div class="mt-6"><ProductBundle :product="product" :related="related" /></div>
      </div>

      <!-- RIGHT: checkout — sticky, runs top-to-bottom alongside the detail tabs -->
      <aside class="lg:sticky lg:top-[132px]">
        <ProductBuyBox :product="product" :detail="detail" />
      </aside>
    </div>

    <!-- Related products — full width; the sticky right column releases here -->
    <section class="mt-6">
      <h2 class="sec-title mb-3.5 text-[26px]">Related products</h2>
      <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        <ProductCard v-for="p in related.slice(0, 6)" :key="p.id" :product="p" />
      </div>
    </section>

    <!-- sticky mobile buy bar -->
    <div class="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink text-white shadow-pop lg:hidden">
      <div class="shell flex items-center gap-3 py-2.5">
        <ProductImage :product="product" :w="60" :h="60" class="h-10 w-10 rounded" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13px] font-semibold">{{ product.name }}</div>
          <div class="font-display text-xl font-extrabold text-brand">{{ product.priceRange ? `${money(product.priceRange[0])} – ${money(product.priceRange[1])}` : money(product.price) }}</div>
        </div>
        <button class="btn-primary !py-2.5" :disabled="product.stock === 0" @click="stickyAdd">Add to Cart</button>
      </div>
    </div>
  </div>
</template>
