/** Open/close state for the mega menu, shared between the header button and the panel. */
export function useHeaderMenu() {
    const open = useState<boolean>('mega-open', () => false)
    const timer = useState<ReturnType<typeof setTimeout> | undefined>('mega-timer', () => undefined)

    const cancel = () => {
        if (timer.value) {
            clearTimeout(timer.value)
            timer.value = undefined
        }
    }
    const openMenu = () => {
        cancel()
        open.value = true
    }
    const close = () => {
        cancel()
        open.value = false
    }
    // small delay so the pointer can travel from the button to the panel without it flickering shut
    const scheduleClose = () => {
        cancel()
        timer.value = setTimeout(() => (open.value = false), 140)
    }
    const toggle = () => {
        open.value = !open.value
    }
    return { open, toggle, close, openMenu, scheduleClose }
}
