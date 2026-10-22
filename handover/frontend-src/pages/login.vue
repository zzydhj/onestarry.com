<script setup lang="ts">
const { show } = useToast()
const email = ref('')
const pw = ref('')
const submit = () => {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) return show('Enter a valid email', 'danger')
  if (pw.value.length < 6) return show('Password must be at least 6 characters', 'danger')
  show('Signed in — welcome back!')
  navigateTo('/account')
}
</script>

<template>
  <div class="shell grid place-items-center py-10">
    <div class="w-full max-w-[420px]">
      <div class="mb-5 text-center">
        <div class="font-display text-3xl font-extrabold uppercase text-ink">ONE<span class="ml-1 rounded bg-brand px-2 text-ink">STARRY</span></div>
        <h1 class="mt-2 font-display text-2xl uppercase">Welcome back</h1>
        <p class="text-sm text-muted">Sign in for member prices & faster checkout</p>
      </div>

      <div class="card p-5">
        <label class="field-label">Email</label>
        <input v-model="email" type="email" class="field mb-3" placeholder="you@email.com" />
        <label class="field-label">Password</label>
        <input v-model="pw" type="password" class="field" placeholder="••••••••" @keyup.enter="submit" />
        <div class="mt-1.5 text-right"><a class="text-xs font-semibold text-link hover:underline">Forgot password?</a></div>
        <button class="btn-primary btn-block mt-3" @click="submit">Sign in</button>

        <div class="my-4 flex items-center gap-3 text-xs text-muted"><span class="h-px flex-1 bg-line" />OR<span class="h-px flex-1 bg-line" /></div>
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-outline" @click="show('Demo: Google sign-in', 'info')">🇬 Google</button>
          <button class="btn-outline" @click="show('Demo: Apple sign-in', 'info')"> Apple</button>
        </div>
      </div>

      <p class="mt-4 text-center text-sm text-muted">New to Onestarry? <NuxtLink to="/register" class="font-bold text-link hover:underline">Create an account</NuxtLink></p>
    </div>
  </div>
</template>
