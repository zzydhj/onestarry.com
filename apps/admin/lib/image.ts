const MAX_EDGE = 1600; // 最长边像素，压完再传（零服务器成本）

/** 浏览器端把图片缩到最长边 ≤1600 并转 webp(q0.82)；失败则原样返回。 */
export async function downscaleImage(file: File): Promise<Blob> {
    try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * scale);
        const h = Math.round(bmp.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(bmp, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/webp", 0.82));
        return blob ?? file;
    } catch {
        return file;
    }
}
