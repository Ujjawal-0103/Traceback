"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy Evidence Explorer route — seamlessly redirects to the Verification Workspace (/verify).
 * Preserves backward-compatibility so existing URLs never 404.
 */
export default function EvidenceRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/verify");
  }, [router]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: 600,
          color: "var(--color-text, #0f172a)",
          marginBottom: "0.5rem",
        }}
      >
        Redirecting to Verification Workspace...
      </div>
      <p style={{ color: "var(--color-text-secondary, #64748b)" }}>
        The user-facing Evidence feature has been consolidated into the unified
        Verification Workspace.
      </p>
    </div>
  );
}
