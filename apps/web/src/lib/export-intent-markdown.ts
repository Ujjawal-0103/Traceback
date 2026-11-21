import {
  HistoricalIntentCheckSessionDto,
  HistoricalIntentOutcome,
} from "@traceback/shared-types";

/**
 * Format human-readable outcome labels
 */
export function formatOutcomeLabel(outcome: HistoricalIntentOutcome): string {
  switch (outcome) {
    case "DOCUMENTED_CONFLICT":
      return "Documented Conflict";
    case "POTENTIAL_CONFLICT":
      return "Potential Conflict";
    case "NO_KNOWN_CONFLICT":
      return "No Known Conflict";
    case "INSUFFICIENT_CONTEXT":
      return "Insufficient Context";
    default:
      return outcome;
  }
}

/**
 * Generate a comprehensive Markdown report from a Historical Intent Check session.
 */
export function generateIntentCheckMarkdown(
  session: HistoricalIntentCheckSessionDto,
  repoName?: string,
): string {
  const lines: string[] = [];

  // Title & Metadata Header
  lines.push("# Traceback — Historical Intent Check Report");
  lines.push("");
  lines.push(`- **Session ID:** \`${session.id || "N/A"}\``);
  lines.push(
    `- **Date/Time:** ${
      session.createdAt
        ? new Date(session.createdAt).toISOString()
        : new Date().toISOString()
    }`,
  );
  lines.push(`- **Workspace ID:** \`${session.workspaceId || "N/A"}\``);
  lines.push(
    `- **Repository:** ${
      repoName
        ? `**${repoName}** (\`${session.repositoryId}\`)`
        : `\`${session.repositoryId}\``
    }`,
  );
  lines.push(
    `- **Advisory Outcome:** **${formatOutcomeLabel(session.outcome)}**`,
  );
  if (session.status) {
    lines.push(`- **Status:** ${session.status}`);
  }
  lines.push("");

  // Section 1: Overall Evaluation & Summary
  lines.push("## 1. Overall Evaluation & Summary");
  lines.push("");
  lines.push(session.summary || "No summary provided.");
  lines.push("");

  if (session.outcome === "INSUFFICIENT_CONTEXT") {
    lines.push("> [!WARNING]");
    lines.push(
      "> **Notice on Insufficient Context:** Absence of historical evidence does not prove the proposed change is safe. Historical evidence or decision records could not establish definitive intent. Thorough human peer review is required.",
    );
    lines.push("");
  }

  if (session.humanDisposition) {
    lines.push(`- **Human Disposition:** ${session.humanDisposition}`);
    if (session.dispositionNotes) {
      lines.push(`- **Disposition Notes:** ${session.dispositionNotes}`);
    }
    lines.push("");
  }

  // Section 2: Proposed Code Change / Diff
  lines.push("## 2. Proposed Code Change / Diff");
  lines.push("");
  if (session.filePath) {
    lines.push(`- **Target File:** \`${session.filePath}\``);
  }
  if (session.changeDescription) {
    lines.push(`- **Description:** ${session.changeDescription}`);
  }
  lines.push("");
  lines.push("```diff");
  lines.push(session.diff || "(No diff provided)");
  lines.push("```");
  lines.push("");

  // Section 3: Conflicting & Relevant Engineering Decisions
  lines.push("## 3. Historical Constraints & Conflicting Decisions");
  lines.push("");

  const conflicts = session.conflicts || [];
  if (conflicts.length === 0) {
    lines.push(
      "No historical constraints or conflicting decisions identified.",
    );
    lines.push("");
  } else {
    conflicts.forEach((conflict, index) => {
      lines.push(`### 3.${index + 1}. ${conflict.title || "Constraint"}`);
      lines.push("");
      lines.push(`- **Severity:** \`${conflict.severity || "LOW"}\``);
      lines.push(`- **Outcome:** ${formatOutcomeLabel(conflict.outcome)}`);
      if (conflict.affectedCodeOrSymbol) {
        lines.push(
          `- **Affected Code / Symbol:** \`${conflict.affectedCodeOrSymbol}\``,
        );
      }
      if (conflict.conflictingDecisionTitle || conflict.conflictingDecisionId) {
        lines.push(
          `- **Referenced Decision:** ${
            conflict.conflictingDecisionTitle || conflict.conflictingDecisionId
          }`,
        );
      }
      lines.push(
        `- **Rationale:** ${conflict.rationale || "No rationale provided."}`,
      );
      if (conflict.unestablishedContext) {
        lines.push(
          `- **Unestablished Context:** ${conflict.unestablishedContext}`,
        );
      }
      if (conflict.recommendedReview) {
        lines.push(`- **Recommended Review:** ${conflict.recommendedReview}`);
      }
      lines.push("");
    });
  }

  // Section 4: Supporting Historical Evidence
  lines.push("## 4. Supporting Historical Evidence");
  lines.push("");

  const allEvidence = conflicts.flatMap((c) => c.supportingEvidence || []);
  if (allEvidence.length === 0) {
    lines.push(
      "No specific historical citations or evidence records referenced.",
    );
    lines.push("");
  } else {
    allEvidence.forEach((ev, idx) => {
      lines.push(
        `#### Evidence [${idx + 1}]: ${
          ev.title || ev.referenceKey || "Citation"
        }`,
      );
      lines.push(`- **Type:** \`${ev.sourceType || "UNKNOWN"}\``);
      if (ev.referenceKey)
        lines.push(`- **Reference:** \`${ev.referenceKey}\``);
      if (ev.author) lines.push(`- **Author:** ${ev.author}`);
      if (ev.timestamp) lines.push(`- **Timestamp:** ${ev.timestamp}`);
      if (ev.url) lines.push(`- **URL:** [${ev.url}](${ev.url})`);
      if (ev.snippet) {
        lines.push("");
        lines.push("```");
        lines.push(ev.snippet);
        lines.push("```");
      }
      lines.push("");
    });
  }

  // Section 5: Human Review & Advisory Disclaimer
  lines.push("## 5. Human Review & Advisory Disclaimer");
  lines.push("");
  lines.push(
    "> [!NOTE]\n> **Advisory-Only:** Traceback analyses and recommendations are strictly advisory. Traceback does not block merges, approve pull requests, or alter source code. Human review is required before merging or modifying production systems.",
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Trigger client-side download of the Historical Intent Check report as a Markdown (.md) file.
 */
export function downloadIntentCheckMarkdown(
  session: HistoricalIntentCheckSessionDto,
  repoName?: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const markdown = generateIntentCheckMarkdown(session, repoName);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeSessionId = (session.id || "report").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  link.download = `traceback-intent-check-${safeSessionId}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
