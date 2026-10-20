import type { Metadata } from "next";
import type { SeoMetaRow } from "@onestarry/db";

/** 把 seo_meta 覆盖合并进基础 Metadata：无覆盖原样返回；逐字段"有则覆盖"。 */
export function applySeoMeta(base: Metadata, seo: SeoMetaRow | null): Metadata {
    if (!seo) return base;
    const out: Metadata = { ...base };
    if (seo.seoTitle) out.title = { absolute: seo.seoTitle };
    if (seo.metaDescription) out.description = seo.metaDescription;
    if (seo.canonicalUrl) out.alternates = { ...out.alternates, canonical: seo.canonicalUrl };
    if (seo.robots) out.robots = seo.robots as Metadata["robots"];
    if (seo.og) out.openGraph = { ...out.openGraph, ...(seo.og as object) };
    return out;
}
