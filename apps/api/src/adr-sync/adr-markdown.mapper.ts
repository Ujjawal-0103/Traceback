import {
  DecisionStatus,
  DecisionSeverity,
  EvidenceReference,
  EngineeringDecisionDto,
} from "@traceback/shared-types";

export interface ParsedAdr {
  identifier?: string;
  title: string;
  status: DecisionStatus;
  severity: DecisionSeverity;
  date?: string;
  targetFilePath?: string;
  targetSymbol?: string;
  relatedCommitSha?: string;
  relatedPrNumber?: number;
  summary: string;
  decision: string;
  rationale: string;
  supportingEvidence: EvidenceReference[];
  reviewerName?: string;
  reviewedAt?: string;
}

export class AdrMarkdownMapper {
  /**
   * Normalizes raw status string to canonical DecisionStatus enum.
   * Defaults to human-reviewable "CANDIDATE" if unspecified or unrecognized.
   */
  static normalizeStatus(raw?: string): DecisionStatus {
    if (!raw) return "CANDIDATE";
    const s = raw.toUpperCase().trim();
    if (s.includes("ACCEPT")) return "ACCEPTED";
    if (s.includes("REVIEW") || s.includes("PROPOS")) return "IN_REVIEW";
    if (s.includes("SUPERSED")) return "SUPERSEDED";
    if (s.includes("DISPUT") || s.includes("REJECT")) return "DISPUTED";
    if (s.includes("ARCHIV") || s.includes("DEPRECAT")) return "ARCHIVED";
    if (
      s.includes("CANDIDATE") ||
      s.includes("DRAFT") ||
      s.includes("PROVISIONAL")
    )
      return "CANDIDATE";
    return "CANDIDATE";
  }

  /**
   * Normalizes raw severity string to canonical DecisionSeverity enum.
   */
  static normalizeSeverity(raw?: string): DecisionSeverity {
    if (!raw) return "MEDIUM";
    const s = raw.toUpperCase().trim();
    if (s === "CRITICAL") return "CRITICAL";
    if (s === "HIGH") return "HIGH";
    if (s === "LOW") return "LOW";
    if (s === "ADVISORY") return "ADVISORY";
    return "MEDIUM";
  }

  /**
   * Parses Markdown content (supporting both YAML frontmatter and bullet headers).
   */
  static parse(markdown: string, fileName?: string): ParsedAdr {
    const lines = markdown.split(/\r?\n/);
    let title = "";
    let identifier = "";
    let rawStatus = "";
    let rawSeverity = "";
    let date = "";
    let targetFilePath = "";
    let targetSymbol = "";
    let relatedCommitSha = "";
    let relatedPrNumber: number | undefined;
    let reviewerName = "";
    let reviewedAt = "";

    // 1. Check for YAML frontmatter
    let contentStartIndex = 0;
    if (lines[0]?.trim() === "---") {
      let fmEnd = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
          fmEnd = i;
          break;
        }
      }
      if (fmEnd !== -1) {
        for (let i = 1; i < fmEnd; i++) {
          const line = lines[i].trim();
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const val = line
              .slice(colonIdx + 1)
              .trim()
              .replace(/^["']|["']$/g, "");
            if (key === "title") title = val;
            else if (key === "id" || key === "identifier") identifier = val;
            else if (key === "status") rawStatus = val;
            else if (key === "severity") rawSeverity = val;
            else if (key === "date") date = val;
            else if (key === "targetfilepath" || key === "file")
              targetFilePath = val;
            else if (key === "targetsymbol" || key === "symbol")
              targetSymbol = val;
            else if (key === "commit" || key === "relatedcommitsha")
              relatedCommitSha = val;
            else if (key === "pr" || key === "relatedprnumber") {
              const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
              if (!isNaN(num)) relatedPrNumber = num;
            }
          }
        }
        contentStartIndex = fmEnd + 1;
      }
    }

