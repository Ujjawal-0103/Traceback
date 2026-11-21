"use client";

import React, { useState } from "react";
import { HistoricalIntentCheckSessionDto } from "@traceback/shared-types";
import { downloadIntentCheckMarkdown } from "../../lib/export-intent-markdown";

export interface ExportIntentMarkdownButtonProps {
  session: HistoricalIntentCheckSessionDto | null;
  repositoryName?: string;
  className?: string;
}

export const ExportIntentMarkdownButton: React.FC<
  ExportIntentMarkdownButtonProps
> = ({ session, repositoryName, className = "" }) => {
  const [exported, setExported] = useState(false);

  if (!session) {
    return null;
  }

  const handleExport = () => {
    try {
      downloadIntentCheckMarkdown(session, repositoryName);
      setExported(true);
      setTimeout(() => {
        setExported(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to export intent markdown report:", err);
    }
  };

  return (
    <button
      type="button"
      id="export-intent-markdown-button"
      aria-label="Export Historical Intent Check Report as Markdown"
      onClick={handleExport}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.45rem 0.85rem",
        borderRadius: "6px",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
        border: exported
          ? "1px solid #10B981"
          : "1px solid var(--color-border, #CBD5E1)",
        backgroundColor: exported
          ? "rgba(16, 185, 129, 0.1)"
          : "var(--color-surface, #FFFFFF)",
        color: exported ? "#059669" : "var(--color-text, #0F172A)",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {exported ? (
          <path d="M20 6L9 17l-5-5" />
        ) : (
          <>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </>
        )}
      </svg>
      <span>{exported ? "Exported ✓" : "Export Markdown"}</span>
    </button>
  );
};

export default ExportIntentMarkdownButton;
