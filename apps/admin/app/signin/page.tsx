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
        <main style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "system-ui", display: "grid", gap: 12 }}>
            <h1 style={{ fontSize: 20 }}>后台登录</h1>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="管理员邮箱" autoComplete="email" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" type="password" autoComplete="current-password" />
            <button onClick={signIn}>登录</button>
            {status && <pre style={{ whiteSpace: "pre-wrap", color: "#444" }}>{status}</pre>}
        </main>
    );
}
