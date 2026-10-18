/** R2 公开桶的公网访问基址（绑定的自定义域）。图片 URL 的单一真源。 */
export const MEDIA_PUBLIC_BASE = "https://media.onestarry.com";

/** 由 media_assets.r2Key 拼出公网可访问 URL（已是绝对 URL 则原样返回）。 */
export function mediaUrl(r2Key: string | null | undefined): string {
    if (!r2Key) return "";
    if (/^https?:\/\//i.test(r2Key)) return r2Key;
    return `${MEDIA_PUBLIC_BASE}/${r2Key.replace(/^\/+/, "")}`;
}
