"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for a crash in the ROOT layout itself. Next requires it to render its own
 * <html>/<body> (it REPLACES the layout), and it may paint before the app's CSS/theme apply — so it is
 * deliberately self-contained with minimal inline styles (the design tokens, hand-inlined) rather than
 * the Tailwind classes, which is the one place that escape is justified.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fbfaf7",
          color: "#1a1a18",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b6b63" }}>
            Error
          </p>
          <h1 style={{ margin: "0.5rem 0", fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.875rem", lineHeight: 1.6, color: "#6b6b63" }}>
            Voxboard hit an unexpected error. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: "2.25rem",
              padding: "0 1rem",
              border: "1px solid #e6e2d8",
              borderRadius: "0.375rem",
              background: "transparent",
              color: "#1a1a18",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
