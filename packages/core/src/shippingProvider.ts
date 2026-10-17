/**
 * core/shippingProvider.ts —— 承运商可插拔接缝（§7 / §15 步骤 13）
 * 中国专线（云途/燕文/4PX…）各实现本接口；无账号时用 FakeShippingProvider。
 * 以后叠加真实承运商 = 实现接口 + 配密钥，主干与 recordShipment 零改动。
 */

export interface CreateLabelInput {
    orderId: string;
    carrier: string;
    toCountry: string;
    weightG: number;
    customsDeclaration?: Record<string, unknown>;
}

export interface ShippingLabel {
    provider: string;
    trackingNumber: string;
    labelUrl?: string;
}

export interface TrackingResult {
    status: string; // in_transit | delivered | exception ...
}

export interface ShippingProvider {
    readonly name: string;
    createLabel(input: CreateLabelInput): Promise<ShippingLabel>;
    track(trackingNumber: string): Promise<TrackingResult>;
}

/** 开发/测试用假承运商：不触网、返回确定运单号，让发货链路在无承运商账号时即可跑通。 */
export class FakeShippingProvider implements ShippingProvider {
    readonly name = "fake";

    async createLabel(input: CreateLabelInput): Promise<ShippingLabel> {
        return { provider: this.name, trackingNumber: `FAKE-${input.orderId.slice(0, 8)}`, labelUrl: "https://fake/label.pdf" };
    }

    async track(trackingNumber: string): Promise<TrackingResult> {
        return { status: trackingNumber.startsWith("FAKE-") ? "in_transit" : "unknown" };
    }
}
