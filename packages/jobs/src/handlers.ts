import { recomputeVariantMarketPrice, type RecomputeInput } from "@onestarry/db";
import type { RelayHandlers } from "./relay";

/**
 * relay 处理器注册表。新增事件类型只在这里加一条。
 * MVP：price.recompute 的 payload 直接携带重算所需事实（由发起方解析）；
 * 后续可改为 payload 只放 ids，由 handler 经 Tax/Duty/FX provider 解析后再重算。
 */
export const relayHandlers: RelayHandlers = {
    "price.recompute": async (db, event) => {
        await recomputeVariantMarketPrice(db, event.payload as unknown as RecomputeInput);
    },
};
