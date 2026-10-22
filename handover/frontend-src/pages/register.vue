<script setup lang="ts">
const { show } = useToast()
const form = reactive({ name: '', email: '', pw: '' })

const strength = computed(() => {
  const p = form.pw
  let s = 0
  if (p.length >= 6) s++
  if (p.length >= 10) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) s++
  return s // 0..4
})
const bars = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-brand', 'bg-ok']

const submit = () => {
  if (form.name.trim().length < 2) return show('Please enter your name', 'danger')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return show('Enter a valid email', 'danger')
  if (strength.value < 2) return show('Choose a stronger password', 'danger')
  show('Account created — welcome to Onestarry! 🎉')
  navigateTo('/account')
}
</script>

<template>
  <div class="shell grid place-items-center py-10">
    <div class="w-full max-w-[440px]">
      <div class="mb-5 text-center">
        <h1 class="font-display text-2xl uppercase">Create your account</h1>
        <p class="text-sm text-muted">Join free — unlock member pricing & get 10% off your first order</p>
      </div>

      <div class="card p-5">
        <label class="field-label">Full name</label>
        <input v-model="form.name" class="field mb-3" placeholder="Jane Doe" />
        <label class="field-label">Email</label>
        <input v-model="form.email" type="email" class="field mb-3" placeholder="you@email.com" />
        <label class="field-label">Password</label>
        <input v-model="form.pw" type="password" class="field" placeholder="At least 6 characters" @keyup.enter="submit" />
        <div class="mt-2 flex gap-1">
          <span v-for="i in 4" :key="i" class="h-1.5 flex-1 rounded" :class="i <= strength ? bars[strength] : 'bg-line'" />
        </div>
        <p class="mt-1 text-xs text-muted">Strength: {{ ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][strength] }}</p>

        <button class="btn-primary btn-block mt-4" @click="submit">Create account</button>
        <p class="mt-2 text-center text-xs text-muted">By continuing you agree to our <NuxtLink to="/terms" class="text-link">Terms</NuxtLink> & <NuxtLink to="/terms" class="text-link">Privacy</NuxtLink>.</p>
      </div>

      <p class="mt-4 text-center text-sm text-muted">Already have an account? <NuxtLink to="/login" class="font-bold text-link hover:underline">Sign in</NuxtLink></p>
    </div>
  </div>
</template>
