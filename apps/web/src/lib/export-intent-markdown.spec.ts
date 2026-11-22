import {
  generateIntentCheckMarkdown,
  downloadIntentCheckMarkdown,
  formatOutcomeLabel,
} from "./export-intent-markdown";
import {
  HistoricalIntentCheckSessionDto,
  IntentConflictItem,
} from "@traceback/shared-types";

describe("export-intent-markdown", () => {
  const sampleConflicts: IntentConflictItem[] = [
    {
      id: "conflict-1",
      title: "Direct Mutation of Prisma Client Engine",
      affectedCodeOrSymbol: "prisma.$connect",
      conflictingDecisionId: "dec-001",
      conflictingDecisionTitle: "ADR-001: Centralized Database Service",
      severity: "HIGH",
      outcome: "DOCUMENTED_CONFLICT",
      rationale:
        "Directly mutating prisma engine bypasses audit logging and transaction boundaries.",
      unestablishedContext:
        "Check if query engine retry logic is also impacted.",
      recommendedReview:
        "Refactor connection pooling through DatabaseService provider.",
      supportingEvidence: [
        {
          id: "ev-1",
          sourceType: "ADR",
          referenceKey: "ADR-001",
          title: "Architecture Decision: Centralized Database Service",
          author: "Tech Lead",
          timestamp: "2026-08-15T10:00:00Z",
          url: "https://github.com/traceback/traceback/docs/adr/001.md",
          snippet: "All database queries MUST pass through DatabaseService.",
        },
      ],
    },
  ];

  const mockSession: HistoricalIntentCheckSessionDto = {
    id: "session-abc-123",
    workspaceId: "ws_alpha",
    repositoryId: "repo_beta",
    diff: "diff --git a/src/db.ts b/src/db.ts\n+ prisma.$connect();",
    filePath: "src/db.ts",
    changeDescription: "Direct connect on boot",
    status: "COMPLETED",
    outcome: "DOCUMENTED_CONFLICT",
    summary: "Proposed change directly connects to Prisma, violating ADR-001.",
    conflicts: sampleConflicts,
    humanDisposition: "NEEDS_DISCUSSION",
    dispositionNotes: "Discuss with infrastructure team before merge.",
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:05:00.000Z",
  };

  describe("formatOutcomeLabel", () => {
    it("should format known outcome values properly", () => {
      expect(formatOutcomeLabel("DOCUMENTED_CONFLICT")).toBe(
        "Documented Conflict",
      );
      expect(formatOutcomeLabel("POTENTIAL_CONFLICT")).toBe(
        "Potential Conflict",
      );
      expect(formatOutcomeLabel("NO_KNOWN_CONFLICT")).toBe("No Known Conflict");
      expect(formatOutcomeLabel("INSUFFICIENT_CONTEXT")).toBe(
        "Insufficient Context",
      );
    });
  });

  describe("generateIntentCheckMarkdown", () => {
    it("should generate markdown with all sections, conflict details, and evidence", () => {
      const md = generateIntentCheckMarkdown(mockSession, "Traceback Core");

      expect(md).toContain("# Traceback — Historical Intent Check Report");
      expect(md).toContain("- **Session ID:** `session-abc-123`");
      expect(md).toContain(
        "- **Repository:** **Traceback Core** (`repo_beta`)",
      );
      expect(md).toContain("- **Advisory Outcome:** **Documented Conflict**");
      expect(md).toContain("## 1. Overall Evaluation & Summary");
      expect(md).toContain(
        "Proposed change directly connects to Prisma, violating ADR-001.",
      );
      expect(md).toContain("- **Human Disposition:** NEEDS_DISCUSSION");
      expect(md).toContain(
        "- **Disposition Notes:** Discuss with infrastructure team before merge.",
      );

      // Section 2: Diff
      expect(md).toContain("## 2. Proposed Code Change / Diff");
      expect(md).toContain("- **Target File:** `src/db.ts`");
      expect(md).toContain("```diff\ndiff --git a/src/db.ts b/src/db.ts");

      // Section 3: Conflicts
      expect(md).toContain(
        "## 3. Historical Constraints & Conflicting Decisions",
      );
      expect(md).toContain("### 3.1. Direct Mutation of Prisma Client Engine");
      expect(md).toContain("- **Severity:** `HIGH`");
      expect(md).toContain("- **Affected Code / Symbol:** `prisma.$connect`");
      expect(md).toContain(
        "- **Referenced Decision:** ADR-001: Centralized Database Service",
      );
      expect(md).toContain(
        "- **Rationale:** Directly mutating prisma engine bypasses audit logging",
      );

      // Section 4: Evidence
      expect(md).toContain("## 4. Supporting Historical Evidence");
      expect(md).toContain(
        "Architecture Decision: Centralized Database Service",
      );
      expect(md).toContain("- **Reference:** `ADR-001`");
      expect(md).toContain(
        "All database queries MUST pass through DatabaseService.",
      );

      // Section 5: Advisory Disclaimer
      expect(md).toContain("## 5. Human Review & Advisory Disclaimer");
      expect(md).toContain(
        "Traceback analyses and recommendations are strictly advisory.",
      );
    });

    it("should render explicit abstention/warning notice on INSUFFICIENT_CONTEXT outcome", () => {
      const sessionWithInsufficientContext: HistoricalIntentCheckSessionDto = {
        ...mockSession,
        outcome: "INSUFFICIENT_CONTEXT",
        summary: "No historical decision records found for modified module.",
        conflicts: [],
      };

      const md = generateIntentCheckMarkdown(sessionWithInsufficientContext);

      expect(md).toContain("- **Advisory Outcome:** **Insufficient Context**");
      expect(md).toContain("> [!WARNING]");
      expect(md).toContain(
        "Absence of historical evidence does not prove the proposed change is safe.",
      );
      expect(md).toContain(
        "No historical constraints or conflicting decisions identified.",
      );
      expect(md).toContain(
        "No specific historical citations or evidence records referenced.",
      );
    });

    it("should handle minimal session without optional fields gracefully", () => {
      const minimalSession: HistoricalIntentCheckSessionDto = {
        id: "",
        workspaceId: "",
        repositoryId: "repo_min",
        diff: "",
        status: "COMPLETED",
        outcome: "NO_KNOWN_CONFLICT",
        summary: "Clean diff with zero historical conflicts.",
        conflicts: [],
        createdAt: "",
        updatedAt: "",
      };

      const md = generateIntentCheckMarkdown(minimalSession);

      expect(md).toContain("- **Session ID:** `N/A`");
      expect(md).toContain("- **Workspace ID:** `N/A`");
      expect(md).toContain("Clean diff with zero historical conflicts.");
      expect(md).toContain("```diff\n(No diff provided)\n```");
      expect(md).not.toContain("> [!WARNING]");
    });
  });

  describe("downloadIntentCheckMarkdown", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => "blob:mock-url-1234");
      URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it("should generate file and trigger download via anchor click in browser environment", () => {
      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeChildSpy = jest.spyOn(document.body, "removeChild");

      downloadIntentCheckMarkdown(mockSession, "Traceback Core");

      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url-1234");

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });
});
