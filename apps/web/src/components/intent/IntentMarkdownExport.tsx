"use client";

import React, { useState } from "react";
import { HistoricalIntentCheckSessionDto } from "@traceback/shared-types";
import styles from "./intent-export.module.css";

export function formatIntentSessionAsMarkdown(
  session: HistoricalIntentCheckSessionDto,
): string {
  const lines: string[] = [];
  lines.push("# Traceback Historical Intent Check Audit\n");
  lines.push(`- **Session ID:** \`${session.id}\``);
  lines.push(`- **Repository ID:** \`${session.repositoryId}\``);
  lines.push(`- **Evaluated At:** ${session.createdAt}`);
  lines.push(`- **Advisory Outcome:** **${session.outcome}**`);
  lines.push(`- **Execution Status:** ${session.status}`);
  if (session.filePath) {
    lines.push(`- **Target File Path:** \`${session.filePath}\``);
  }
  if (session.changeDescription) {
    lines.push(`- **Change Description:** ${session.changeDescription}`);
  }

  lines.push("\n## Executive Summary");
  lines.push(session.summary || "No summary provided.");

  if (session.humanDisposition) {
    lines.push("\n## Human Review Disposition");
    lines.push(`- **Disposition:** ${session.humanDisposition}`);
    if (session.dispositionNotes) {
      lines.push(`- **Review Notes:** ${session.dispositionNotes}`);
    }
  }

  lines.push(
    `\n## Historical Invariant & Conflict Audits (${session.conflicts.length})`,
  );
  if (session.conflicts.length === 0) {
    lines.push(
      "No historical conflicts, ADR violations, or past revert collisions detected for this proposed change.",
    );
  } else {
    session.conflicts.forEach((c, idx) => {
      lines.push(`\n### ${idx + 1}. ${c.title}`);
      lines.push(`- **Severity:** \`${c.severity}\``);
      lines.push(`- **Outcome:** ${c.outcome}`);
      lines.push(`- **Rationale:** ${c.rationale}`);
      if (c.unestablishedContext) {
        lines.push(`- **Severity Basis:** ${c.unestablishedContext}`);
      }
      lines.push(`- **Recommended Review:** ${c.recommendedReview}`);
      if (c.supportingEvidence && c.supportingEvidence.length > 0) {
        lines.push("- **Supporting Historical Evidence:**");
        c.supportingEvidence.forEach((ev) => {
          lines.push(
            `  * [${ev.sourceType}] ${ev.referenceKey}: ${ev.title}${
              ev.url ? ` ([View Citation](${ev.url}))` : ""
            }`,
          );
        });
      }
    });
  }

  lines.push("\n---");
  lines.push(
    "> **Traceback Advisory Notice:** This analysis is purely advisory and non-blocking. " +
      "Traceback does not alter source code, merge pull requests, or block deployments. " +
      "Final responsibility for architectural changes remains with the human engineering team.",
  );

  return lines.join("\n");
}

interface IntentMarkdownExportProps {
  session: HistoricalIntentCheckSessionDto;
}

export function IntentMarkdownExport({ session }: IntentMarkdownExportProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const markdown = formatIntentSessionAsMarkdown(session);
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleDownload = () => {
    const markdown = formatIntentSessionAsMarkdown(session);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intent-audit-${session.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.exportContainer}>
      <button
        type="button"
        onClick={handleCopy}
        className={styles.exportBtn}
        aria-label="Copy intent check audit markdown"
      >
        <span>📋</span>
        <span>{copied ? "Copied!" : "Copy Markdown"}</span>
      </button>

      <button
        type="button"
        onClick={handleDownload}
        className={styles.exportBtn}
        aria-label="Download intent check audit markdown file"
      >
        <span>📥</span>
        <span>Download .md</span>
      </button>

      {copied && (
        <span className={styles.copiedBadge}>
          ✓ Markdown copied to clipboard
        </span>
      )}
    </div>
  );
}
