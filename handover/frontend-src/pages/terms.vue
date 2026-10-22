<script setup lang="ts">
useSeoMeta({ title: 'Terms & Privacy — Onestarry' })

const sections = [
  { id: 'intro', h: '1. About these terms', p: 'These terms govern your use of the Onestarry website and the purchase of products through it. By placing an order you accept them in full. This is a demonstration page — replace with your real legal text before launch.' },
  { id: 'orders', h: '2. Orders & pricing', p: 'All prices are shown in USD and include applicable taxes where required. We may refuse or cancel an order in cases of error, suspected fraud, or unavailable stock. Payment is taken when your order is placed.' },
  { id: 'shipping', h: '3. Shipping & delivery', p: 'Estimated delivery times are guidelines, not guarantees. Risk passes to you on delivery. International orders may be subject to duties assessed by the destination country.' },
  { id: 'returns', h: '4. Returns & refunds', p: 'You may return most items within 30 days of delivery for a refund. Refund processing takes 3–5 business days after the item is received and inspected.' },
  { id: 'privacy', h: '5. Privacy & data', p: 'We store your account details and order history to provide the service. We never sell your data. You can request export or deletion of your personal data at any time from Account → Settings.' },
  { id: 'contact', h: '6. Contact', p: 'Questions about these terms? Reach us at support@yourdomain.com or through the Help Center.' },
]
</script>

<template>
  <div class="shell py-4">
    <h1 class="sec-title mb-4 text-[38px]">Terms & Privacy</h1>

    <div class="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav class="card h-fit lg:sticky lg:top-40">
        <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="block border-b border-line px-4 py-2.5 text-sm hover:bg-canvas hover:text-brand last:border-0">{{ s.h }}</a>
      </nav>
      <div class="card p-6">
        <p class="mb-6 text-sm text-muted">Last updated: 22 October 2026</p>
        <section v-for="s in sections" :id="s.id" :key="s.id" class="mb-6 scroll-mt-40">
          <h2 class="font-display text-xl uppercase">{{ s.h }}</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-[#3a4048]">{{ s.p }}</p>
        </section>
      </div>
    </div>
  </div>
</template>
