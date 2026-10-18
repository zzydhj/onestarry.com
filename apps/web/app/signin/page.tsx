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
        setStatus("Signing up…");
        const { data, error } = await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0] ?? "customer",
        });
        setStatus(error ? `Sign up failed: ${error.message ?? error.status}` : `Signed up: ${data?.user?.email ?? ""}`);
    }

    async function signIn() {
        setStatus("Signing in…");
        const { data, error } = await authClient.signIn.email({ email, password });
        setStatus(error ? `Sign in failed: ${error.message ?? error.status}` : `Signed in: ${data?.user?.email ?? ""}`);
    }

    async function signOut() {
        await authClient.signOut();
        setStatus("Signed out");
    }

    return (
        <div className="mx-auto mt-16 max-w-sm px-4">
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <div className="mt-6 grid gap-3">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className="rounded-md border border-line px-3 py-2 text-fg" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" className="rounded-md border border-line px-3 py-2 text-fg" />
                <div className="flex gap-2">
                    <button onClick={signUp} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Sign up</button>
                    <button onClick={signIn} className="rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:bg-surface">Sign in</button>
                    <button onClick={signOut} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:bg-surface">Sign out</button>
                </div>
                <pre className="min-h-6 whitespace-pre-wrap text-sm text-muted">{status}</pre>
            </div>
        </div>
    );
}
