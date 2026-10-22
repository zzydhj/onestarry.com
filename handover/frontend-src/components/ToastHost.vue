<script setup lang="ts">
const { list, dismiss } = useToast()
const toneClass: Record<string, string> = {
  ok: 'border-ok',
  info: 'border-link',
  danger: 'border-danger',
}
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-10 left-1/2 z-[999] flex -translate-x-1/2 flex-col items-center gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="t in list"
          :key="t.id"
          class="pointer-events-auto max-w-[92vw] cursor-pointer rounded-md border-l-[5px] bg-ink px-4 py-3 text-sm font-semibold text-white shadow-pop"
          :class="toneClass[t.tone]"
          @click="dismiss(t.id)"
        >
          {{ t.msg }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(16px);
}
</style>
