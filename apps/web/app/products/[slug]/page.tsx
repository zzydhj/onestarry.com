import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { mediaUrl } from "@onestarry/core";
import { createDb, getProductById, listProductImages, resolveSlug } from "@onestarry/db";
import { addToCartAction } from "../../cart/actions";
import { RichBody } from "./RichBody";

export const dynamic = "force-dynamic";

function money(cents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const { env } = getCloudflareContext();
    const db = createDb(env.HYPERDRIVE.connectionString);

    const res = await resolveSlug(db, { entityType: "product", locale: "en", slug });
    if (!res) notFound();
    if (res.status === "redirect") permanentRedirect(`/products/${res.toSlug}`);

    const p = await getProductById(db, res.entityId, "us", "en");
    if (!p) notFound();
    const images = await listProductImages(db, res.entityId);

    return (
        <div className="mx-auto max-w-2xl px-4 py-8">
            <Link href="/" className="text-sm text-muted transition hover:text-accent">← All products</Link>
            {images.length > 0 ? (
                <div className="mt-4">
                    <img
                        src={mediaUrl(images[0]?.r2Key)}
                        alt={p.title}
                        width={600}
                        height={600}
                        className="aspect-square w-full rounded-xl border border-line object-cover"
                    />
                    {images.length > 1 && (
                        <div className="mt-2 flex gap-2">
                            {images.slice(1).map((im) => (
                                <img
                                    key={im.mediaId}
                                    src={mediaUrl(im.r2Key)}
                                    alt=""
                                    width={72}
                                    height={72}
                                    loading="lazy"
                                    className="h-16 w-16 rounded-md border border-line object-cover"
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="mt-4 flex aspect-square w-full items-center justify-center rounded-xl bg-surface text-muted">No image</div>
            )}

            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{p.title}</h1>
            {p.description && <p className="mt-2 text-muted">{p.description}</p>}
            <div className="mt-3 text-2xl font-bold text-accent">{money(p.priceCents, p.currency)}</div>
            <p className={`mt-2 text-sm ${p.available > 0 ? "text-green-600" : "text-red-600"}`}>
                {p.available > 0 ? `In stock · ${p.available} available` : "Out of stock"}
            </p>
            <p className="mt-6 text-xs text-muted">SKU: {p.sku}</p>

            {p.richBody && (
                <section className="mt-6 border-t border-line pt-5">
                    <h2 className="mb-2 text-base font-semibold">Product details</h2>
                    <RichBody doc={p.richBody} />
                </section>
            )}

            <form action={addToCartAction} className="mt-6 flex max-w-xs items-center gap-3">
                <input type="hidden" name="variantId" value={p.variantId} />
                <label className="text-sm text-muted">
                    Qty
                    <input
                        type="number"
                        name="qty"
                        min={1}
                        max={p.available || 1}
                        defaultValue={1}
                        className="mt-1 w-20 rounded-md border border-line px-2 py-1.5 text-fg"
                    />
                </label>
                <button
                    type="submit"
                    disabled={p.available <= 0}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {p.available > 0 ? "Add to cart" : "Out of stock"}
                </button>
            </form>
        </div>
    );
}
