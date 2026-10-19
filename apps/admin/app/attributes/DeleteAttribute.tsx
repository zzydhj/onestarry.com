"use client";

import { useTransition } from "react";
import { Button } from "@onestarry/ui";
import { deleteAttributeAction } from "./actions";

/** 删除属性：二次确认后调用 server action（连带解绑类目/商品引用）。 */
export function DeleteAttribute({ id, slug }: { id: string; slug: string }) {
    const [pending, start] = useTransition();
    function onClick() {
        if (!window.confirm(`删除属性「${slug}」？将同时解绑它在类目/商品上的引用。`)) return;
        start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            await deleteAttributeAction(fd);
        });
    }
    return (
        <Button type="button" variant="danger" size="sm" onClick={onClick} disabled={pending}>
            {pending ? "删除中…" : "删除"}
        </Button>
    );
}
