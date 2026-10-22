<script setup lang="ts">
const { close } = useHeaderMenu()
const route = useRoute()

// close the mega menu whenever the route changes
watch(() => route.fullPath, () => close())

const showTop = ref(false)
if (import.meta.client) {
  window.addEventListener('scroll', () => {
    showTop.value = window.scrollY > 600
  })
}
const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter />

    <CartDrawer />
    <ToastHost />

    <button
      v-show="showTop"
      class="fixed bottom-5 right-5 z-50 grid h-11 w-11 place-items-center rounded-full bg-ink text-xl text-brand shadow-pop hover:brightness-110"
      aria-label="Back to top"
      @click="toTop"
    >
      ↑
    </button>
  </div>
</template>
