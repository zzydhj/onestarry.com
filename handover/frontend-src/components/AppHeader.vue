<script setup lang="ts">
import { categories } from '~/data/categories'

const cart = useCart()
const { count, subtotal, toggle } = cart
const header = useHeaderMenu()

const q = ref('')
const submit = () => {
  const term = q.value.trim()
  if (term) navigateTo(`/search?q=${encodeURIComponent(term)}`)
}
</script>

<template>
  <!-- Yellow promo note (keeps the prototype's .note bar look) -->
  <div class="border-b border-dashed border-[#D9B400] bg-brand-soft text-[#6b5600]">
    <div class="shell flex items-center justify-center gap-2 py-1.5 text-center text-[12px]">
      🚚 Free shipping over <b class="font-bold">$75</b> · 30-day returns · New here?
      <b class="font-bold">10% off</b> your first order with code <b class="font-bold">ONE10</b>
    </div>
  </div>

  <!-- Dark utility strip (.top) -->
  <div class="bg-ink-2 text-[#cfd4dc]">
    <div class="shell flex items-center justify-between gap-4 py-1.5 text-[12px]">
      <div class="flex items-center gap-4">
        <NuxtLink to="/deals" class="hover:text-brand">Today's Deals</NuxtLink>
        <NuxtLink to="/help#shipping" class="hover:text-brand">Shipping</NuxtLink>
        <NuxtLink to="/help#returns" class="hover:text-brand">Returns</NuxtLink>
        <span class="hidden sm:inline">Sell on Onestarry</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="hidden sm:inline">📦 Track order</span>
        <span>EN / USD $</span>
      </div>
    </div>
  </div>

  <!-- Sticky black header -->
  <header class="sticky top-0 z-40 bg-ink text-white">
    <div class="shell flex items-center gap-5 py-3">
      <NuxtLink to="/" class="logo shrink-0">ONE<span>STARRY</span></NuxtLink>

      <div class="relative flex-1">
        <div class="flex overflow-hidden rounded-md border-2 border-brand bg-white">
          <input
            v-model="q"
            class="min-w-0 flex-1 px-4 py-3 text-base text-ink outline-none"
            placeholder="Search products, brands and categories — e.g. wireless earbuds"
            @keyup.enter="submit"
          />
          <button class="bg-brand px-7 text-sm font-bold text-ink hover:brightness-95" @click="submit">
            SEARCH
          </button>
        </div>
      </div>

      <div class="flex items-center gap-5 whitespace-nowrap text-[13px] font-medium">
        <NuxtLink to="/account" class="group hidden md:block">
          Account
          <small class="block text-[11px] text-[#9aa1ad] group-hover:text-brand">Sign in / Register</small>
        </NuxtLink>
        <button class="rounded-md bg-brand px-3.5 py-2.5 text-[13px] font-bold text-ink hover:brightness-95" @click="toggle(true)">
          🛒 {{ count }} · {{ money(subtotal) }}
        </button>
      </div>
    </div>

    <!-- Secondary nav (.mn) — sits above the mega-menu backdrop so hovering the button isn't blocked -->
    <nav class="relative z-40 bg-ink-2">
      <div class="shell flex items-center">
        <button
          class="bg-brand px-3.5 py-2.5 text-[13px] font-bold text-ink select-none"
          @click="header.toggle()"
          @mouseenter="header.openMenu()"
          @mouseleave="header.scheduleClose()"
        >
          ☰ All Categories
        </button>
        <NuxtLink
          v-for="c in categories.slice(0, 7)"
          :key="c.slug"
          :to="`/category/${c.slug}`"
          class="px-3.5 py-2.5 text-[13px] font-semibold text-[#dfe3e9] hover:text-brand"
        >{{ c.name }}</NuxtLink>
        <NuxtLink to="/brands" class="px-3.5 py-2.5 text-[13px] font-semibold text-[#dfe3e9] hover:text-brand">Brands</NuxtLink>
        <NuxtLink to="/deals" class="ml-auto px-3.5 py-2.5 text-[13px] font-semibold text-brand hover:brightness-110">
          Today's Deals →
        </NuxtLink>
      </div>
    </nav>

    <MegaMenu />
  </header>
</template>

<style scoped>
.logo {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 800;
  font-size: 34px;
  line-height: 1;
  letter-spacing: 1px;
  white-space: nowrap;
}
.logo span {
  background: #ffc400;
  color: #111318;
  padding: 0 8px;
  margin-left: 4px;
  border-radius: 3px;
}
</style>
