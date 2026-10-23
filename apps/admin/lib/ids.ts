/**
 * 后台里所有"把外部输入拼进 R2 key 或 SQL 条件"的地方共用的 id 形状校验。
 *
 * 为什么要单独一个文件：`productId` 之类是表单里带回来的字符串，旧实现直接拼进对象存储
 * key（`products/${productId}/…`）。R2 的 key 是扁平字符串，`../` 不会真的穿越目录，
 * 但会留下 `products/../x/….jpg` 这种脏 key，之后按前缀清理与统计都会被它骗过。
 * 在入口判一次形状，比在每处解释一次便宜。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
    return typeof value === "string" && UUID_RE.test(value);
}
