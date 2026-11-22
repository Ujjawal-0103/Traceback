import {
  DecisionStatus,
  DecisionSeverity,
  EngineeringDecisionDto,
  EvidenceReference,
} from "@traceback/shared-types";

export interface ParsedAdr {
  identifier?: string;
  title: string;
  status: DecisionStatus;
  severity: DecisionSeverity;
  date?: string;
  targetFilePath?: string;
  targetSymbol?: string;
  reviewerName?: string;
  reviewedAt?: string;
  createdFromClaimId?: string;
  summary: string;
  decision: string;
  rationale: string;
  supportingEvidence: EvidenceReference[];
  reviewNotes?: string;
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 50);
}

export function generateAdrFileName(
  sequenceNumber: number,
  title: string,
): string {
  const pad = String(sequenceNumber).padStart(3, "0");
  const slug = slugifyTitle(title) || "decision";
  return `ADR-${pad}-${slug}.md`;
}

export function mapStatusToAdrLabel(status: DecisionStatus): string {
  switch (status) {
    case "ACCEPTED":
      return "Accepted";
    case "CANDIDATE":
      return "Proposed";
    case "IN_REVIEW":
      return "In Review";
    case "SUPERSEDED":
      return "Superseded";
    case "DISPUTED":
      return "Disputed";
    case "ARCHIVED":
      return "Deprecated";
    default:
      return status;
  }
}

export function mapAdrLabelToStatus(label: string): DecisionStatus {
  const l = label.trim().toLowerCase();
  if (l.includes("accepted")) return "ACCEPTED";
  if (l.includes("proposed") || l.includes("candidate")) return "CANDIDATE";
  if (l.includes("review")) return "IN_REVIEW";
  if (l.includes("superseded")) return "SUPERSEDED";
  if (l.includes("disputed")) return "DISPUTED";
  if (
    l.includes("deprecated") ||
    l.includes("archived") ||
    l.includes("rejected")
  )
    return "ARCHIVED";
  return "CANDIDATE";
}

export function mapSeverityLabelToSeverity(label: string): DecisionSeverity {
  const l = label.trim().toUpperCase();
  if (["CRITICAL", "HIGH", "MEDIUM", "LOW", "ADVISORY"].includes(l)) {
    return l as DecisionSeverity;
  }
  return "MEDIUM";
}

