"use client";

/**
 * 根级错误边界：只有**根布局自己**抛错时才会用到（例如 layout 里读会话就炸）。
 * 它绕过 layout 渲染，因此没有 Tailwind —— 全部用内联样式兜底，绝不能再依赖任何外部资源。
 */
export default function AdminGlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="zh">
            <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
                <main style={{ maxWidth: 480, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
                    <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>后台无法加载</h1>
                    <p style={{ fontSize: 14, color: "#666", margin: "0 0 24px" }}>
                        连页面框架本身都没渲染出来，通常是登录态或数据库连接出了问题。重试一次，或稍后再来。
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
                        重试
                    </button>
                </main>
            </body>
        </html>
    );
}
