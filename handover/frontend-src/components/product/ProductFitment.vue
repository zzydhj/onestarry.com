<script setup lang="ts">
import type { AutoDetail } from '~/data/productDetails'

const props = defineProps<{ auto: AutoDetail }>()

const makes = computed(() => [...new Set(props.auto.fits.map((f) => f.mk))])
const mk = ref(makes.value[0])
const models = computed(() => [...new Set(props.auto.fits.filter((f) => f.mk === mk.value).map((f) => f.md))])
const md = ref(models.value[0])
const engines = computed(() => props.auto.fits.filter((f) => f.mk === mk.value && f.md === md.value).flatMap((f) => f.en))
const en = ref(engines.value[0])

watch(mk, () => (md.value = models.value[0]))
watch(md, () => (en.value = engines.value[0]))

const result = ref<{ tone: 'ok' | 'mid' | 'no'; msg: string } | null>(null)

function check() {
  const rows = props.auto.fits.filter((f) => f.mk === mk.value && f.md === md.value)
  const exact = rows.find((f) => f.en.includes(en.value))
  if (exact) result.value = { tone: 'ok', msg: `✔ Fits your ${mk.value} ${md.value} ${en.value} (${exact.y})` }
  else if (rows.length) result.value = { tone: 'mid', msg: `⚠ ${mk.value} ${md.value} is listed, but not with the ${en.value} engine.` }
  else result.value = { tone: 'no', msg: `✖ Not listed for ${mk.value} ${md.value}. Ask us — we may have a matching part.` }
}

const toneCls = {
  ok: 'border border-[#BFE3CB] bg-[#E8F6EE] text-ok',
  mid: 'border border-[#F0D79A] bg-[#FFF4DC] text-warn',
  no: 'border border-[#F3BDBB] bg-[#FDECEC] text-danger',
}
</script>

<template>
  <div class="mt-4 overflow-hidden rounded-lg border-2 border-brand">
    <div class="bg-brand px-3.5 py-2 text-[13px] font-extrabold uppercase">🚗 Check if it fits your vehicle</div>
    <div class="p-3.5">
      <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
        <select v-model="mk" class="field !py-2 text-[13px]"><option v-for="m in makes" :key="m">{{ m }}</option></select>
        <select v-model="md" class="field !py-2 text-[13px]"><option v-for="m in models" :key="m">{{ m }}</option></select>
        <select v-model="en" class="field !py-2 text-[13px]"><option v-for="m in engines" :key="m">{{ m }}</option></select>
        <button class="btn-dark !px-3" @click="check">CHECK</button>
      </div>
      <div v-if="result" class="mt-2.5 rounded-md px-3 py-2.5 text-[13px] font-semibold" :class="toneCls[result.tone]">
        {{ result.msg }}
      </div>
      <p v-else class="mt-2.5 text-xs text-muted">Select your vehicle to verify fitment before ordering.</p>
    </div>
  </div>
</template>
