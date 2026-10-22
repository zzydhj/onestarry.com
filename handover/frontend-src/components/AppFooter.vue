<script setup lang="ts">
const cols = [
  {
    h: 'Shop',
    links: [
      { t: 'All categories', to: '/category/electronics' },
      { t: "Today's deals", to: '/deals' },
      { t: 'New arrivals', to: '/search?q=new' },
      { t: 'Best sellers', to: '/search?q=best' },
      { t: 'Brands', to: '/brands' },
    ],
  },
  {
    h: 'Account',
    links: [
      { t: 'Dashboard', to: '/account' },
      { t: 'Orders', to: '/account/orders' },
      { t: 'Wishlist', to: '/account/wishlist' },
      { t: 'Sign in', to: '/login' },
    ],
  },
  {
    h: 'Help',
    links: [
      { t: 'Shipping info', to: '/help#shipping' },
      { t: 'Returns & refunds', to: '/help#returns' },
      { t: 'Track order', to: '/help#track' },
      { t: 'FAQ', to: '/help#faq' },
      { t: 'Contact', to: '/help#contact' },
    ],
  },
]
</script>

<template>
  <footer class="mt-9 bg-ink-2 text-[#aab0bb]">
    <div class="shell py-10 text-[13px]">
      <div class="grid grid-cols-2 gap-6 md:grid-cols-[1.5fr_1fr_1fr_1fr_1.2fr]">
        <div>
          <div class="font-display text-3xl font-extrabold uppercase tracking-wider text-white">
            ONE<span class="ml-1 rounded bg-brand px-2 text-ink">STARRY</span>
          </div>
          <p class="mt-2.5 max-w-[280px] leading-relaxed">
            Everything you need in one cart — electronics, fashion, home, automotive and more,
            shipped fast to your door.
          </p>
        </div>

        <div v-for="col in cols" :key="col.h">
          <h6 class="mb-3 text-xs uppercase tracking-[1.4px] text-white">{{ col.h }}</h6>
          <ul class="space-y-2">
            <li v-for="l in col.links" :key="l.t">
              <NuxtLink :to="l.to" class="hover:text-brand">{{ l.t }}</NuxtLink>
            </li>
          </ul>
        </div>

        <div>
          <h6 class="mb-3 text-xs uppercase tracking-[1.4px] text-white">Contact</h6>
          <p>+00 0000 0000</p>
          <p>support@yourdomain.com</p>
          <p>Mon–Sat · 8 AM – 10 PM</p>
        </div>
      </div>

      <div class="mt-6 flex flex-wrap justify-between gap-3 border-t border-ink-3 pt-3.5 text-xs">
        <span>© 2026 Onestarry. All rights reserved.</span>
        <span>
          <NuxtLink to="/terms" class="hover:text-brand">Terms</NuxtLink> ·
          <NuxtLink to="/terms" class="hover:text-brand">Privacy</NuxtLink> ·
          <NuxtLink to="/help#shipping" class="hover:text-brand">Shipping Policy</NuxtLink>
        </span>
      </div>
    </div>
  </footer>
</template>
