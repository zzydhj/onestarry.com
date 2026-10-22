<script setup lang="ts">
import { productById } from '~/data/products'

const route = useRoute()
const tabs: Record<string, string> = {
  overview: 'Overview',
  orders: 'Orders',
  wishlist: 'Wishlist',
  addresses: 'Addresses',
  settings: 'Settings',
}
const current = computed(() => String(route.params.tab || 'overview'))
if (!tabs[current.value]) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

const user = { name: 'Jane Doe', email: 'jane@email.com', tier: 'Gold member' }

const orders = [
  { id: 'OS-482910', date: 'Oct 18, 2026', status: 'Delivered', total: 128.5, items: 3 },
  { id: 'OS-471003', date: 'Oct 02, 2026', status: 'In transit', total: 89.0, items: 1 },
  { id: 'OS-460221', date: 'Sep 12, 2026', status: 'Processing', total: 214.97, items: 4 },
]
const statusClass: Record<string, string> = {
  Delivered: 'bg-[#E8F6EE] text-ok',
  'In transit': 'bg-[#DCEBFF] text-link',
  Processing: 'bg-[#FFF4DC] text-warn',
}
const wishIds = ['e2', 'h2', 's5', 'b1']
const wish = computed(() => wishIds.map((id) => productById(id)).filter(Boolean))

useSeoMeta({ title: () => `My account · ${tabs[current.value]} — Onestarry` })
</script>

<template>
  <div class="shell py-4">
    <h1 class="sec-title mb-4 text-[36px]">My Account</h1>

    <div class="grid gap-5 lg:grid-cols-[220px_1fr]">
      <aside class="card h-fit lg:sticky lg:top-40">
        <div class="border-b border-line bg-brand p-4 text-center">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ink text-xl font-bold text-brand">{{ user.name[0] }}</div>
          <div class="mt-2 font-bold">{{ user.name }}</div>
          <div class="text-xs text-[#6b5600]">{{ user.tier }}</div>
        </div>
        <NuxtLink
          v-for="(label, key) in tabs"
          :key="key"
          :to="`/account/${key}`"
          class="block border-b border-line px-4 py-3 text-sm font-semibold last:border-0 hover:bg-canvas"
          :class="current === key ? 'bg-canvas text-brand' : 'text-ink'"
        >{{ label }}</NuxtLink>
      </aside>

      <section>
        <!-- OVERVIEW -->
        <div v-if="current === 'overview'" class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="s in [{ b: '4', t: 'Orders' }, { b: '$830', t: 'Lifetime spend' }, { b: '12', t: 'Reward points' }]" :key="s.t" class="card p-4">
              <div class="font-display text-4xl font-extrabold">{{ s.b }}</div>
              <div class="text-sm text-muted">{{ s.t }}</div>
            </div>
          </div>
          <div class="card">
            <div class="card-head">Latest order</div>
            <div class="flex items-center justify-between p-4">
              <div><div class="font-bold">{{ orders[0].id }}</div><div class="text-xs text-muted">{{ orders[0].date }} · {{ orders[0].items }} items</div></div>
              <NuxtLink to="/account/orders" class="btn-outline btn-sm">View all orders</NuxtLink>
            </div>
          </div>
        </div>

        <!-- ORDERS -->
        <div v-else-if="current === 'orders'" class="card">
          <div class="card-head">Order history</div>
          <div>
            <div v-for="o in orders" :key="o.id" class="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 last:border-0">
              <div>
                <div class="font-bold">{{ o.id }}</div>
                <div class="text-xs text-muted">{{ o.date }} · {{ o.items }} items · {{ money(o.total) }}</div>
              </div>
              <span class="badge" :class="statusClass[o.status]">{{ o.status }}</span>
              <div class="flex gap-2">
                <NuxtLink to="/help#track" class="btn-outline btn-sm">Track</NuxtLink>
                <button class="btn-primary btn-sm" @click="useToast().show('Reordered')">Buy again</button>
              </div>
            </div>
          </div>
        </div>

        <!-- WISHLIST -->
        <div v-else-if="current === 'wishlist'">
          <div v-if="wish.length" class="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
            <ProductCard v-for="p in wish" :key="p!.id" :product="p!" />
          </div>
          <EmptyState v-else icon="❤️" title="No saved items yet">
            <NuxtLink to="/" class="btn-primary">Find something to love</NuxtLink>
          </EmptyState>
        </div>

        <!-- ADDRESSES -->
        <div v-else-if="current === 'addresses'" class="grid gap-3 sm:grid-cols-2">
          <div class="card p-4">
            <div class="mb-2 flex items-center justify-between"><b>Home</b><span class="badge bg-ink text-brand">Default</span></div>
            <p class="text-sm text-muted">{{ user.name }}<br />123 Market Street<br />Springfield, 12345<br />United States</p>
            <button class="btn-outline btn-sm mt-3">Edit</button>
          </div>
          <button class="card grid min-h-32 place-items-center border-dashed text-sm font-semibold text-muted hover:border-brand hover:text-ink">+ Add new address</button>
        </div>

        <!-- SETTINGS -->
        <div v-else class="card">
          <div class="card-head">Profile settings</div>
          <div class="grid gap-3 p-4 sm:grid-cols-2">
            <div><label class="field-label">Name</label><input class="field" :value="user.name" /></div>
            <div><label class="field-label">Email</label><input class="field" :value="user.email" /></div>
            <div class="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked class="accent-[#111318]" /> Email me about deals & offers</div>
            <div class="sm:col-span-2"><button class="btn-primary" @click="useToast().show('Settings saved')">Save changes</button></div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
