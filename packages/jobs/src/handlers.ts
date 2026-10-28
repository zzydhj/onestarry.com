import { recomputeVariantMarketPrice, type RecomputeInput } from "@onestarry/db";
import type { RelayHandlers } from "./relay";

/**
 * relay 处理器注册表。新增事件类型只在这里加一条。
 * MVP：price.recompute 的 payload 直接携带重算所需事实（由发起方解析）；
 * 后续可改为 payload 只放 ids，由 handler 经 Tax/Duty/FX provider 解析后再重算。
 *
 * 关于"无消费者"的事件（order.* / payment.*）：这些是发起方在业务事务里**有意**落账的审计/联动事件，
 * 消费者（发邮件、推搜索索引、Merchant feed 回写…）在 MVP 尚未接入。这里注册为**显式 no-op**：
 *  - 与"什么都不做直接 ack"结果相同（标 dispatched），但语义是"已知、暂无下游、有意确认"，
 *    从而把 relay 的 dead 通道**留给真正未知的事件类型**（拼写错误 / 加了 emit 忘了注册 handler）——
 *    那才是需要运维面板显形的配置缺口（审查 H1）。若把这些也丢进 dead，正常每单都会让面板飘红，淹没真实故障。
 * 接下游时，把对应 no-op 换成真实实现即可，不改引擎。
 */
const noop = async (): Promise<void> => {
    /* 有意空转：见上方注释。消费者接入后替换本实现。 */
};

export const relayHandlers: RelayHandlers = {
    "price.recompute": async (db, event) => {
        await recomputeVariantMarketPrice(db, event.payload as unknown as RecomputeInput);
    },
    "order.created": noop,
    "order.shipped": noop,
    "payment.succeeded": noop,
    "payment.refunded": noop,
    "payment.revoked": noop,
};
