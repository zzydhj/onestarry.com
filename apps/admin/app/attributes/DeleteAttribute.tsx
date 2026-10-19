"use client";

import { Button } from "@onestarry/ui";
import { deleteAttributeAction } from "./actions";

/** 删除属性：二次确认后调用 server action（连带解绑类目/商品引用）。 */
export function DeleteAttribute({ id, slug }: { id: string; slug: string }) {
    async function onClick() {
        if (!window.confirm(`删除属性「${slug}」？将同时解绑它在类目/商品上的引用。`)) return;
        const fd = new FormData();
        fd.set("id", id);
        await deleteAttributeAction(fd);
    }
    return (
        <Button type="button" variant="danger" size="sm" onClick={onClick}>
            删除
        </Button>
    );
}