    // 2. Scan remaining lines for H1 title and bullet metadata
    const bodyLines: string[] = [];
    for (let i = contentStartIndex; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // H1 Header: e.g. "# ADR-001: Repository Structure" or "# Repository Structure"
      if (!title && trimmed.startsWith("# ")) {
        const h1Text = trimmed.slice(2).trim();
        const colonSplit = h1Text.split(":");
        if (
          colonSplit.length > 1 &&
          colonSplit[0].toUpperCase().includes("ADR")
        ) {
          identifier = colonSplit[0].trim();
          title = colonSplit.slice(1).join(":").trim();
        } else {
          title = h1Text;
        }
        continue;
      }

      // Metadata bullet points: e.g. "- **Identifier:** ADR-001"
      if (trimmed.startsWith("- **") || trimmed.startsWith("* **")) {
        const match = trimmed.match(/^[-*]\s+\*\*([^*]+):\*\*\s*(.+)$/i);
        if (match) {
          const field = match[1].toLowerCase().trim();
          const val = match[2].trim();
          if (field === "identifier" || field === "id") identifier = val;
          else if (field === "title") title = val;
          else if (field === "status") rawStatus = val;
          else if (field === "severity") rawSeverity = val;
          else if (field === "date") date = val;
          else if (field === "target file" || field === "file")
            targetFilePath = val;
          else if (field === "target symbol" || field === "symbol")
            targetSymbol = val;
          else if (field === "related commit" || field === "commit")
            relatedCommitSha = val;
          else if (field === "related pr" || field === "pr") {
            const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
            if (!isNaN(num)) relatedPrNumber = num;
          } else if (field === "reviewer") reviewerName = val;
          else if (field === "reviewed at") reviewedAt = val;
          continue;
        }
      }

      bodyLines.push(line);
    }

    // Derive fallback title and identifier from fileName if not yet set
    if (!title && fileName) {
      const cleanName = fileName.replace(/\.md$/i, "");
      const match = cleanName.match(/^(ADR-\d+)[-_]?(.*)$/i);
      if (match) {
        identifier = match[1].toUpperCase();
        title = match[2].replace(/[-_]/g, " ").trim() || identifier;
      } else {
        title = cleanName.replace(/[-_]/g, " ").trim();
      }
    }

    // 3. Section Extraction
    const sections: Record<string, string[]> = {};
    let currentSection = "preamble";

    for (const bLine of bodyLines) {
      const trimmed = bLine.trim();
      if (trimmed.startsWith("## ")) {
        currentSection = trimmed.slice(3).toLowerCase().trim();
        sections[currentSection] = [];
      } else {
        if (!sections[currentSection]) sections[currentSection] = [];
        sections[currentSection].push(bLine);
      }
    }

    // Context / Summary
    const contextKey =
      Object.keys(sections).find(
        (k) => k.includes("context") || k.includes("summary"),
      ) || "preamble";
    const summary =
      (sections[contextKey] || []).join("\n").trim() ||
      `ADR ${identifier || title}`;

    // Decision
    const decisionKey = Object.keys(sections).find((k) =>
      k.includes("decision"),
    );
    const decision = decisionKey
      ? (sections[decisionKey] || []).join("\n").trim()
      : `Accepted architectural approach: ${title}`;

    // Rationale: prioritize explicit rationale / trade-offs / criteria
    let rationaleKey = Object.keys(sections).find(
      (k) =>
        k.includes("rationale") ||
        k.includes("trade") ||
        k.includes("criteria") ||
        k.includes("why"),
    );
    if (!rationaleKey) {
      rationaleKey = Object.keys(sections).find(
        (k) =>
          k.includes("options") ||
          (k.includes("consequence") && !k.includes("decision")),
      );
    }
    const rationale = rationaleKey
      ? (sections[rationaleKey] || []).join("\n").trim()
      : summary;

