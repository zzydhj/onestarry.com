/**
 * core/hash.ts —— 确定性输入哈希（FNV-1a，零依赖、同步）。
 * 仅用于缓存失效判定（inputs_hash），非安全用途。键排序保证与传入顺序无关。
 */
export function hashInputs(parts: Record<string, string | number | boolean | null | undefined>): string {
    const keys = Object.keys(parts).sort();
    let s = "";
    for (const k of keys) s += `${k}=${parts[k] ?? ""}|`;

    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