export function formatDecisionToAdrMarkdown(
  decision: EngineeringDecisionDto,
  sequenceNumber = 1,
): string {
  const pad = String(sequenceNumber).padStart(3, "0");
  const identifier = `ADR-${pad}`;
  const statusLabel = mapStatusToAdrLabel(decision.status);
  const dateStr = decision.reviewedAt
    ? decision.reviewedAt.slice(0, 10)
    : decision.createdAt.slice(0, 10);

  const lines: string[] = [];

  // Title & Metadata
  lines.push(`# ${identifier}: ${decision.title}`);
  lines.push("");
  lines.push(`- **Identifier:** ${identifier}`);
  lines.push(`- **Title:** ${decision.title}`);
  lines.push(`- **Status:** ${statusLabel}`);
  lines.push(`- **Date:** ${dateStr}`);
  lines.push(`- **Severity:** ${decision.severity}`);
  if (decision.targetFilePath) {
    lines.push(`- **Target File:** \`${decision.targetFilePath}\``);
  }
  if (decision.targetSymbol) {
    lines.push(`- **Target Symbol:** \`${decision.targetSymbol}\``);
  }
  if (decision.reviewerName) {
    lines.push(`- **Reviewer:** ${decision.reviewerName}`);
  }
  if (decision.reviewedAt) {
    lines.push(`- **Reviewed At:** ${decision.reviewedAt}`);
  }
  if (decision.createdFromClaimId) {
    lines.push(
      `- **Derived From Claim ID:** \`${decision.createdFromClaimId}\``,
    );
  }
  if (decision.supersedesId) {
    lines.push(`- **Supersedes Decision ID:** \`${decision.supersedesId}\``);
  }
  if (decision.supersededById) {
    lines.push(
      `- **Superseded By Decision ID:** \`${decision.supersededById}\``,
    );
  }
  lines.push("");

  // Context
  lines.push("## Context");
  lines.push("");
  lines.push(decision.summary || "No context specified.");
  lines.push("");

  // Decision
  lines.push("## Decision & Consequences");
  lines.push("");
  lines.push(decision.decision || "No decision statement specified.");
  lines.push("");

  // Rationale
  lines.push("## Rationale");
  lines.push("");
  lines.push(decision.rationale || "No rationale specified.");
  lines.push("");

  // Supporting Evidence & Provenance
  lines.push("## Supporting Evidence & Provenance");
  lines.push("");
  if (decision.supportingEvidence && decision.supportingEvidence.length > 0) {
    for (const ev of decision.supportingEvidence) {
      const typeTag = ev.sourceType || "SOURCE";
      const keyLink = ev.url
        ? `[\`${ev.referenceKey}\`](${ev.url})`
        : `\`${ev.referenceKey}\``;
      const authorText = ev.author ? ` by **${ev.author}**` : "";
      const dateText = ev.timestamp ? ` (${ev.timestamp.slice(0, 10)})` : "";
      lines.push(
        `- **[${typeTag}]** ${keyLink} — *${ev.title || "Reference"}*${authorText}${dateText}`,
      );
      if (ev.filePath) {
        const lineText = ev.lineRange
          ? `#L${ev.lineRange.start}-L${ev.lineRange.end}`
          : "";
        lines.push(`  - File: \`${ev.filePath}${lineText}\``);
      }
      if (ev.snippet) {
        lines.push(
          `  - Excerpt: \`${ev.snippet.replace(/\n/g, " ").slice(0, 160)}\``,
        );
      }
    }
  } else {
    lines.push("No explicit evidence attachments recorded.");
  }
  lines.push("");

  // Review Notes & Audit Trail
  lines.push("## Review Notes & Audit Trail");
  lines.push("");
  if (decision.reviewNotes) {
    lines.push(`> ${decision.reviewNotes}`);
  } else {
    lines.push("Pending reviewer notes upon acceptance.");
  }
  lines.push("");

  return lines.join("\n");
}

export function sanitizeText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, "")
    .trim();
}

