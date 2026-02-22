"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, background: "#030712", color: "#fff", fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 400, textAlign: "center" }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>⚠️</p>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            {typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "Critical error" : "Kritik hata"}
          </h1>
          <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 24 }}>{error.message}</p>
          <button
            onClick={() => reset()}
            style={{ padding: "12px 24px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
          >
            {typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "Try again" : "Tekrar dene"}
          </button>
        </div>
      </body>
    </html>
  );
}
