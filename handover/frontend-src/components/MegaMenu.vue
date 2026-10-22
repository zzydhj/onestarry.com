<script setup lang="ts">
import { categories } from '~/data/categories'
import { countByCategory } from '~/data/products'
import { subImage } from '~/utils/productImage'

const { open, close, openMenu, scheduleClose } = useHeaderMenu()
const active = ref(0)
</script>

<template>
  <Transition name="mega">
    <div v-if="open" class="absolute inset-x-0 top-full z-30">
      <div class="fixed inset-0 bg-[rgba(10,12,16,.5)]" @click="close" />
      <div
        class="relative border-t-[3px] border-brand bg-white text-ink shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        @mouseenter="openMenu()"
        @mouseleave="scheduleClose()"
      >
        <div class="shell grid grid-cols-1 md:grid-cols-[280px_1fr]">
            <!-- Category rail -->
            <div class="border-r border-line bg-canvas py-1.5">
              <button
                v-for="(c, i) in categories"
                :key="c.slug"
                class="flex w-full items-center justify-between gap-2 border-l-4 px-5 py-2 text-left text-sm font-semibold transition"
                :class="i === active ? 'border-brand bg-white text-ink' : 'border-transparent text-ink hover:bg-[#FFFCEB]'"
                @mouseenter="active = i"
              >
                <span><span class="mr-2">{{ c.icon }}</span>{{ c.name }}</span>
                <span class="text-[#9aa1ad]">›</span>
              </button>
              <NuxtLink
                to="/brands"
                class="mt-1.5 block border-t border-line px-5 py-2 text-sm font-bold text-link hover:bg-[#FFFCEB]"
                @click="close"
              >🏷 All brands →</NuxtLink>
            </div>

            <!-- Active category detail -->
            <div class="p-6">
              <div class="mb-3 flex items-end justify-between border-b border-line pb-3">
                <h2 class="font-display text-3xl uppercase tracking-wide">{{ categories[active].name }}</h2>
                <NuxtLink
                  :to="`/category/${categories[active].slug}`"
                  class="text-[13px] font-bold text-link hover:underline"
                  @click="close"
                >Shop all {{ categories[active].name }} →</NuxtLink>
              </div>
              <p class="mb-4 text-sm text-muted">{{ categories[active].blurb }}</p>
              <div class="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
                <NuxtLink
                  v-for="s in categories[active].subs"
                  :key="s"
                  :to="`/category/${categories[active].slug}?sub=${encodeURIComponent(s)}`"
                  class="group flex flex-col items-center gap-2"
                  @click="close"
                >
                  <span class="aspect-square w-[104px] overflow-hidden rounded-full border border-line bg-canvas">
                    <img :src="subImage(categories[active].slug, s)" :alt="s" loading="lazy" referrerpolicy="no-referrer" class="h-full w-full object-cover transition duration-300 group-hover:scale-110" />
                  </span>
                  <span class="line-clamp-2 text-center text-[13px] font-medium leading-tight text-ink group-hover:text-brand">{{ s }}</span>
                </NuxtLink>
              </div>
              <div class="mt-6 rounded-lg bg-canvas p-4 text-sm">
                <span class="font-bold">{{ countByCategory(categories[active].slug) }}</span>
                <span class="text-muted"> featured products in this category · </span>
                <NuxtLink :to="`/category/${categories[active].slug}?sort=rating`" class="font-bold text-link hover:underline" @click="close">
                  see top rated →
                </NuxtLink>
              </div>
            </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mega-enter-active,
.mega-leave-active {
  transition: opacity 0.18s ease;
}
.mega-enter-from,
.mega-leave-to {
  opacity: 0;
}
</style>
