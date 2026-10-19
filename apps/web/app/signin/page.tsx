"use client";

import { useState } from "react";
import { makeAuthClient } from "@onestarry/auth/client";
import { Button, Input } from "@onestarry/ui";

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
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" />
                <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
                <div className="flex gap-2">
                    <Button onClick={signUp}>Sign up</Button>
                    <Button onClick={signIn} variant="secondary">Sign in</Button>
                    <Button onClick={signOut} variant="secondary">Sign out</Button>
                </div>
                <pre className="min-h-6 whitespace-pre-wrap text-sm text-muted">{status}</pre>
            </div>
        </div>
    );
}
