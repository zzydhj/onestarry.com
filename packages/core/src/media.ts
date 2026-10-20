import { MEDIA_PUBLIC_BASE } from "./site";

/** 由 media_assets.r2Key 拼出公网可访问 URL（已是绝对 URL 则原样返回）。MEDIA_PUBLIC_BASE 真源在 site.ts。 */
export function mediaUrl(r2Key: string | null | undefined): string {
    if (!r2Key) return "";
    if (/^https?:\/\//i.test(r2Key)) return r2Key;
    return `${MEDIA_PUBLIC_BASE}/${r2Key.replace(/^\/+/, "")}`;
}
