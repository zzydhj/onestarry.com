"use client";

import { useState } from "react";
import { makeAuthClient } from "@onestarry/auth/client";

const authClient = makeAuthClient();

/** 最小 customer 注册/登录页（步骤 6 端到端验证用；正式 UI 后续替换）。 */
export default function SignInPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [status, setStatus] = useState<string>("");

    async function signUp() {
        setStatus("注册中…");
        const { data, error } = await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0] ?? "customer",
        });
        setStatus(error ? `注册失败：${error.message ?? error.status}` : `注册成功：${data?.user?.email ?? ""}`);
    }

    async function signIn() {
        setStatus("登录中…");
        const { data, error } = await authClient.signIn.email({ email, password });
        setStatus(error ? `登录失败：${error.message ?? error.status}` : `登录成功：${data?.user?.email ?? ""}`);
    }

    async function signOut() {
        await authClient.signOut();
        setStatus("已登出");
    }

    return (
        <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "system-ui", display: "grid", gap: 12 }}>
            <h1 style={{ fontSize: 20 }}>账户</h1>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" autoComplete="email" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={signUp}>注册</button>
                <button onClick={signIn}>登录</button>
                <button onClick={signOut}>登出</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", minHeight: 24, color: "#444" }}>{status}</pre>
        </main>
    );
}
