"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { makeAuthClient } from "@onestarry/auth/client";

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
        <div className="mx-auto mt-16 max-w-sm px-4">
            <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
                <h1 className="text-xl font-semibold tracking-tight">后台登录</h1>
                <div className="mt-5 grid gap-3">
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="管理员邮箱" autoComplete="email" className="rounded-md border border-line px-3 py-2 text-fg" />
                    <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" className="rounded-md border border-line px-3 py-2 text-fg" />
                    <button onClick={signIn} className="rounded-lg bg-accent px-4 py-2 font-medium text-white transition hover:opacity-90">登录</button>
                    {status && <pre className="whitespace-pre-wrap text-sm text-muted">{status}</pre>}
                </div>
            </div>
        </div>
    );
}
