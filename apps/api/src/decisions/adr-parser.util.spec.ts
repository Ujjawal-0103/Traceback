import {
  formatDecisionToAdrMarkdown,
  parseAdrMarkdownToDecision,
  slugifyTitle,
  generateAdrFileName,
} from "./adr-parser.util";
import { EngineeringDecisionDto } from "@traceback/shared-types";

describe("ADR Parser & Serializer Util", () => {
  const sampleDecision: EngineeringDecisionDto = {
    id: "dec_123",
    workspaceId: "ws_alpha",
    repositoryId: "repo_1",
    title: "Enforce Light Theme Default",
    summary: "System must initialize in light theme regardless of OS settings.",
    decision: "Default data-theme to light in root layout.",
    rationale: "Per AGENTS.md rules and developer workspace design guidelines.",
    targetFilePath: "src/app/layout.tsx",
    targetSymbol: "ThemeProvider",
    status: "ACCEPTED",
    severity: "HIGH",
    supportingEvidence: [
      {
        id: "ev_1",
        sourceType: "COMMIT",
        referenceKey: "7a8b9c",
        title: "fix: light theme default",
        author: "Alex Maintainer",
        timestamp: "2026-10-15T12:00:00Z",
        url: "https://github.com/org/repo/commit/7a8b9c",
        filePath: "src/app/layout.tsx",
      },
    ],
    relatedCommitSha: "7a8b9c",
    relatedPrNumber: null,
    reviewerId: "user_1",
    reviewerName: "Alex Maintainer",
    reviewNotes: "Confirmed necessary for accessibility conformance.",
    reviewedAt: "2026-10-15T14:00:00.000Z",
    supersedesId: null,
    supersededById: null,
    createdFromClaimId: "claim_456",
    createdAt: "2026-10-15T10:00:00.000Z",
    updatedAt: "2026-10-15T14:00:00.000Z",
  };

  it("slugifies titles correctly", () => {
    expect(slugifyTitle("Adoption of Turborepo Monorepo Structure")).toBe(
      "adoption-of-turborepo-monorepo-structure",
    );
    expect(slugifyTitle("Fix: Handle NULLs & Errors /")).toBe(
      "fix-handle-nulls-errors",
    );
  });

  it("generates padded ADR file names", () => {
    expect(generateAdrFileName(1, "Repository Structure")).toBe(
      "ADR-001-repository-structure.md",
    );
    expect(generateAdrFileName(42, "Cache Control")).toBe(
      "ADR-042-cache-control.md",
    );
  });

  it("formats decision to Markdown compliant with ADR standards", () => {
    const md = formatDecisionToAdrMarkdown(sampleDecision, 1);

    expect(md).toContain("# ADR-001: Enforce Light Theme Default");
    expect(md).toContain("- **Identifier:** ADR-001");
    expect(md).toContain("- **Status:** Accepted");
    expect(md).toContain("- **Severity:** HIGH");
    expect(md).toContain("- **Target File:** `src/app/layout.tsx`");
    expect(md).toContain("- **Derived From Claim ID:** `claim_456`");
    expect(md).toContain("## Context");
    expect(md).toContain(sampleDecision.summary);
    expect(md).toContain("## Decision & Consequences");
    expect(md).toContain(sampleDecision.decision);
    expect(md).toContain("## Supporting Evidence & Provenance");
    expect(md).toContain(
      "[`7a8b9c`](https://github.com/org/repo/commit/7a8b9c)",
    );
    expect(md).toContain("## Review Notes & Audit Trail");
    expect(md).toContain(sampleDecision.reviewNotes);
  });

  it("parses ADR Markdown back into a structured decision", () => {
    const md = formatDecisionToAdrMarkdown(sampleDecision, 2);
    const parsed = parseAdrMarkdownToDecision(md);

    expect(parsed.identifier).toBe("ADR-002");
    expect(parsed.title).toBe("Enforce Light Theme Default");
    expect(parsed.status).toBe("ACCEPTED");
    expect(parsed.severity).toBe("HIGH");
    expect(parsed.targetFilePath).toBe("src/app/layout.tsx");
    expect(parsed.createdFromClaimId).toBe("claim_456");
    expect(parsed.summary).toContain("System must initialize in light theme");
    expect(parsed.decision).toContain(
      "Default data-theme to light in root layout.",
    );
    expect(parsed.rationale).toContain("Per AGENTS.md rules");
    expect(parsed.reviewNotes).toContain(
      "Confirmed necessary for accessibility conformance.",
    );
    expect(parsed.supportingEvidence.length).toBeGreaterThan(0);
    expect(parsed.supportingEvidence[0].referenceKey).toBe("7a8b9c");
  });

  it("sanitizes malicious markup and control characters from imported content", () => {
    const maliciousMd = `# ADR-003: <script>alert('xss')</script>Secure Auth
## Context
Valid context <iframe src="evil.com"></iframe> with control \u0000 chars.
## Decision & Consequences
Use safe tokens javascript:void(0).
## Rationale
No scripts allowed.
`;
    const parsed = parseAdrMarkdownToDecision(maliciousMd);
    expect(parsed.title).toBe("Secure Auth");
    expect(parsed.title).not.toContain("<script>");
    expect(parsed.summary).not.toContain("<iframe");
    expect(parsed.summary).not.toContain("\u0000");
    expect(parsed.decision).not.toContain("javascript:");
  });

  it("rejects empty or excessively large markdown files", () => {
    expect(() => parseAdrMarkdownToDecision("   ")).toThrow(
      "ADR markdown content is empty.",
    );
    const hugeContent = "# ADR-999: Huge\n" + "x".repeat(500_001);
    expect(() => parseAdrMarkdownToDecision(hugeContent)).toThrow(
      "exceeds maximum allowed size",
    );
  });
});
