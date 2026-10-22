export type ToastTone = 'ok' | 'info' | 'danger'

export interface Toast {
    id: number
    msg: string
    tone: ToastTone
}

/** App-wide toast queue, mounted once in the default layout via ToastHost. */
export function useToast() {
    const list = useState<Toast[]>('toasts', () => [])
    const seq = useState<number>('toast-seq', () => 0)

    const dismiss = (id: number) => {
        list.value = list.value.filter((t) => t.id !== id)
    }

    const show = (msg: string, tone: ToastTone = 'ok') => {
        const id = ++seq.value
        list.value.push({ id, msg, tone })
        setTimeout(() => dismiss(id), 2600)
    }

    return { list, show, dismiss }
}
