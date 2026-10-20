"use client";

/**
 * 根级错误边界：捕获根布局本身抛错时渲染。它绕过 layout（无 Tailwind），故用内联样式兜底。
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
                <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
                    <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>Something went wrong</h1>
                    <p style={{ fontSize: 14, color: "#666", margin: "0 0 24px" }}>
                        An unexpected error occurred. Please try again.
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            background: "#111",
                            color: "#fff",
                            border: 0,
                            borderRadius: 8,
                            padding: "8px 16px",
                            fontSize: 14,
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}
