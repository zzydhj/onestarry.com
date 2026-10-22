"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@onestarry/ui";
import { createCategoryAction, updateCategoryAction } from "./actions";

/** 服务端 listAllCategories 的行（按 level,name 排序，同级相邻，所以树是"扁平带 level"的形状）。 */
export interface CategoryRow {
    id: string;
    name: string;
    parentId: string | null;
    level: number;
}

type Ghost = { key: string; name: string; level: number };
type Note = { text: string; bad: boolean };

/**
 * 类目管理（乐观 UI）。
 *
 * 慢在哪：这是 force-dynamic 页，每次写操作后都要整页重渲染 = 会话 + 权限 + 类目列表 +
 * 全部当前 slug，四五趟跨洋往返（主库 us-east、边缘在 HK，单趟 ~150–190ms），
 * 点一下"新增"要等 1–2 秒才看见新行。运营加一批类目是十几连点，这段等待纯浪费。
 *
 * 做法：新增先挂一行"虚线占位"进树（`useOptimistic`），服务端确认、整页回来后自动换成真行。
 * 用 `useOptimistic` 而不是 useState：transition 结束覆盖层自动失效，
 * 失败时假行会自己消失（不会留下一条数据库里根本不存在、却看得见点得着的类目）。
 *
 * 取舍：表单改 onSubmit 后不再有"无 JS 也能提交"的兜底 —— 与购物车数量编辑器同判断，
 * 后台交互件优先保证反馈真实。
 * 另：`Button type="submit"` 内部的 `useFormStatus` 只在"表单自己的 action 在跑"时置 pending；
 * 我们是 preventDefault 后手动 start() 调 action，所以提交态得由这里的 `pending` 显式驱动，
 * 不能指望那颗转圈（否则按钮既不禁用也不变色，人就真会连点两下建出两个类目）。
 */
export function CategoryManager({ cats, slugById }: { cats: CategoryRow[]; slugById: Record<string, string> }) {
    const [pending, start] = useTransition();
    const [ghosts, addGhost] = useOptimistic<Ghost[], Ghost>([], (cur, next) => [...cur, next]);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [parentId, setParentId] = useState("");
    const [note, setNote] = useState<Note | null>(null);

    const parentOptions = [{ id: "", name: "（顶层）" }, ...cats.map((c) => ({ id: c.id, name: "　".repeat(c.level - 1) + c.name }))];

    function create(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const fd = new FormData();
        fd.set("name", trimmed);
        fd.set("slug", slug);
        fd.set("parentId", parentId);
        // 挂到选中的父级下面；没选父级就是顶层（level 1）
        const level = (cats.find((c) => c.id === parentId)?.level ?? 0) + 1;
        setNote(null);
        start(async () => {
            // ⚠️ 乐观 setter 必须在 transition 内部调用。写在 start 外面时 React 会报
            // "An optimistic state update occurred outside a transition or action"，
            // 且这笔更新不与当前 transition 纠缠，失败后不一定自动回滚。
            addGhost({ key: `${trimmed}#${Date.now()}`, name: trimmed, level });
            const r = await createCategoryAction(fd);
            if (r.ok) {
                // 只清名称/slug：连着往同一个父级下加类目时，父级选择不该被重置
                setName("");
                setSlug("");
                setNote({ text: `已新增（slug：${r.slug}）`, bad: false });
            } else {
                setNote({ text: r.error, bad: true });
            }
        });
    }

    return (
        <>
            <form onSubmit={create} className="mt-5 flex flex-wrap items-center gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新类目名称" required className="py-1.5" />
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug（留空自动生成）" className="w-44 py-1.5" />
                <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="py-1.5">
                    {parentOptions.map((p) => (
                        <option key={p.id || "top"} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </Select>
                <Button type="submit" size="sm" disabled={pending}>
                    {pending ? "写入中…" : "新增"}
                </Button>
            </form>

            {note && <p className={`mt-2 text-xs ${note.bad ? "text-red-600" : "text-muted"}`}>{note.text}</p>}

            {cats.length === 0 && ghosts.length === 0 && <p className="mt-6 text-sm text-muted">暂无类目，用上方表单新增第一个。</p>}

            <ul className="mt-6 space-y-2">
                {cats.map((c) => (
                    <CategoryRowForm key={c.id} cat={c} slug={slugById[c.id] ?? ""} />
                ))}
                {ghosts.map((g) => (
                    <li key={g.key} className="flex items-center gap-2 opacity-60" style={{ marginLeft: (g.level - 1) * 22 }}>
                        <span className="rounded-md border border-dashed border-line px-2 py-1 text-sm">{g.name}</span>
                        <span className="text-xs text-muted">写入中…</span>
                        <span className="text-xs text-muted">L{g.level}</span>
                    </li>
                ))}
            </ul>
        </>
    );
}

/**
 * 单行改名/改 slug。
 *
 * 独立成组件是为了让每行自己持有输入框状态：整页重渲染（别的行新增成功也会触发）时
 * 不会把这一行**还没点保存**的草稿冲掉 —— 旧写法用 defaultValue，页面一刷新草稿就没了。
 * 保存失败时保留草稿并明确报错，由人决定要不要重试，不静默回到旧值。
 */
function CategoryRowForm({ cat, slug }: { cat: CategoryRow; slug: string }) {
    const [name, setName] = useState(cat.name);
    const [slugText, setSlugText] = useState(slug);
    const [pending, start] = useTransition();
    const [note, setNote] = useState<Note | null>(null);

    function save(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const fd = new FormData();
        fd.set("id", cat.id);
        fd.set("name", name.trim());
        fd.set("slug", slugText);
        setNote(null);
        start(async () => {
            const r = await updateCategoryAction(fd);
            setNote(
                r.ok
                    ? { text: r.slug ? `已保存（slug：${r.slug}）` : "已保存", bad: false }
                    : { text: `保存失败：${r.error}`, bad: true },
            );
        });
    }

    return (
        <li className="flex items-center gap-2" style={{ marginLeft: (cat.level - 1) * 22 }}>
            <form onSubmit={save} className="flex flex-wrap items-center gap-2">
                <Input
                    value={name}
                    onChange={(e) => {
                        setName(e.target.value);
                        setNote(null);
                    }}
                    className="w-40 px-2 py-1 text-sm"
                />
                <Input
                    value={slugText}
                    onChange={(e) => {
                        setSlugText(e.target.value);
                        setNote(null);
                    }}
                    placeholder="slug"
                    className="w-40 px-2 py-1 font-mono text-sm"
                />
                <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                    {pending ? "保存中…" : "保存"}
                </Button>
                {note && <span className={`text-xs ${note.bad ? "text-red-600" : "text-muted"}`}>{note.text}</span>}
                {pending && <span className="text-xs text-muted">同步中…</span>}
            </form>
            <Link href={`/categories/${cat.id}/attributes`} prefetch={false} className="text-xs text-muted transition hover:text-accent">
                属性
            </Link>
            <span className="text-xs text-muted">L{cat.level}</span>
        </li>
    );
}
