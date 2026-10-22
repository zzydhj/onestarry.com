<script setup lang="ts">
useSeoMeta({ title: 'Help Center — Onestarry' })

const trackId = ref('')
const { show } = useToast()
const track = () => {
  if (!trackId.value.trim()) return show('Enter your order number', 'danger')
  show(`Order ${trackId.value.toUpperCase()}: Out for delivery · arrives today 🚚`)
}

const faqs = [
  { q: 'How long does delivery take?', a: 'Standard delivery is 2–4 business days. Orders over $75 ship free. Express options are shown at checkout.' },
  { q: 'What is your return policy?', a: 'Return any item within 30 days for a full refund, as long as it is unused and in original packaging. Return shipping is free.' },
  { q: 'Do you ship internationally?', a: 'Yes — we ship to 50+ countries. Duties and taxes are calculated transparently at checkout.' },
  { q: 'How do I track my order?', a: 'Use the Track order box above with your Onestarry order number, or check My Account → Orders.' },
  { q: 'Is my payment secure?', a: 'All payments are processed over 256-bit TLS encryption. We never store your full card details.' },
]
const openFaq = ref<number>(0)

const contact = reactive({ name: '', email: '', msg: '' })
const sendContact = () => {
  if (!contact.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email) || !contact.msg) return show('Please complete all fields', 'danger')
  show('Message sent — we reply within 24h')
  contact.name = contact.email = contact.msg = ''
}

const sections = [
  ['shipping', 'Shipping'],
  ['returns', 'Returns'],
  ['track', 'Track order'],
  ['faq', 'FAQ'],
  ['contact', 'Contact'],
]
</script>

<template>
  <div class="shell py-4">
    <h1 class="sec-title mb-4 text-[38px]">Help Center</h1>

    <div class="grid gap-5 lg:grid-cols-[200px_1fr]">
      <nav class="card h-fit lg:sticky lg:top-40">
        <a v-for="[id, label] in sections" :key="id" :href="`#${id}`" class="block border-b border-line px-4 py-3 text-sm font-semibold last:border-0 hover:bg-canvas hover:text-brand">{{ label }}</a>
      </nav>

      <div class="space-y-6">
        <!-- Shipping -->
        <section id="shipping" class="card scroll-mt-40">
          <div class="card-head">🚚 Shipping</div>
          <div class="grid gap-3 p-4 text-sm sm:grid-cols-3">
            <div class="rounded bg-canvas p-3"><b>Standard</b><p class="text-muted">2–4 days · Free over $75</p></div>
            <div class="rounded bg-canvas p-3"><b>Express</b><p class="text-muted">1 day · from $9.90</p></div>
            <div class="rounded bg-canvas p-3"><b>International</b><p class="text-muted">5–10 days · 50+ countries</p></div>
          </div>
        </section>

        <!-- Returns -->
        <section id="returns" class="card scroll-mt-40">
          <div class="card-head">↩️ Returns & refunds</div>
          <div class="p-4 text-sm leading-relaxed">
            Not happy? Return any item within <b>30 days</b> for a full refund — unused and in original packaging.
            Start a return from <NuxtLink to="/account/orders" class="font-bold text-link hover:underline">My Account → Orders</NuxtLink>. Refunds land back on your original payment method within 3–5 business days.
          </div>
        </section>

        <!-- Track -->
        <section id="track" class="card scroll-mt-40">
          <div class="card-head">📦 Track your order</div>
          <div class="flex flex-wrap gap-2 p-4">
            <input v-model="trackId" class="field flex-1 min-w-[220px]" placeholder="Order number (e.g. OS-482910)" />
            <button class="btn-primary" @click="track">Track</button>
          </div>
        </section>

        <!-- FAQ -->
        <section id="faq" class="card scroll-mt-40">
          <div class="card-head">❓ Frequently asked questions</div>
          <div>
            <div v-for="(f, i) in faqs" :key="i" class="border-b border-line last:border-0">
              <button class="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-bold hover:bg-canvas" @click="openFaq = openFaq === i ? -1 : i">
                {{ f.q }}<span class="text-lg text-brand">{{ openFaq === i ? '−' : '+' }}</span>
              </button>
              <p v-show="openFaq === i" class="px-4 pb-3.5 text-sm leading-relaxed text-muted">{{ f.a }}</p>
            </div>
          </div>
        </section>

        <!-- Contact -->
        <section id="contact" class="card scroll-mt-40">
          <div class="card-head">✉️ Contact us</div>
          <div class="grid gap-4 p-4 md:grid-cols-[1fr_260px]">
            <form class="space-y-3" @submit.prevent="sendContact">
              <input v-model="contact.name" class="field" placeholder="Your name" />
              <input v-model="contact.email" type="email" class="field" placeholder="Email" />
              <textarea v-model="contact.msg" class="field min-h-[110px]" placeholder="How can we help?" />
              <button class="btn-primary" type="submit">Send message</button>
            </form>
            <div class="space-y-2 rounded-lg bg-canvas p-4 text-sm">
              <p>📞 <b>+00 0000 0000</b></p>
              <p>✉️ support@yourdomain.com</p>
              <p>🕗 Mon–Sat · 8 AM – 10 PM</p>
              <p class="text-muted">Average first reply: under 2 hours.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
