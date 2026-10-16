/**
 * UUIDv7 生成器（时间有序）。
 * - 运行时兼容 Cloudflare Workers / Node：仅依赖全局 `crypto.getRandomValues`，无 Node-only 依赖。
 * - 用途：全表主键。时间前缀使 B-tree 索引局部性更好，并支持订单表按 id 解析时间做分区裁剪（见 repository）。
 */
export function uuidv7(): string {
    const now = Date.now();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // 前 48 位 = Unix 毫秒时间戳（大端）
    const ts = BigInt(now);
    bytes[0] = Number((ts >> 40n) & 0xffn);
    bytes[1] = Number((ts >> 32n) & 0xffn);
    bytes[2] = Number((ts >> 24n) & 0xffn);
    bytes[3] = Number((ts >> 16n) & 0xffn);
    bytes[4] = Number((ts >> 8n) & 0xffn);
    bytes[5] = Number(ts & 0xffn);

    // version = 7
    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    // variant = RFC 4122
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = [...bytes]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join("-");
}

/**
 * 从 UUIDv7 解析出毫秒时间戳（用于订单表分区裁剪）。
 * 返回 Date；调用方据此附加 ±1 天缓冲做 created_at 范围裁剪。
 */
export function timeFromUuidv7(id: string): Date {
    const hex = id.replace(/-/g, "").slice(0, 12);
    return new Date(parseInt(hex, 16));
}
