<script setup lang="ts">
import { categories } from '~/data/categories'
import { products, productById, countByCategory } from '~/data/products'

useSeoMeta({ title: 'Onestarry — Everything you need, one cart' })

const cart = useCart()
const { show } = useToast()

// Deal of the day (featured)
const deal = productById('e2')!

// Product tabs
const tabs = ['Trending', 'Best sellers', 'New in', 'On sale'] as const
const tab = ref<(typeof tabs)[number]>('Trending')
const list = computed(() => {
  switch (tab.value) {
    case 'Best sellers':
      return [...products].filter((p) => p.badge === 'best' || p.reviews > 3000).sort((a, b) => b.reviews - a.reviews)
    case 'New in':
      return products.filter((p) => p.badge === 'new')
    case 'On sale':
      return products.filter((p) => p.compareAt)
    default:
      return products
  }
})
const shown = computed(() => list.value.slice(0, 12))

const email = ref('')
const subscribe = () => {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) return show('Please enter a valid email', 'danger')
  show('You’re subscribed — check your inbox for ONE10 🎉')
  email.value = ''
}

const addDeal = () => {
  cart.add(deal)
  show(`Added “${deal.name}” to cart`)
}
</script>

<template>
  <div class="shell py-4">
    <!-- HERO -->
    <section class="mt-2 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div class="flex min-h-[420px] flex-col justify-between rounded-[10px] bg-gradient-to-br from-ink via-ink to-[#2f3643] p-8 text-white sm:p-11">
        <div>
          <span class="inline-block rounded bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-ink">
            New season · Up to 40% off
          </span>
          <h1 class="mt-4 font-display text-5xl uppercase leading-[.95] sm:text-[68px]">
            Everything.<br /><span class="text-brand">One cart.</span>
          </h1>
          <p class="mt-3 max-w-[500px] leading-relaxed text-[#b4bac6]">
            Electronics, fashion, home, automotive, beauty and more — millions of products from
            trusted brands, delivered fast.
          </p>
          <div class="mt-6 flex flex-wrap gap-2.5">
            <NuxtLink to="/category/electronics" class="btn-primary">Shop Electronics</NuxtLink>
            <NuxtLink to="/deals" class="btn-outline !border-white !bg-transparent !text-white hover:!bg-white/10">Browse Today's Deals</NuxtLink>
          </div>
        </div>
        <div class="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[#cfd4dc]">
          <span>✅ Authentic brands</span><span>🚚 Free shipping over $75</span><span>↩️ 30-day returns</span>
        </div>
      </div>

      <!-- Deal of the day -->
      <div class="flex flex-col overflow-hidden rounded-[10px] border border-line bg-white">
        <div class="flex items-center justify-between bg-ink px-4 py-2.5 text-white">
          <h3 class="font-display text-xl uppercase tracking-wide">🔥 Deal of the Day</h3>
          <span class="text-[11px] font-bold text-brand">48h only</span>
        </div>
        <div class="flex flex-1 flex-col p-4">
          <ProductImage :product="deal" :w="480" :h="360" eager class="h-[160px] rounded" glyph-class="text-6xl" />
          <NuxtLink :to="`/product/${deal.id}`" class="mt-3 text-[15px] font-bold leading-snug hover:text-brand">{{ deal.name }}</NuxtLink>
          <RatingStars :rating="deal.rating" :reviews="deal.reviews" class="mt-1" />
          <div class="mt-3 flex items-end gap-2">
            <span class="font-display text-3xl font-extrabold">{{ money(deal.price) }}</span>
            <span class="mb-1 text-sm text-muted line-through">{{ money(deal.compareAt || 0) }}</span>
            <span class="mb-1 badge bg-danger text-white">-{{ discountPct(deal.price, deal.compareAt) }}%</span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded bg-canvas">
            <div class="h-full w-[72%] bg-brand" />
          </div>
          <p class="mt-1 text-xs text-muted">72% claimed · only 84 left</p>
          <button class="btn-primary btn-block mt-3" @click="addDeal">Add to Cart</button>
        </div>
      </div>
    </section>

    <!-- TRUST -->
    <section class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="t in [
        { e: '🚚', b: 'Free shipping', s: 'On orders over $75' },
        { e: '↩️', b: '30-day returns', s: 'No-questions refund' },
        { e: '🔒', b: 'Secure checkout', s: '256-bit encrypted' },
        { e: '🎧', b: '24/7 support', s: 'Real humans, fast' },
      ]" :key="t.b" class="flex items-center gap-3 rounded-lg border border-line bg-white p-3.5">
        <span class="text-[28px]">{{ t.e }}</span>
        <div><b class="block text-[13.5px]">{{ t.b }}</b><span class="text-xs text-muted">{{ t.s }}</span></div>
      </div>
    </section>

    <!-- CATEGORIES -->
    <section class="mt-8">
      <div class="sech mb-3.5 flex items-end justify-between gap-3">
        <div>
          <h2 class="sec-title">Shop by Category</h2>
          <p class="mt-0.5 text-[13.5px] text-muted">{{ categories.length }} departments · everything in one place</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <CategoryTile v-for="c in categories" :key="c.slug" :cat="c" :count="countByCategory(c.slug)" />
        <NuxtLink
          to="/brands"
          class="flex flex-col items-center justify-center rounded-lg bg-ink p-4 text-center text-white transition hover:-translate-y-1"
        >
          <span class="text-3xl">🏬</span>
          <b class="mt-1.5 block text-sm">All Departments</b>
          <span class="text-xs text-brand">Explore →</span>
        </NuxtLink>
      </div>
    </section>

    <!-- PRODUCT TABS -->
    <section class="mt-8">
      <div class="sech mb-3.5 flex flex-wrap items-end justify-between gap-3">
        <h2 class="sec-title">{{ tab }}</h2>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="t in tabs"
            :key="t"
            class="rounded-full border-[1.5px] px-4 py-1.5 text-[13px] font-bold transition"
            :class="t === tab ? 'border-ink bg-ink text-brand' : 'border-[#c9ced6] bg-white hover:border-ink'"
            @click="tab = t"
          >{{ t }}</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <ProductCard v-for="p in shown" :key="p.id" :product="p" />
      </div>
      <div class="mt-4 text-center">
        <NuxtLink :to="`/search?q=${encodeURIComponent(tab === 'On sale' ? 'sale' : tab === 'New in' ? 'new' : 'top')}`" class="btn-outline">
          View all products →
        </NuxtLink>
      </div>
    </section>

    <!-- PROMO BAND -->
    <section class="mt-8 grid items-center gap-6 rounded-[10px] bg-brand p-7 md:grid-cols-[1fr_1.1fr]">
      <div>
        <h2 class="font-display text-[40px] uppercase leading-none">Members save more</h2>
        <p class="mt-2 max-w-[420px] text-[15px] text-[#4a3b00]">
          Create a free Onestarry account for member pricing, faster checkout, order tracking and
          exclusive coupons.
        </p>
        <div class="mt-4 flex gap-2">
          <NuxtLink to="/register" class="btn-dark">Create free account</NuxtLink>
          <NuxtLink to="/login" class="btn-outline !border-ink !text-ink">Sign in</NuxtLink>
        </div>
      </div>
      <ul class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] font-semibold">
        <li class="relative pl-6 before:absolute before:left-0 before:content-['✔']">Member-only prices</li>
        <li class="relative pl-6 before:absolute before:left-0 before:content-['✔']">Early deal access</li>
        <li class="relative pl-6 before:absolute before:left-0 before:content-['✔']">One-click reorder</li>
        <li class="relative pl-6 before:absolute before:left-0 before:content-['✔']">Wishlist & lists</li>
      </ul>
    </section>

    <!-- NEWSLETTER -->
    <section class="mt-8 flex flex-wrap items-center justify-between gap-5 rounded-[10px] border border-line bg-white p-7">
      <div>
        <h2 class="font-display text-[30px] uppercase leading-tight">Get 10% off your first order</h2>
        <p class="text-[13.5px] text-muted">Join the newsletter for deals, drops and members-only coupons.</p>
      </div>
      <form class="flex min-w-[280px] max-w-[520px] flex-1 gap-2" @submit.prevent="subscribe">
        <input v-model="email" type="email" class="field" placeholder="you@email.com" />
        <button class="btn-primary shrink-0" type="submit">Subscribe</button>
      </form>
    </section>
  </div>
</template>