export function parseAdrMarkdownToDecision(markdown: string): ParsedAdr {
  if (
    !markdown ||
    typeof markdown !== "string" ||
    markdown.trim().length === 0
  ) {
    throw new Error("ADR markdown content is empty.");
  }
  if (markdown.length > 500_000) {
    throw new Error(
      "ADR markdown content exceeds maximum allowed size (500KB).",
    );
  }

  const lines = markdown.split(/\r?\n/);

  let title = "Imported Architectural Decision";
  let identifier: string | undefined;
  let status: DecisionStatus = "CANDIDATE";
  let severity: DecisionSeverity = "MEDIUM";
  let date: string | undefined;
  let targetFilePath: string | undefined;
  let targetSymbol: string | undefined;
  let reviewerName: string | undefined;
  let reviewedAt: string | undefined;
  let createdFromClaimId: string | undefined;
  let reviewNotes: string | undefined;

  let currentSection = "";
  const sectionContent: Record<string, string[]> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Check H1 header
    if (line.startsWith("# ")) {
      const h1Match = line.slice(2).trim();
      const idMatch = h1Match.match(/^(ADR-\d+):\s*(.*)$/i);
      if (idMatch) {
        identifier = idMatch[1].toUpperCase();
        title = idMatch[2].trim() || title;
      } else {
        title = h1Match;
      }
      continue;
    }

    // Check H2 headers
    if (line.startsWith("## ")) {
      const secName = line.slice(3).trim().toLowerCase();
      if (secName.includes("context")) currentSection = "context";
      else if (secName.includes("decision")) currentSection = "decision";
      else if (secName.includes("rationale")) currentSection = "rationale";
      else if (secName.includes("evidence") || secName.includes("provenance"))
        currentSection = "evidence";
      else if (secName.includes("review") || secName.includes("audit"))
        currentSection = "review";
      else currentSection = secName;

      if (!sectionContent[currentSection]) {
        sectionContent[currentSection] = [];
      }
      continue;
    }

    // Check bullet metadata before any H2
    if (!currentSection && line.startsWith("- **")) {
      const metaMatch = line.match(/^-\s*\*\*([^:]+):\*\*\s*(.*)$/);
      if (metaMatch) {
        const key = metaMatch[1].trim().toLowerCase();
        const val = metaMatch[2].trim().replace(/^`|`$/g, "");

        if (key === "identifier") identifier = val;
        else if (key === "title") title = val;
        else if (key === "status") status = mapAdrLabelToStatus(val);
        else if (key === "severity") severity = mapSeverityLabelToSeverity(val);
        else if (key === "date") date = val;
        else if (key === "target file") targetFilePath = val;
        else if (key === "target symbol") targetSymbol = val;
        else if (key === "reviewer") reviewerName = val;
        else if (key === "reviewed at") reviewedAt = val;
        else if (key === "derived from claim id") createdFromClaimId = val;
      }
      continue;
    }

    // Accumulate section body
    if (currentSection) {
      if (!sectionContent[currentSection]) {
        sectionContent[currentSection] = [];
      }
      sectionContent[currentSection].push(rawLine);
    }
  }

  const summary =
    (sectionContent["context"] || []).join("\n").trim() ||
    `ADR imported from ${identifier || "file"}`;
  const decision =
    (sectionContent["decision"] || []).join("\n").trim() || title;
  const rationale =
    (sectionContent["rationale"] || []).join("\n").trim() ||
    "Imported architectural rationale.";
  const reviewBody = (sectionContent["review"] || []).join("\n").trim();
  if (reviewBody) {
    reviewNotes = reviewBody.replace(/^>\s*/gm, "");
  }

  // Parse evidence from lines in evidence section
  const supportingEvidence: EvidenceReference[] = [];
  const evidenceLines = sectionContent["evidence"] || [];
  for (const evLine of evidenceLines) {
    const trimmed = evLine.trim();
    if (trimmed.startsWith("- **[")) {
      // e.g. - **[COMMIT]** [`7a8b9c1d`](url) — *title* by author (date)
      const evMatch = trimmed.match(
        /^-\s*\*\*\[([A-Z_]+)\]\*\*\s*\[?`?([^`\]]+)`?\]?(?:\(([^)]+)\))?\s*(?:—|-)?\s*(?:\*([^*]+)\*)?(?:\s*by\s*\*\*([^*]+)\*\*)?(?:\s*\(([^)]+)\))?/i,
      );
      if (evMatch) {
        const sourceType = (evMatch[1].toUpperCase() as any) || "COMMIT";
        const referenceKey = evMatch[2] || "ref";
        const url = evMatch[3] || "";
        const evTitle = evMatch[4]?.trim() || `Reference ${referenceKey}`;
        const author = evMatch[5]?.trim() || "Maintainer";
        const timestamp = evMatch[6]?.trim() || new Date().toISOString();

        supportingEvidence.push({
          id: `ev_${referenceKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
          sourceType,
          referenceKey,
          title: evTitle,
          author,
          timestamp,
          url,
        });
      }
    }
  }

  return {
    identifier: identifier ? sanitizeText(identifier) : undefined,
    title: sanitizeText(title) || "Imported Architectural Decision",
    status,
    severity,
    date,
    targetFilePath: targetFilePath ? sanitizeText(targetFilePath) : undefined,
    targetSymbol: targetSymbol ? sanitizeText(targetSymbol) : undefined,
    reviewerName: reviewerName ? sanitizeText(reviewerName) : undefined,
    reviewedAt,
    createdFromClaimId,
    summary: sanitizeText(summary),
    decision: sanitizeText(decision),
    rationale: sanitizeText(rationale),
    supportingEvidence,
    reviewNotes: reviewNotes ? sanitizeText(reviewNotes) : undefined,
  };
}