    // Provenance / Evidence
    const evidenceKey = Object.keys(sections).find(
      (k) => k.includes("provenance") || k.includes("evidence"),
    );
    const supportingEvidence: EvidenceReference[] = [];
    if (evidenceKey && sections[evidenceKey]) {
      const evText = sections[evidenceKey].join("\n");
      const evMatches = evText.matchAll(
        /[-*]\s+\[([^\]]+)\]\s+([^:]+):\s*(.+)/g,
      );
      for (const m of evMatches) {
        supportingEvidence.push({
          id: `ev-${Math.random().toString(36).substring(2, 9)}`,
          sourceType: m[1].toUpperCase() as any,
          referenceKey: m[2].trim(),
          title: m[3].trim(),
          author: "Documented Author",
          timestamp: new Date().toISOString(),
          url: "",
        });
      }
    }

    return {
      identifier: identifier || undefined,
      title: title || "Untitled Architectural Decision",
      status: this.normalizeStatus(rawStatus),
      severity: this.normalizeSeverity(rawSeverity),
      date: date || undefined,
      targetFilePath: targetFilePath || undefined,
      targetSymbol: targetSymbol || undefined,
      relatedCommitSha: relatedCommitSha || undefined,
      relatedPrNumber,
      summary,
      decision,
      rationale,
      supportingEvidence,
      reviewerName: reviewerName || undefined,
      reviewedAt: reviewedAt || undefined,
    };
  }

  /**
   * Generates a deterministic filename slug from a decision.
   * e.g. "001-repository-structure" or "github-access-permissions"
   */
  static generateSlug(decision: {
    id: string;
    title: string;
    createdAt?: string | Date;
  }): string {
    const rawTitle = decision.title
      .replace(/^ADR[-_:\s0-9]+/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const cleanSlug = rawTitle.slice(0, 50) || "decision";
    return cleanSlug;
  }

  /**
   * Serializes an EngineeringDecision into clean, deterministic ADR Markdown.
   */
  static serialize(decision: {
    id: string;
    title: string;
    summary: string;
    decision: string;
    rationale: string;
    status: DecisionStatus;
    severity: DecisionSeverity;
    targetFilePath?: string | null;
    targetSymbol?: string | null;
    relatedCommitSha?: string | null;
    relatedPrNumber?: number | null;
    supportingEvidence?: any;
    reviewerName?: string | null;
    reviewedAt?: string | Date | null;
    createdAt: string | Date;
  }): string {
    const dateStr =
      typeof decision.createdAt === "string"
        ? decision.createdAt.slice(0, 10)
        : decision.createdAt.toISOString().slice(0, 10);

    const slug = this.generateSlug(decision);

    const metadata: string[] = [
      `- **Identifier:** ADR-${slug}`,
      `- **Title:** ${decision.title}`,
      `- **Status:** ${decision.status}`,
      `- **Severity:** ${decision.severity}`,
      `- **Date:** ${dateStr}`,
    ];

    if (decision.targetFilePath) {
      metadata.push(`- **Target File:** ${decision.targetFilePath}`);
    }
    if (decision.targetSymbol) {
      metadata.push(`- **Target Symbol:** ${decision.targetSymbol}`);
    }
    if (decision.relatedCommitSha) {
      metadata.push(`- **Related Commit:** ${decision.relatedCommitSha}`);
    }
    if (decision.relatedPrNumber) {
      metadata.push(`- **Related PR:** #${decision.relatedPrNumber}`);
    }
    if (decision.reviewerName) {
      metadata.push(`- **Reviewer:** ${decision.reviewerName}`);
    }
    if (decision.reviewedAt) {
      const reviewedStr =
        typeof decision.reviewedAt === "string"
          ? decision.reviewedAt.slice(0, 10)
          : decision.reviewedAt.toISOString().slice(0, 10);
      metadata.push(`- **Reviewed At:** ${reviewedStr}`);
    }

    const rawEvidence: EvidenceReference[] = Array.isArray(
      decision.supportingEvidence,
    )
      ? (decision.supportingEvidence as EvidenceReference[])
      : [];

    const evidenceLines =
      rawEvidence.length > 0
        ? rawEvidence
            .map((e) => {
              const loc = e.filePath
                ? ` (${e.filePath}${e.lineRange ? `:${e.lineRange.start}-${e.lineRange.end}` : ""})`
                : "";
              const snip = e.snippet
                ? `\n  > "${e.snippet.trim().slice(0, 180)}"`
                : "";
              return `- [${e.sourceType}] ${e.referenceKey}: ${e.title}${loc}${snip}`;
            })
            .join("\n")
        : "No external citations linked.";

    return [
      `# ADR-${slug}: ${decision.title}`,
      "",
      ...metadata,
      "",
      "## Context & Summary",
      "",
      decision.summary.trim(),
      "",
      "## Decision",
      "",
      decision.decision.trim(),
      "",
      "## Rationale",
      "",
      decision.rationale.trim(),
      "",
      "## Verified Provenance & Supporting Evidence",
      "",
      evidenceLines,
      "",
    ].join("\n");
  }
}
