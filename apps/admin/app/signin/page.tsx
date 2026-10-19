"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";
import { Button, Card, Input } from "@onestarry/ui";

const authClient = makeAuthClient();

/** 后台登录（admin 实例）。管理员账号由 seed/超管创建，不开放公开注册。 */
export default function AdminSignIn() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [status, setStatus] = useState("");

    async function signIn() {
        setStatus("登录中…");
        const { error } = await authClient.signIn.email({ email, password });
        if (error) {
            setStatus(`登录失败：${error.message ?? error.status}`);
            return;
        }
        setStatus("登录成功");
        router.push("/");
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-surface px-4">
            <Card className="w-full max-w-sm p-6 shadow-sm">
                <form
                    onSubmit={async (e) => {
                        e.preventDefault();
                        await signIn();
                    }}
                >
                    <h1 className="text-xl font-semibold tracking-tight">后台登录</h1>
                    <div className="mt-5 grid gap-3">
                        <label className="sr-only" htmlFor="email">管理员邮箱</label>
                        <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="管理员邮箱" autoComplete="email" />
                        <label className="sr-only" htmlFor="password">密码</label>
                        <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
                        <Button type="submit">登录</Button>
                        {status && <p className="text-sm text-muted">{status}</p>}
                    </div>
                </form>
            </Card>
        </div>
    );
}
